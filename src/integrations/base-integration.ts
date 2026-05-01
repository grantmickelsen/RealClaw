import type { IntegrationConfig, IntegrationStatus, IntegrationId } from '../types/integrations.js';
import type { CredentialVault } from '../credentials/vault.js';
import type { IRateLimiter } from '../middleware/rate-limiter.js';
import type { AuditLogger } from '../middleware/audit-logger.js';
import type { AgentId } from '../types/agents.js';
import { IntegrationError } from '../utils/errors.js';

const RETRY_DELAY_MS = 2_000;
const RETRY_AFTER_DEFAULT_MS = 60_000;

export abstract class BaseIntegration {
  readonly id: IntegrationId;
  readonly config: IntegrationConfig;
  protected readonly tenantId: string;
  protected readonly vault: CredentialVault;
  protected readonly rateLimiter: IRateLimiter;
  protected readonly auditLogger: AuditLogger;

  constructor(
    config: IntegrationConfig,
    vault: CredentialVault,
    rateLimiter: IRateLimiter,
    auditLogger: AuditLogger,
    tenantId = 'default',
  ) {
    this.id = config.id;
    this.config = config;
    this.tenantId = tenantId;
    this.vault = vault;
    this.rateLimiter = rateLimiter;
    this.auditLogger = auditLogger;
  }

  abstract healthCheck(): Promise<IntegrationStatus>;

  protected async authenticatedRequest(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    // Rate limit check
    const rateCheck = await this.rateLimiter.checkLimit(this.tenantId, this.id, this.config.rateLimitPerMinute);
    if (!rateCheck.allowed) {
      throw new IntegrationError(
        this.id,
        `Rate limit exceeded for ${this.id}. Resets at ${rateCheck.resetsAt}`,
        429,
        true,
      );
    }

    const authHeaders = await this.buildAuthHeaders();
    const url = path.startsWith('http') ? path : `${this.config.baseUrl}${path}`;
    const startMs = Date.now();

    const requestInit: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...headers,
      },
    };

    if (body !== undefined && method !== 'GET') {
      requestInit.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, requestInit);
    } catch (err) {
      await this.logRequest(method, url, null, Date.now() - startMs);
      throw new IntegrationError(this.id, `Network error: ${(err as Error).message}`, null, true);
    }

    const latencyMs = Date.now() - startMs;
    await this.logRequest(method, url, response.status, latencyMs);

    // Handle 401 — attempt one token refresh
    if (response.status === 401) {
      await this.handleUnauthorized();
      const retryHeaders = await this.buildAuthHeaders();
      const retryResponse = await fetch(url, {
        ...requestInit,
        headers: { ...requestInit.headers as Record<string, string>, ...retryHeaders },
      });
      if (!retryResponse.ok) {
        throw new IntegrationError(
          this.id,
          `Authentication failed after refresh: ${retryResponse.status}`,
          retryResponse.status,
          false,
        );
      }
      return retryResponse.json();
    }

    // Handle 429 — respect Retry-After
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') ?? '60', 10) * 1000;
      await this.sleep(Math.min(retryAfter, RETRY_AFTER_DEFAULT_MS));
      return this.authenticatedRequest(method, path, body, headers);
    }

    // Handle 5xx — retry once
    if (response.status >= 500) {
      await this.sleep(RETRY_DELAY_MS);
      const retryResponse = await fetch(url, requestInit);
      if (!retryResponse.ok) {
        throw new IntegrationError(
          this.id,
          `Server error: ${retryResponse.status}`,
          retryResponse.status,
          retryResponse.status >= 500,
        );
      }
      return retryResponse.json();
    }

    if (!response.ok) {
      throw new IntegrationError(
        this.id,
        `Request failed: ${response.status}`,
        response.status,
        false,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  protected async buildAuthHeaders(): Promise<Record<string, string>> {
    const tid = this.tenantId !== 'default' ? this.tenantId : undefined;
    switch (this.config.authMethod) {
      case 'oauth2': {
        const token = await this.vault.retrieve(this.id, 'access_token', tid);
        if (!token) throw new IntegrationError(this.id, 'No access token stored', 401, false);
        return { Authorization: `Bearer ${token}` };
      }
      case 'api_key': {
        const key = await this.vault.retrieve(this.id, 'api_key');
        if (!key) throw new IntegrationError(this.id, 'No API key stored', 401, false);
        return { Authorization: `Bearer ${key}` };
      }
      case 'credentials': {
        const user = await this.vault.retrieve(this.id, 'username');
        const pass = await this.vault.retrieve(this.id, 'password');
        if (!user || !pass) throw new IntegrationError(this.id, 'Credentials not stored', 401, false);
        const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
      }
      case 'local':
        return {};
      default:
        return {};
    }
  }

  protected async handleUnauthorized(): Promise<void> {
    // Subclasses override for OAuth refresh
    throw new IntegrationError(this.id, 'Unauthorized — no refresh handler', 401, false);
  }

  protected async logRequest(
    method: string,
    url: string,
    status: number | null,
    latencyMs: number,
  ): Promise<void> {
    // Log URL (no body/PII) to audit logger
    await this.auditLogger.log({
      logId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      agent: 'ops' as AgentId,
      actionType: 'external_api_call',
      description: `${method} ${url} → ${status ?? 'network_error'} (${latencyMs}ms)`,
      correlationId: '',
      target: null,
      approvalStatus: 'auto',
      cost: { tokensUsed: 0, tier: 'fast' as never, provider: this.id, model: 'none', estimatedUsd: 0 },
    });
  }

  protected notConfigured(): IntegrationStatus {
    return {
      id: this.id,
      status: 'not_configured',
      lastSuccessfulCall: null,
      lastError: null,
      rateLimitRemaining: this.config.rateLimitPerMinute,
      tokenExpiresAt: null,
    };
  }

  protected connected(): IntegrationStatus {
    return {
      id: this.id,
      status: 'connected',
      lastSuccessfulCall: new Date().toISOString(),
      lastError: null,
      rateLimitRemaining: this.config.rateLimitPerMinute, // getRemainingCalls is async; use config default for status snapshot
      tokenExpiresAt: null,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
