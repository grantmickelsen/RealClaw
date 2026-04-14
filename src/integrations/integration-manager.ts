import fs from 'fs/promises';
import type { IntegrationConfig, IntegrationStatus } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';
import type { CredentialVault } from '../credentials/vault.js';
import type { IRateLimiter } from '../middleware/rate-limiter.js';
import type { AuditLogger } from '../middleware/audit-logger.js';
import type { BaseIntegration } from './base-integration.js';
import { GmailIntegration } from './gmail.js';
import { GoogleCalendarIntegration } from './google-calendar.js';
import { HubSpotIntegration } from './hubspot.js';
import { TwilioIntegration } from './twilio.js';
import { RentCastIntegration } from './rentcast.js';

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

interface IntegrationsConfig {
  integrations: IntegrationConfig[];
}

export class IntegrationManager {
  private readonly configs: Map<IntegrationId, IntegrationConfig>;
  private readonly vault: CredentialVault;
  private readonly rateLimiter: IRateLimiter;
  private readonly auditLogger: AuditLogger;
  private readonly cache = new Map<IntegrationId, BaseIntegration>();

  private readonly tenantId: string;

  constructor(
    configs: IntegrationConfig[],
    vault: CredentialVault,
    rateLimiter: IRateLimiter,
    auditLogger: AuditLogger,
    tenantId = 'default',
  ) {
    this.configs = new Map(configs.map(c => [c.id, c]));
    this.vault = vault;
    this.rateLimiter = rateLimiter;
    this.auditLogger = auditLogger;
    this.tenantId = tenantId;
  }

  static async fromConfigFile(
    configPath: string,
    vault: CredentialVault,
    rateLimiter: IRateLimiter,
    auditLogger: AuditLogger,
    tenantId = 'default',
  ): Promise<IntegrationManager> {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as IntegrationsConfig;
    return new IntegrationManager(parsed.integrations, vault, rateLimiter, auditLogger, tenantId);
  }

  /** Lazily constructs and caches. Returns null if disabled or unimplemented. */
  getIntegration<T extends BaseIntegration>(id: IntegrationId): T | null {
    const config = this.configs.get(id);
    if (!config?.enabled) return null;

    const cached = this.cache.get(id);
    if (cached) return cached as T;

    const instance = this.buildIntegration(config);
    if (!instance) return null;

    this.cache.set(id, instance);
    return instance as T;
  }

  /** Calls healthCheck() on all enabled integrations with a 5-second timeout each. */
  async getStatus(): Promise<IntegrationStatus[]> {
    const statuses: IntegrationStatus[] = [];

    for (const config of this.configs.values()) {
      if (!config.enabled) continue;

      const integration = this.getIntegration(config.id);
      if (!integration) continue;

      const timeout = new Promise<IntegrationStatus>(resolve =>
        setTimeout(
          () => resolve({
            id: config.id,
            status: 'disconnected',
            lastSuccessfulCall: null,
            lastError: 'Health check timed out',
            rateLimitRemaining: 0,
            tokenExpiresAt: null,
          }),
          HEALTH_CHECK_TIMEOUT_MS,
        ),
      );

      try {
        const status = await Promise.race([
          integration.healthCheck(),
          timeout,
        ]);
        statuses.push(status);
      } catch {
        statuses.push({
          id: config.id,
          status: 'disconnected',
          lastSuccessfulCall: null,
          lastError: 'Health check threw an exception',
          rateLimitRemaining: 0,
          tokenExpiresAt: null,
        });
      }
    }

    return statuses;
  }

  isEnabled(id: IntegrationId): boolean {
    return this.configs.get(id)?.enabled ?? false;
  }

  private buildIntegration(config: IntegrationConfig): BaseIntegration | null {
    const args = [config, this.vault, this.rateLimiter, this.auditLogger, this.tenantId] as const;
    switch (config.id) {
      case IntegrationId.GMAIL:            return new GmailIntegration(...args);
      case IntegrationId.GOOGLE_CALENDAR:  return new GoogleCalendarIntegration(...args);
      case IntegrationId.HUBSPOT:          return new HubSpotIntegration(...args);
      case IntegrationId.TWILIO:           return new TwilioIntegration(...args);
      case IntegrationId.RENTCAST:         return new RentCastIntegration(...args);
      default:                             return null;
    }
  }
}
