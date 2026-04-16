import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CredentialVault } from '../../../src/credentials/vault.js';
import { bootstrapCredentialsFromEnv } from '../../../src/setup/credential-bootstrap.js';
import { IntegrationId } from '../../../src/types/integrations.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

let tmpDir: string;
let vault: CredentialVault;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-bootstrap-test-'));
  const masterKey = crypto.randomBytes(32).toString('base64');
  process.env.CLAW_VAULT_MASTER_KEY = masterKey;
  vault = new CredentialVault(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.CLAW_VAULT_MASTER_KEY;
  delete process.env.CLAW_TWILIO_ACCOUNT_SID;
  delete process.env.CLAW_TWILIO_AUTH_TOKEN;
  delete process.env.CLAW_GMAIL_CLIENT_ID;
  delete process.env.CLAW_GMAIL_CLIENT_SECRET;
  delete process.env.CLAW_HUBSPOT_ACCESS_TOKEN;
});

describe('bootstrapCredentialsFromEnv', () => {
  it('seeds Twilio credentials from env vars', async () => {
    process.env.CLAW_TWILIO_ACCOUNT_SID = 'ACtest123';
    process.env.CLAW_TWILIO_AUTH_TOKEN = 'auth_tok_abc';

    const result = await bootstrapCredentialsFromEnv(vault);

    expect(result.seeded).toContain(IntegrationId.TWILIO);
    expect(result.failed).toHaveLength(0);

    const sid = await vault.retrieve(IntegrationId.TWILIO, 'username');
    const token = await vault.retrieve(IntegrationId.TWILIO, 'password');
    expect(sid).toBe('ACtest123');
    expect(token).toBe('auth_tok_abc');
  });

  it('seeds Gmail client credentials from env vars', async () => {
    process.env.CLAW_GMAIL_CLIENT_ID = 'gmail-client-id';
    process.env.CLAW_GMAIL_CLIENT_SECRET = 'gmail-client-secret';

    const result = await bootstrapCredentialsFromEnv(vault);

    expect(result.seeded).toContain(IntegrationId.GMAIL);
    const clientId = await vault.retrieve(IntegrationId.GMAIL, 'client_id');
    expect(clientId).toBe('gmail-client-id');
  });

  it('skips entries when vault already has the key (idempotency)', async () => {
    // Pre-store a value
    await vault.store(IntegrationId.TWILIO, 'username', 'existing_sid');
    await vault.store(IntegrationId.TWILIO, 'password', 'existing_token');

    process.env.CLAW_TWILIO_ACCOUNT_SID = 'new_sid';
    process.env.CLAW_TWILIO_AUTH_TOKEN = 'new_token';

    await bootstrapCredentialsFromEnv(vault);

    // Existing values should not be overwritten
    const sid = await vault.retrieve(IntegrationId.TWILIO, 'username');
    expect(sid).toBe('existing_sid');
  });

  it('skips integrations with no env vars set', async () => {
    // No env vars set for anything
    const result = await bootstrapCredentialsFromEnv(vault);

    // Everything goes to skipped (no env vars = nothing to seed)
    expect(result.seeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('reports seeded/skipped arrays correctly for mixed env state', async () => {
    process.env.CLAW_TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.CLAW_TWILIO_AUTH_TOKEN = 'authtoken';
    // Gmail not set — should be skipped

    const result = await bootstrapCredentialsFromEnv(vault);

    expect(result.seeded).toContain(IntegrationId.TWILIO);
    expect(result.seeded).not.toContain(IntegrationId.GMAIL);
    expect(result.failed).toHaveLength(0);
  });

  it('reports failed when vault.retrieve throws', async () => {
    process.env.CLAW_TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.CLAW_TWILIO_AUTH_TOKEN = 'authtoken';

    vi.spyOn(vault, 'retrieve').mockRejectedValue(new Error('disk full'));

    const result = await bootstrapCredentialsFromEnv(vault);

    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.failed[0]!.error).toContain('disk full');

    vi.restoreAllMocks();
  });

  it('google_calendar shares Gmail client credentials', async () => {
    process.env.CLAW_GMAIL_CLIENT_ID = 'shared-client-id';
    process.env.CLAW_GMAIL_CLIENT_SECRET = 'shared-client-secret';

    await bootstrapCredentialsFromEnv(vault);

    const calClientId = await vault.retrieve(IntegrationId.GOOGLE_CALENDAR, 'client_id');
    expect(calClientId).toBe('shared-client-id');
  });
});
