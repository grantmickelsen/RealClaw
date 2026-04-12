import { BaseIntegration } from './base-integration.js';
import type { IntegrationStatus, NormalizedEmail } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';
import type { AgentId } from '../types/agents.js';
import { IntegrationError } from '../utils/errors.js';

export class GmailIntegration extends BaseIntegration {
  async healthCheck(): Promise<IntegrationStatus> {
    const token = await this.vault.retrieve(IntegrationId.GMAIL, 'access_token');
    if (!token) return this.notConfigured();
    try {
      await this.authenticatedRequest('GET', '/gmail/v1/users/me/profile');
      return this.connected();
    } catch {
      return { ...this.notConfigured(), status: 'disconnected' };
    }
  }

  async listMessages(query = '', maxResults = 20): Promise<NormalizedEmail[]> {
    const params = new URLSearchParams({
      maxResults: String(maxResults),
      ...(query ? { q: query } : {}),
    });
    const data = await this.authenticatedRequest(
      'GET',
      `/gmail/v1/users/me/messages?${params}`,
    ) as { messages?: { id: string }[] };

    const ids = (data.messages ?? []).slice(0, maxResults);
    const emails = await Promise.all(ids.map(m => this.getMessage(m.id)));
    return emails;
  }

  async getMessage(messageId: string): Promise<NormalizedEmail> {
    const data = await this.authenticatedRequest(
      'GET',
      `/gmail/v1/users/me/messages/${messageId}?format=full`,
    ) as GmailMessage;
    return this.normalize(data);
  }

  async sendMessage(
    to: string[],
    subject: string,
    body: string,
    cc: string[] = [],
  ): Promise<{ messageId: string }> {
    const raw = this.buildRfc822(to, subject, body, cc);
    const data = await this.authenticatedRequest('POST', '/gmail/v1/users/me/messages/send', {
      raw: Buffer.from(raw).toString('base64url'),
    }) as { id: string };
    return { messageId: data.id };
  }

  async createDraft(
    to: string[],
    subject: string,
    body: string,
  ): Promise<{ draftId: string }> {
    const raw = this.buildRfc822(to, subject, body);
    const data = await this.authenticatedRequest('POST', '/gmail/v1/users/me/drafts', {
      message: { raw: Buffer.from(raw).toString('base64url') },
    }) as { id: string };
    return { draftId: data.id };
  }

  async modifyMessage(
    messageId: string,
    addLabels: string[] = [],
    removeLabels: string[] = [],
  ): Promise<void> {
    await this.authenticatedRequest(
      'POST',
      `/gmail/v1/users/me/messages/${messageId}/modify`,
      { addLabelIds: addLabels, removeLabelIds: removeLabels },
    );
  }

  protected override async handleUnauthorized(): Promise<void> {
    const refreshToken = await this.vault.retrieve(IntegrationId.GMAIL, 'refresh_token');
    if (!refreshToken) throw new IntegrationError(IntegrationId.GMAIL, 'No refresh token', 401, false);

    const clientId = process.env.CLAW_GMAIL_CLIENT_ID ?? '';
    const clientSecret = process.env.CLAW_GMAIL_CLIENT_SECRET ?? '';

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const tokens = await response.json() as { access_token?: string; expires_in?: number };
    if (tokens.access_token) {
      await this.vault.store(IntegrationId.GMAIL, 'access_token', tokens.access_token);
      if (tokens.expires_in) {
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
        await this.vault.store(IntegrationId.GMAIL, 'expires_at', expiresAt);
      }
    }
  }

  private normalize(msg: GmailMessage): NormalizedEmail {
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const fromRaw = getHeader('From');
    const from = this.parseEmailAddress(fromRaw);
    const toRaw = getHeader('To');
    const to = toRaw.split(',').map(a => this.parseEmailAddress(a.trim()));
    const cc = getHeader('Cc').split(',').filter(Boolean).map(a => this.parseEmailAddress(a.trim()));

    const body = this.extractBody(msg.payload);

    return {
      messageId: msg.id,
      threadId: msg.threadId ?? '',
      from,
      to,
      cc,
      subject: getHeader('Subject'),
      bodyText: body.text,
      bodyHtml: body.html,
      attachments: [],
      receivedAt: new Date(parseInt(msg.internalDate ?? '0', 10)).toISOString(),
      labels: msg.labelIds ?? [],
    };
  }

  private parseEmailAddress(raw: string): { name: string; email: string } {
    const match = raw.match(/^(.*?)\s*<(.+?)>$/);
    if (match) return { name: match[1]?.trim() ?? '', email: match[2]?.trim() ?? '' };
    return { name: '', email: raw.trim() };
  }

  private extractBody(payload?: GmailMessagePayload): { text: string; html: string } {
    if (!payload) return { text: '', html: '' };
    let text = '';
    let html = '';

    const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf-8');

    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      text = decode(payload.body.data);
    } else if (payload.mimeType === 'text/html' && payload.body?.data) {
      html = decode(payload.body.data);
    } else if (payload.parts) {
      for (const part of payload.parts) {
        const sub = this.extractBody(part);
        text = text || sub.text;
        html = html || sub.html;
      }
    }

    return { text, html };
  }

  private buildRfc822(to: string[], subject: string, body: string, cc: string[] = []): string {
    const lines = [
      `To: ${to.join(', ')}`,
      ...(cc.length > 0 ? [`Cc: ${cc.join(', ')}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ];
    return lines.join('\r\n');
  }
}

// ─── Gmail API Types ───

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailMessagePayload;
}

interface GmailMessagePayload {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePayload[];
}
