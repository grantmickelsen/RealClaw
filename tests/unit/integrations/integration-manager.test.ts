import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IntegrationManager } from '../../../src/integrations/integration-manager.js';
import { IntegrationId } from '../../../src/types/integrations.js';
import type { IntegrationConfig, IntegrationStatus } from '../../../src/types/integrations.js';
import type { CredentialVault } from '../../../src/credentials/vault.js';
import type { IRateLimiter } from '../../../src/middleware/rate-limiter.js';
import type { AuditLogger } from '../../../src/middleware/audit-logger.js';

// ─── Minimal stubs ───

const mockVault = {} as unknown as CredentialVault;
const mockRateLimiter = {} as unknown as IRateLimiter;
const mockAuditLogger = { log: vi.fn() } as unknown as AuditLogger;

function makeConfig(id: IntegrationId, enabled: boolean): IntegrationConfig {
  return {
    id,
    authMethod: 'oauth2',
    owningAgent: 'comms' as never,
    baseUrl: 'https://example.com',
    rateLimitPerMinute: 60,
    enabled,
  };
}

const connectedStatus: IntegrationStatus = {
  id: IntegrationId.GMAIL,
  status: 'connected',
  lastSuccessfulCall: new Date().toISOString(),
  lastError: null,
  rateLimitRemaining: 60,
  tokenExpiresAt: null,
};

describe('IntegrationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for disabled integrations', () => {
    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, false)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );
    expect(manager.getIntegration(IntegrationId.GMAIL)).toBeNull();
  });

  it('returns null for unimplemented integration ids', () => {
    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.CRMLS, true)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );
    expect(manager.getIntegration(IntegrationId.CRMLS)).toBeNull();
  });

  it('lazily constructs and caches (constructor called once on two calls)', async () => {
    const { GmailIntegration } = await import('../../../src/integrations/gmail.js');
    const constructorSpy = vi.spyOn(GmailIntegration.prototype, 'healthCheck').mockResolvedValue(connectedStatus);

    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, true)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );

    const first = manager.getIntegration(IntegrationId.GMAIL);
    const second = manager.getIntegration(IntegrationId.GMAIL);

    expect(first).toBe(second);  // same instance
    constructorSpy.mockRestore();
  });

  it('getStatus() maps healthCheck results to correct IntegrationStatus', async () => {
    const { GmailIntegration } = await import('../../../src/integrations/gmail.js');
    vi.spyOn(GmailIntegration.prototype, 'healthCheck').mockResolvedValue(connectedStatus);

    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, true)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );

    const statuses = await manager.getStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].id).toBe(IntegrationId.GMAIL);
    expect(statuses[0].status).toBe('connected');
  });

  it('getStatus() returns disconnected when healthCheck throws', async () => {
    const { GmailIntegration } = await import('../../../src/integrations/gmail.js');
    vi.spyOn(GmailIntegration.prototype, 'healthCheck').mockRejectedValue(new Error('network error'));

    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, true)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );

    const statuses = await manager.getStatus();
    expect(statuses[0].status).toBe('disconnected');
  });

  it('getStatus() returns disconnected on timeout', async () => {
    vi.useFakeTimers();

    const { GmailIntegration } = await import('../../../src/integrations/gmail.js');
    vi.spyOn(GmailIntegration.prototype, 'healthCheck').mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(connectedStatus), 60_000)),
    );

    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, true)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );

    const statusPromise = manager.getStatus();
    vi.advanceTimersByTime(6_000);  // past the 5s timeout
    const statuses = await statusPromise;

    expect(statuses[0].status).toBe('disconnected');
    expect(statuses[0].lastError).toContain('timed out');

    vi.useRealTimers();
  });

  it('isEnabled() returns true for enabled integrations', () => {
    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, true)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );
    expect(manager.isEnabled(IntegrationId.GMAIL)).toBe(true);
  });

  it('isEnabled() returns false for disabled integrations', () => {
    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, false)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );
    expect(manager.isEnabled(IntegrationId.GMAIL)).toBe(false);
  });

  it('isEnabled() returns false for unknown integrations', () => {
    const manager = new IntegrationManager([], mockVault, mockRateLimiter, mockAuditLogger);
    expect(manager.isEnabled(IntegrationId.GMAIL)).toBe(false);
  });

  it('getStatus() skips disabled integrations', async () => {
    const manager = new IntegrationManager(
      [makeConfig(IntegrationId.GMAIL, false)],
      mockVault, mockRateLimiter, mockAuditLogger,
    );
    const statuses = await manager.getStatus();
    expect(statuses).toHaveLength(0);
  });
});
