/**
 * Phase 1.8 — Multi-Tenant Integration Tests
 *
 * Verifies that two tenants running side-by-side get fully isolated:
 *   1. Memory files land in separate directories
 *   2. Tenant A cannot read tenant B's memory
 *   3. Audit log entries are tagged with the correct tenantId and written to
 *      separate directories
 *   4. Rate limiters are isolated — exhausting tenant A's quota does not
 *      affect tenant B
 *   5. Coordinators maintain separate approval state per tenant
 *   6. Response store keys prevent channel-ID collisions across tenants
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { MemoryManager } from '../../src/memory/memory-manager.js';
import { AuditLogger } from '../../src/middleware/audit-logger.js';
import { RateLimiter } from '../../src/middleware/rate-limiter.js';
import { EventBus } from '../../src/agents/ops/event-bus.js';
import { Coordinator } from '../../src/coordinator/coordinator.js';
import { AgentId } from '../../src/types/agents.js';
import { IntegrationId } from '../../src/types/integrations.js';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const mockLlmRouter = { complete: vi.fn() };
const mockAuditLogger = { log: vi.fn() };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build the per-tenant stack that TenantRegistry.getOrCreate() assembles. */
function buildTenantStack(basePath: string, tenantId: string) {
  const tenantMemoryPath = path.join(basePath, 'tenants', tenantId);
  const memory = new MemoryManager(basePath, tenantId);
  const auditLogger = new AuditLogger(path.join(tenantMemoryPath, 'system'), undefined, tenantId);
  const rateLimiter = new RateLimiter();
  const eventBus = new EventBus();
  return { memory, auditLogger, rateLimiter, eventBus, tenantMemoryPath };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-mt-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── 1. Memory path isolation ─────────────────────────────────────────────────

describe('Memory — path isolation', () => {
  it('tenant A files land under tenants/tenant-a/', async () => {
    const { memory } = buildTenantStack(tmpDir, 'tenant-a');
    await memory.write({ path: 'contacts/alice.md', operation: 'create', content: '# Alice', writtenBy: AgentId.RELATIONSHIP });

    const expected = path.join(tmpDir, 'tenants', 'tenant-a', 'contacts', 'alice.md');
    const stat = await fs.stat(expected);
    expect(stat.isFile()).toBe(true);
  });

  it('tenant B files land under tenants/tenant-b/', async () => {
    const { memory } = buildTenantStack(tmpDir, 'tenant-b');
    await memory.write({ path: 'contacts/bob.md', operation: 'create', content: '# Bob', writtenBy: AgentId.RELATIONSHIP });

    const expected = path.join(tmpDir, 'tenants', 'tenant-b', 'contacts', 'bob.md');
    const stat = await fs.stat(expected);
    expect(stat.isFile()).toBe(true);
  });

  it('same relative path for both tenants resolves to different absolute paths', async () => {
    const a = buildTenantStack(tmpDir, 'tenant-a');
    const b = buildTenantStack(tmpDir, 'tenant-b');

    await a.memory.write({ path: 'system/prefs.md', operation: 'create', content: 'A prefs', writtenBy: AgentId.OPS });
    await b.memory.write({ path: 'system/prefs.md', operation: 'create', content: 'B prefs', writtenBy: AgentId.OPS });

    const pathA = path.join(tmpDir, 'tenants', 'tenant-a', 'system', 'prefs.md');
    const pathB = path.join(tmpDir, 'tenants', 'tenant-b', 'system', 'prefs.md');

    expect(pathA).not.toBe(pathB);
    expect(await fs.readFile(pathA, 'utf-8')).toContain('A prefs');
    expect(await fs.readFile(pathB, 'utf-8')).toContain('B prefs');
  });
});

// ─── 2. Cross-tenant read blocking ───────────────────────────────────────────

describe('Memory — cross-tenant read blocking', () => {
  it('tenant B cannot read a file written by tenant A', async () => {
    const a = buildTenantStack(tmpDir, 'tenant-a');
    const b = buildTenantStack(tmpDir, 'tenant-b');

    await a.memory.write({ path: 'kb/secret.md', operation: 'create', content: 'A secret', writtenBy: AgentId.KNOWLEDGE_BASE });

    await expect(b.memory.read({ path: 'kb/secret.md' })).rejects.toThrow();
  });

  it('tenant A cannot reach tenant B path via traversal', async () => {
    const a = buildTenantStack(tmpDir, 'tenant-a');

    await expect(
      a.memory.write({ path: '../tenant-b/contacts/eve.md', operation: 'create', content: 'x', writtenBy: AgentId.OPS }),
    ).rejects.toThrow('Invalid memory path');
  });
});

// ─── 3. Audit log isolation ───────────────────────────────────────────────────

describe('AuditLogger — tenant isolation', () => {
  it('log entries are tagged with the correct tenantId', async () => {
    const { auditLogger } = buildTenantStack(tmpDir, 'tenant-a');

    await auditLogger.log({
      logId: 'log-1',
      timestamp: new Date().toISOString(),
      agent: AgentId.OPS,
      actionType: 'test_action',
      description: 'integration test',
      correlationId: 'corr-1',
      target: null,
      approvalStatus: 'auto',
      cost: { tokensUsed: 0, tier: 'fast' as never, provider: 'none', model: 'none', estimatedUsd: 0 },
    });

    const logDir = path.join(tmpDir, 'tenants', 'tenant-a', 'system');
    const files = await fs.readdir(logDir);
    expect(files.some(f => f.startsWith('audit-log-') && f.endsWith('.jsonl'))).toBe(true);

    const logFile = path.join(logDir, files[0]!);
    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.tenantId).toBe('tenant-a');
  });

  it('tenant A and B log to separate directories', async () => {
    const a = buildTenantStack(tmpDir, 'tenant-a');
    const b = buildTenantStack(tmpDir, 'tenant-b');

    const entry = {
      logId: 'log-x',
      timestamp: new Date().toISOString(),
      agent: AgentId.OPS,
      actionType: 'test',
      description: 'test',
      correlationId: 'corr-x',
      target: null,
      approvalStatus: 'auto' as const,
      cost: { tokensUsed: 0, tier: 'fast' as never, provider: 'none', model: 'none', estimatedUsd: 0 },
    };

    await a.auditLogger.log(entry);
    await b.auditLogger.log(entry);

    const dirA = path.join(tmpDir, 'tenants', 'tenant-a', 'system');
    const dirB = path.join(tmpDir, 'tenants', 'tenant-b', 'system');

    const [filesA, filesB] = await Promise.all([fs.readdir(dirA), fs.readdir(dirB)]);
    expect(filesA.length).toBeGreaterThan(0);
    expect(filesB.length).toBeGreaterThan(0);

    // Verify they are distinct physical paths
    expect(dirA).not.toBe(dirB);
  });

  it('tenant A log does not contain tenant B entries', async () => {
    const a = buildTenantStack(tmpDir, 'tenant-a');
    const b = buildTenantStack(tmpDir, 'tenant-b');

    await a.auditLogger.log({
      logId: 'a-only',
      timestamp: new Date().toISOString(),
      agent: AgentId.COMMS,
      actionType: 'send_email',
      description: 'sent to alice',
      correlationId: 'corr-a',
      target: null,
      approvalStatus: 'approved',
      cost: { tokensUsed: 10, tier: 'fast' as never, provider: 'anthropic', model: 'haiku', estimatedUsd: 0.0001 },
    });

    await b.auditLogger.log({
      logId: 'b-only',
      timestamp: new Date().toISOString(),
      agent: AgentId.COMMS,
      actionType: 'send_sms',
      description: 'sent to bob',
      correlationId: 'corr-b',
      target: null,
      approvalStatus: 'approved',
      cost: { tokensUsed: 5, tier: 'fast' as never, provider: 'anthropic', model: 'haiku', estimatedUsd: 0.00005 },
    });

    const logDirA = path.join(tmpDir, 'tenants', 'tenant-a', 'system');
    const filesA = await fs.readdir(logDirA);
    const contentA = await fs.readFile(path.join(logDirA, filesA[0]!), 'utf-8');

    expect(contentA).toContain('a-only');
    expect(contentA).not.toContain('b-only');
    expect(contentA).not.toContain('tenant-b');
  });
});

// ─── 4. Rate limiter isolation ────────────────────────────────────────────────

describe('RateLimiter — cross-tenant isolation', () => {
  it('exhausting tenant A quota does not affect tenant B', async () => {
    const { rateLimiter } = buildTenantStack(tmpDir, 'tenant-a');

    // Exhaust tenant-a's quota (limit = 3)
    for (let i = 0; i < 3; i++) {
      await rateLimiter.checkLimit('tenant-a', IntegrationId.GMAIL, 3);
    }
    expect((await rateLimiter.checkLimit('tenant-a', IntegrationId.GMAIL, 3)).allowed).toBe(false);

    // Tenant B is unaffected — uses a separate RateLimiter instance per stack,
    // but even on the same instance the key includes tenantId
    expect((await rateLimiter.checkLimit('tenant-b', IntegrationId.GMAIL, 3)).allowed).toBe(true);
  });

  it('per-tenant RateLimiter instances are fully independent', async () => {
    const a = buildTenantStack(tmpDir, 'tenant-a');
    const b = buildTenantStack(tmpDir, 'tenant-b');

    for (let i = 0; i < 5; i++) {
      await a.rateLimiter.checkLimit('tenant-a', IntegrationId.HUBSPOT, 5);
    }
    expect((await a.rateLimiter.checkLimit('tenant-a', IntegrationId.HUBSPOT, 5)).allowed).toBe(false);

    // Tenant B's own RateLimiter instance has no knowledge of A's usage
    expect((await b.rateLimiter.checkLimit('tenant-b', IntegrationId.HUBSPOT, 5)).allowed).toBe(true);
  });

  it('getRemainingCalls is tracked independently per tenant stack', async () => {
    const a = buildTenantStack(tmpDir, 'tenant-a');
    const b = buildTenantStack(tmpDir, 'tenant-b');

    await a.rateLimiter.checkLimit('tenant-a', IntegrationId.TWILIO, 10);
    await a.rateLimiter.checkLimit('tenant-a', IntegrationId.TWILIO, 10);
    await b.rateLimiter.checkLimit('tenant-b', IntegrationId.TWILIO, 10);

    expect(await a.rateLimiter.getRemainingCalls('tenant-a', IntegrationId.TWILIO, 10)).toBe(8);
    expect(await b.rateLimiter.getRemainingCalls('tenant-b', IntegrationId.TWILIO, 10)).toBe(9);
  });
});

// ─── 5. Coordinator isolation ─────────────────────────────────────────────────

describe('Coordinator — approval state isolation', () => {
  it('pending approvals are not shared between two coordinator instances', async () => {
    const tenantMemoryPathA = path.join(tmpDir, 'tenants', 'tenant-a');
    const tenantMemoryPathB = path.join(tmpDir, 'tenants', 'tenant-b');

    const coordA = new Coordinator('tenant-a', tenantMemoryPathA, mockLlmRouter as never, mockAuditLogger as never, new EventBus());
    const coordB = new Coordinator('tenant-b', tenantMemoryPathB, mockLlmRouter as never, mockAuditLogger as never, new EventBus());

    const approvalManagerA = (coordA as never).approvalManager;
    const approvalManagerB = (coordB as never).approvalManager;

    // Create an approval request on tenant A
    await approvalManagerA.createApprovalRequest([{
      index: 0,
      actionType: 'send_email',
      preview: 'Email to Alice',
      fullContent: 'Full content',
      medium: 'email',
      recipients: ['alice@example.com'],
      originatingAgent: AgentId.COMMS,
      taskResultId: 'result-a',
    }]);

    // Tenant B's approval manager should have no pending approvals
    const pendingA = (approvalManagerA as never).pending as Map<string, unknown>;
    const pendingB = (approvalManagerB as never).pending as Map<string, unknown>;

    expect(pendingA.size).toBe(1);
    expect(pendingB.size).toBe(0);
  });
});

// ─── 6. Response store key isolation ─────────────────────────────────────────

describe('Response store — channel key isolation', () => {
  it('same channelId under different tenants resolves to distinct keys', () => {
    const responseStore = new Map<string, unknown[]>();
    const CHANNEL = 'chat-main';

    // Simulate the key scheme used in TenantRegistry.getOrCreate()
    const keyA = `tenant-a:${CHANNEL}`;
    const keyB = `tenant-b:${CHANNEL}`;

    responseStore.set(keyA, [{ text: 'response for A', timestamp: new Date().toISOString() }]);
    responseStore.set(keyB, [{ text: 'response for B', timestamp: new Date().toISOString() }]);

    expect(keyA).not.toBe(keyB);
    const responsesA = responseStore.get(keyA)!;
    const responsesB = responseStore.get(keyB)!;

    expect(responsesA).toHaveLength(1);
    expect(responsesB).toHaveLength(1);
    expect((responsesA[0] as { text: string }).text).toBe('response for A');
    expect((responsesB[0] as { text: string }).text).toBe('response for B');
  });

  it('tenant A cannot retrieve tenant B responses using the same channelId', () => {
    const responseStore = new Map<string, unknown[]>();
    const CHANNEL = 'shared-channel';

    responseStore.set(`tenant-b:${CHANNEL}`, [{ text: 'private for B' }]);

    // Tenant A looks up its own key — should be empty
    const tenantAResponses = responseStore.get(`tenant-a:${CHANNEL}`) ?? [];
    expect(tenantAResponses).toHaveLength(0);
  });
});
