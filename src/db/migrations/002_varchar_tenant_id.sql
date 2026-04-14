BEGIN;

-- Drop FK constraints referencing tenants.tenant_id
ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_tenant_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_tenant_id_fkey;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_tenant_id_fkey;
ALTER TABLE tenant_device_tokens DROP CONSTRAINT IF EXISTS tenant_device_tokens_tenant_id_fkey;

-- Remove UUID auto-generation default before type change
ALTER TABLE tenants ALTER COLUMN tenant_id DROP DEFAULT;

-- Change tenant_id from UUID to VARCHAR(255) in all tables
ALTER TABLE tenants ALTER COLUMN tenant_id TYPE VARCHAR(255) USING tenant_id::text;
ALTER TABLE tenant_users ALTER COLUMN tenant_id TYPE VARCHAR(255) USING tenant_id::text;
ALTER TABLE messages ALTER COLUMN tenant_id TYPE VARCHAR(255) USING tenant_id::text;
ALTER TABLE approvals ALTER COLUMN tenant_id TYPE VARCHAR(255) USING tenant_id::text;
ALTER TABLE tenant_device_tokens ALTER COLUMN tenant_id TYPE VARCHAR(255) USING tenant_id::text;

-- Re-add FK constraints with CASCADE DELETE
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;
ALTER TABLE approvals ADD CONSTRAINT approvals_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;
ALTER TABLE tenant_device_tokens ADD CONSTRAINT tenant_device_tokens_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;

COMMIT;
