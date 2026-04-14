import { query } from './postgres.js';

/**
 * Ensures a tenant row exists in the tenants table.
 * Safe to call multiple times — ON CONFLICT DO NOTHING is idempotent.
 * Must be called before any FK-constrained writes (approvals, device tokens, messages).
 */
export async function upsertTenant(tenantId: string, name?: string): Promise<void> {
  const safeName = (name ?? tenantId).slice(0, 255);
  await query(
    `INSERT INTO tenants (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, safeName],
  );
}
