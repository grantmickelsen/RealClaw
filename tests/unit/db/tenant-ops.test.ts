import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock postgres.js before importing tenant-ops
vi.mock('../../../src/db/postgres.js', () => ({
  query: vi.fn(),
}));

import { upsertTenant } from '../../../src/db/tenant-ops.js';
import { query } from '../../../src/db/postgres.js';

const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('upsertTenant', () => {
  it('executes an INSERT ... ON CONFLICT DO NOTHING query', async () => {
    await upsertTenant('tenant-abc');

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO tenants');
    expect(sql).toContain('ON CONFLICT');
    expect(params).toContain('tenant-abc');
  });

  it('uses tenantId as name when name is not provided', async () => {
    await upsertTenant('tenant-xyz');

    const [, params] = mockQuery.mock.calls[0]!;
    expect(params![0]).toBe('tenant-xyz');
    expect(params![1]).toBe('tenant-xyz'); // name defaults to tenantId
  });

  it('uses the provided name when given', async () => {
    await upsertTenant('tenant-123', 'Acme Realty');

    const [, params] = mockQuery.mock.calls[0]!;
    expect(params![1]).toBe('Acme Realty');
  });

  it('truncates name to 255 characters', async () => {
    const longName = 'A'.repeat(300);
    await upsertTenant('tenant-long', longName);

    const [, params] = mockQuery.mock.calls[0]!;
    expect((params![1] as string).length).toBe(255);
  });

  it('is idempotent — does not throw on duplicate tenantId', async () => {
    // ON CONFLICT DO NOTHING — second call should silently succeed
    await upsertTenant('tenant-dup');
    await upsertTenant('tenant-dup');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
