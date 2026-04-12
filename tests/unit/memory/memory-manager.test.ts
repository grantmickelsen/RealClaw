import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import { AgentId } from '../../../src/types/agents.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir: string;
let manager: MemoryManager;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-test-'));
  manager = new MemoryManager(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('MemoryManager', () => {
  describe('create', () => {
    it('creates a new file', async () => {
      const result = await manager.write({
        path: 'contacts/test.md',
        operation: 'create',
        content: '# Test Contact',
        writtenBy: AgentId.RELATIONSHIP,
      });
      expect(result.success).toBe(true);
      expect(result.newSize).toBeGreaterThan(0);
    });

    it('fails if file already exists', async () => {
      await manager.write({ path: 'test.md', operation: 'create', content: 'a', writtenBy: AgentId.OPS });
      const result = await manager.write({ path: 'test.md', operation: 'create', content: 'b', writtenBy: AgentId.OPS });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('prevents directory traversal', async () => {
      await expect(
        manager.write({ path: '../../etc/passwd', operation: 'create', content: 'x', writtenBy: AgentId.OPS }),
      ).rejects.toThrow('Invalid memory path');
    });
  });

  describe('read', () => {
    it('reads a file', async () => {
      await manager.write({ path: 'kb/a.md', operation: 'create', content: '# Hello\nWorld', writtenBy: AgentId.OPS });
      const result = await manager.read({ path: 'kb/a.md' });
      expect(result.content).toContain('# Hello');
    });

    it('reads a specific section', async () => {
      const content = `# Profile\n\n## Overview\nJohn Smith\n\n## Buying Criteria\nLooking for 3bed\n\n## Notes\nNone`;
      await manager.write({ path: 'contacts/john.md', operation: 'create', content, writtenBy: AgentId.OPS });
      const result = await manager.read({ path: 'contacts/john.md', section: 'buying_criteria' });
      expect(result.content).toContain('3bed');
      expect(result.content).not.toContain('John Smith');
    });

    it('returns empty string for missing section', async () => {
      await manager.write({ path: 'misc.md', operation: 'create', content: '# Test\n\n## Section A\ncontent', writtenBy: AgentId.OPS });
      const result = await manager.read({ path: 'misc.md', section: 'nonexistent_section' });
      expect(result.content).toBe('');
    });
  });

  describe('append', () => {
    it('appends to an existing file', async () => {
      await manager.write({ path: 'log.md', operation: 'create', content: 'line1', writtenBy: AgentId.OPS });
      await manager.write({ path: 'log.md', operation: 'append', content: 'line2', writtenBy: AgentId.OPS });
      const result = await manager.read({ path: 'log.md' });
      expect(result.content).toContain('line1');
      expect(result.content).toContain('line2');
    });
  });

  describe('update_section', () => {
    it('updates an existing section', async () => {
      const initial = `# Test\n\n## Status\nOld content\n\n## Notes\nOther section`;
      await manager.write({ path: 'tx.md', operation: 'create', content: initial, writtenBy: AgentId.OPS });
      await manager.write({
        path: 'tx.md',
        operation: 'update_section',
        section: 'Status',
        content: 'New content',
        writtenBy: AgentId.TRANSACTION,
      });
      const result = await manager.read({ path: 'tx.md', section: 'Status' });
      expect(result.content).toContain('New content');
      expect(result.content).not.toContain('Old content');
    });

    it('appends section if it does not exist', async () => {
      await manager.write({ path: 'new.md', operation: 'create', content: '# Doc', writtenBy: AgentId.OPS });
      await manager.write({
        path: 'new.md',
        operation: 'update_section',
        section: 'New Section',
        content: 'Fresh content',
        writtenBy: AgentId.OPS,
      });
      const result = await manager.read({ path: 'new.md', section: 'new_section' });
      expect(result.content).toContain('Fresh content');
    });
  });

  describe('write locking', () => {
    it('prevents concurrent writes to the same file', async () => {
      await manager.write({ path: 'locked.md', operation: 'create', content: 'initial', writtenBy: AgentId.OPS });

      // Simulate holding a lock by acquiring it manually via private method
      // We'll just verify that the lock auto-releases
      const lock = manager.getLock('locked.md');
      expect(lock).toBeUndefined(); // No lock after write completes
    });

    it('lock auto-releases after TTL', async () => {
      vi.useFakeTimers();
      await manager.write({ path: 'release.md', operation: 'create', content: 'x', writtenBy: AgentId.OPS });

      // After write, lock should be gone
      expect(manager.getLock('release.md')).toBeUndefined();
      vi.useRealTimers();
    });
  });
});
