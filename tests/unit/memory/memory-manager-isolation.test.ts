import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import { AgentId } from '../../../src/types/agents.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-isolation-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── Tenant-scoped path structure ────────────────────────────────────────────

describe('MemoryManager (tenant-scoped)', () => {
  it('stores files under basePath/tenants/{tenantId}/', async () => {
    const manager = new MemoryManager(tmpDir, 'tenant-a');
    await manager.write({ path: 'contacts/john.md', operation: 'create', content: '# John', writtenBy: AgentId.RELATIONSHIP });

    const expectedPath = path.join(tmpDir, 'tenants', 'tenant-a', 'contacts', 'john.md');
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it('resolves reads from tenant-scoped path', async () => {
    const manager = new MemoryManager(tmpDir, 'tenant-a');
    await manager.write({ path: 'kb/note.md', operation: 'create', content: '# Note\nHello', writtenBy: AgentId.OPS });
    const result = await manager.read({ path: 'kb/note.md' });
    expect(result.content).toContain('Hello');
  });
});

// ─── Cross-tenant isolation ───────────────────────────────────────────────────

describe('Cross-tenant isolation', () => {
  it('tenant A write is not visible to tenant B', async () => {
    const managerA = new MemoryManager(tmpDir, 'tenant-a');
    const managerB = new MemoryManager(tmpDir, 'tenant-b');

    await managerA.write({ path: 'contacts/alice.md', operation: 'create', content: '# Alice', writtenBy: AgentId.RELATIONSHIP });

    // Tenant B should not find the file — it lives in tenant-a's directory
    await expect(managerB.read({ path: 'contacts/alice.md' })).rejects.toThrow();
  });

  it('tenant A and B can write the same relative path independently', async () => {
    const managerA = new MemoryManager(tmpDir, 'tenant-a');
    const managerB = new MemoryManager(tmpDir, 'tenant-b');

    await managerA.write({ path: 'system/config.md', operation: 'create', content: 'tenant A config', writtenBy: AgentId.OPS });
    await managerB.write({ path: 'system/config.md', operation: 'create', content: 'tenant B config', writtenBy: AgentId.OPS });

    const resultA = await managerA.read({ path: 'system/config.md' });
    const resultB = await managerB.read({ path: 'system/config.md' });

    expect(resultA.content).toContain('tenant A config');
    expect(resultB.content).toContain('tenant B config');
  });
});

// ─── Cross-tenant traversal attacks ──────────────────────────────────────────

describe('Path traversal guard (tenant-scoped)', () => {
  it('blocks ../  escape from tenant directory', async () => {
    const manager = new MemoryManager(tmpDir, 'tenant-a');
    await expect(
      manager.write({ path: '../../etc/passwd', operation: 'create', content: 'x', writtenBy: AgentId.OPS }),
    ).rejects.toThrow('Invalid memory path');
  });

  it('blocks attempt to reach another tenant via traversal', async () => {
    const manager = new MemoryManager(tmpDir, 'tenant-a');
    await expect(
      manager.write({ path: '../tenant-b/contacts/bob.md', operation: 'create', content: 'x', writtenBy: AgentId.OPS }),
    ).rejects.toThrow('Invalid memory path');
  });

  it('blocks traversal that lands exactly on tenant root', async () => {
    const manager = new MemoryManager(tmpDir, 'tenant-a');
    // path.resolve('basePath/tenants/tenant-a', '.') == tenantBase (not inside it)
    await expect(
      manager.write({ path: '.', operation: 'create', content: 'x', writtenBy: AgentId.OPS }),
    ).rejects.toThrow('Invalid memory path');
  });

  it('allows deeply nested paths within tenant directory', async () => {
    const manager = new MemoryManager(tmpDir, 'tenant-a');
    const result = await manager.write({
      path: 'transactions/2024/q1/listing-summary.md',
      operation: 'create',
      content: '# Q1 Summary',
      writtenBy: AgentId.TRANSACTION,
    });
    expect(result.success).toBe(true);
  });
});

// ─── Legacy flat-path behavior (no tenantId) ─────────────────────────────────

describe('MemoryManager (legacy — no tenantId)', () => {
  it('stores files directly under basePath/', async () => {
    const manager = new MemoryManager(tmpDir);
    await manager.write({ path: 'contacts/legacy.md', operation: 'create', content: '# Legacy', writtenBy: AgentId.RELATIONSHIP });

    const expectedPath = path.join(tmpDir, 'contacts', 'legacy.md');
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it('still blocks traversal in legacy mode', async () => {
    const manager = new MemoryManager(tmpDir);
    await expect(
      manager.write({ path: '../../etc/passwd', operation: 'create', content: 'x', writtenBy: AgentId.OPS }),
    ).rejects.toThrow('Invalid memory path');
  });

  it('legacy and tenant-scoped managers do not share paths', async () => {
    const legacy = new MemoryManager(tmpDir);
    const scoped = new MemoryManager(tmpDir, 'tenant-a');

    await legacy.write({ path: 'shared.md', operation: 'create', content: 'legacy content', writtenBy: AgentId.OPS });

    // Scoped manager looks in tenants/tenant-a/shared.md — not in the flat basePath
    await expect(scoped.read({ path: 'shared.md' })).rejects.toThrow();
  });
});
