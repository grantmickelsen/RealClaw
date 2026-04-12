import { BaseIntegration } from './base-integration.js';
import type { IntegrationStatus } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';

export class TwilioIntegration extends BaseIntegration {
  private get accountSid(): string {
    return process.env.CLAW_TWILIO_ACCOUNT_SID ?? '';
  }

  async healthCheck(): Promise<IntegrationStatus> {
    const sid = this.accountSid;
    if (!sid) return this.notConfigured();
    try {
      await this.authenticatedRequest('GET', `/2010-04-01/Accounts/${sid}.json`);
      return this.connected();
    } catch {
      return { ...this.notConfigured(), status: 'disconnected' };
    }
  }

  async sendSms(to: string, body: string): Promise<{ messageSid: string }> {
    const from = process.env.CLAW_TWILIO_PHONE_NUMBER ?? '';
    if (!from) throw new Error('CLAW_TWILIO_PHONE_NUMBER not configured');

    const formData = new URLSearchParams({ To: to, From: from, Body: body });
    const data = await this.authenticatedRequest(
      'POST',
      `/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      formData,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    ) as { sid: string };

    return { messageSid: data.sid };
  }

  async listMessages(to?: string, from?: string, limit = 20): Promise<TwilioMessage[]> {
    const params = new URLSearchParams({ PageSize: String(limit) });
    if (to) params.set('To', to);
    if (from) params.set('From', from);

    const data = await this.authenticatedRequest(
      'GET',
      `/2010-04-01/Accounts/${this.accountSid}/Messages.json?${params}`,
    ) as { messages?: TwilioMessage[] };

    return data.messages ?? [];
  }

  protected override async buildAuthHeaders(): Promise<Record<string, string>> {
    const sid = this.accountSid;
    const token = process.env.CLAW_TWILIO_AUTH_TOKEN ?? '';
    const encoded = Buffer.from(`${sid}:${token}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
}

interface TwilioMessage {
  sid: string;
  to: string;
  from: string;
  body: string;
  status: string;
  dateSent: string;
}
