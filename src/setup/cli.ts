/**
 * RealClaw Integration Setup Wizard
 *
 * Run with: npm run setup
 * Intended to run on the HOST (not inside Docker) before `docker compose up`.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as clack from '@clack/prompts';
import open from 'open';
import { CredentialVault } from '../credentials/vault.js';
import { OAuthHandler } from '../credentials/oauth-handler.js';
import type { OAuthConfig } from '../credentials/oauth-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const INTEGRATIONS_CONFIG = path.join(REPO_ROOT, 'config', 'integrations.json');

// ─── OAuth provider metadata ───

interface IntegrationMeta {
  label: string;
  authType: 'oauth2' | 'credentials';
  authUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  credentialFields?: { envVar: string; vaultKey: string; hint: string; isSecret?: boolean }[];
}

const INTEGRATION_META: Record<string, IntegrationMeta> = {
  gmail: {
    label: 'Gmail (OAuth2)',
    authType: 'oauth2',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://mail.google.com/'],
  },
  google_calendar: {
    label: 'Google Calendar (OAuth2)',
    authType: 'oauth2',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar'],
  },
  hubspot: {
    label: 'HubSpot (OAuth2)',
    authType: 'oauth2',
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
  },
  twilio: {
    label: 'Twilio (credentials)',
    authType: 'credentials',
    credentialFields: [
      { envVar: 'CLAW_TWILIO_ACCOUNT_SID', vaultKey: 'username', hint: 'Account SID (ACxxxxxxxx)' },
      { envVar: 'CLAW_TWILIO_AUTH_TOKEN', vaultKey: 'password', hint: 'Auth Token', isSecret: true },
      { envVar: 'CLAW_TWILIO_PHONE_NUMBER', vaultKey: 'phone_number', hint: 'Phone Number (+1...)' },
    ],
  },
};

// ─── Helpers ───

async function ensureVaultKey(): Promise<string> {
  // Check if key already exists in env
  const existing = process.env.CLAW_VAULT_MASTER_KEY;
  if (existing) return existing;

  clack.log.step('CLAW_VAULT_MASTER_KEY not found — generating 32-byte AES-256 key...');

  const key = crypto.randomBytes(32).toString('base64');

  // Append to .env
  let envContent = '';
  try {
    envContent = await fs.readFile(ENV_PATH, 'utf-8');
  } catch {
    // .env doesn't exist yet — create it
  }

  const line = `\nCLAW_VAULT_MASTER_KEY=${key}`;
  await fs.writeFile(ENV_PATH, envContent + line, 'utf-8');
  process.env.CLAW_VAULT_MASTER_KEY = key;

  clack.log.success('Vault key generated and appended to .env');
  return key;
}

async function setEnabled(integrationId: string): Promise<void> {
  const raw = await fs.readFile(INTEGRATIONS_CONFIG, 'utf-8');
  const config = JSON.parse(raw) as { integrations: { id: string; enabled: boolean }[] };
  const entry = config.integrations.find(i => i.id === integrationId);
  if (entry) {
    entry.enabled = true;
    await fs.writeFile(INTEGRATIONS_CONFIG, JSON.stringify(config, null, 2), 'utf-8');
  }
}

async function setupOAuthIntegration(
  integrationId: string,
  meta: IntegrationMeta,
  vault: CredentialVault,
): Promise<boolean> {
  clack.log.step(`Setting up ${meta.label}`);

  const clientId = await clack.text({
    message: 'Client ID',
    placeholder: 'your-client-id',
    validate: v => (!v ? 'Required' : undefined),
  });
  if (clack.isCancel(clientId)) return false;

  const clientSecret = await clack.password({
    message: 'Client Secret',
    validate: v => (!v ? 'Required' : undefined),
  });
  if (clack.isCancel(clientSecret)) return false;

  await vault.store(integrationId as never, 'client_id', clientId as string);
  await vault.store(integrationId as never, 'client_secret', clientSecret as string);
  clack.log.success('Credentials stored in vault');

  const state = crypto.randomUUID();
  const redirectUri = 'http://localhost:3000/callback';

  const oauthConfig: OAuthConfig = {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    authUrl: meta.authUrl!,
    tokenUrl: meta.tokenUrl!,
    redirectUri,
    scopes: meta.scopes!,
  };

  const handler = new OAuthHandler(vault, 3000);
  const authUrl = handler.buildAuthUrl(oauthConfig, state);

  clack.log.info(`Opening browser for ${meta.label} authorization...`);
  clack.log.info(`If browser doesn't open, visit:\n  ${authUrl}`);

  await open(authUrl);

  const spinner = clack.spinner();
  spinner.start('Waiting for OAuth callback (5 minutes)...');

  try {
    const code = await handler.waitForCallback(state, 300_000);
    spinner.stop('Authorization received');

    const tokens = await handler.exchangeCode(oauthConfig, code);
    await handler.storeTokens(integrationId as never, tokens);
    await setEnabled(integrationId);

    clack.log.success(`${meta.label} connected successfully`);
    return true;
  } catch (err) {
    spinner.stop('Authorization failed');
    clack.log.error(`Failed: ${(err as Error).message}`);
    return false;
  }
}

async function setupCredentialsIntegration(
  integrationId: string,
  meta: IntegrationMeta,
  vault: CredentialVault,
): Promise<boolean> {
  clack.log.step(`Setting up ${meta.label}`);

  for (const field of meta.credentialFields!) {
    const prefilled = process.env[field.envVar];
    let value: string;

    if (prefilled) {
      clack.log.info(`Using ${field.envVar} from environment`);
      value = prefilled;
    } else {
      const input = field.isSecret
        ? await clack.password({ message: field.hint, validate: v => (!v ? 'Required' : undefined) })
        : await clack.text({ message: field.hint, validate: v => (!v ? 'Required' : undefined) });

      if (clack.isCancel(input)) return false;
      value = input as string;
    }

    await vault.store(integrationId as never, field.vaultKey, value);
  }

  await setEnabled(integrationId);
  clack.log.success(`${meta.label} credentials stored`);
  return true;
}

// ─── Main ───

async function main(): Promise<void> {
  // Docker guard
  try {
    await fs.access('/.dockerenv');
    clack.log.warn(
      'Running inside Docker — this wizard is intended for the host machine.\n' +
      'Run `npm run setup` on your host before `docker compose up`.',
    );
  } catch {
    // Not in Docker — expected
  }

  clack.intro('RealClaw — Integration Setup');

  await ensureVaultKey();
  const vault = new CredentialVault();

  const choices = Object.entries(INTEGRATION_META).map(([id, meta]) => ({
    value: id,
    label: meta.label,
  }));

  const selected = await clack.multiselect({
    message: 'Which integrations do you want to configure? (Space to select, Enter to confirm)',
    options: choices,
    required: false,
  });

  if (clack.isCancel(selected) || (selected as string[]).length === 0) {
    clack.outro('No integrations selected. Run `docker compose up -d` when ready.');
    return;
  }

  const results: { id: string; ok: boolean }[] = [];

  for (const integrationId of selected as string[]) {
    const meta = INTEGRATION_META[integrationId];
    let ok = false;

    if (meta.authType === 'oauth2') {
      ok = await setupOAuthIntegration(integrationId, meta, vault);
    } else {
      ok = await setupCredentialsIntegration(integrationId, meta, vault);
    }

    results.push({ id: integrationId, ok });
  }

  const succeeded = results.filter(r => r.ok).map(r => r.id);
  const failed = results.filter(r => !r.ok).map(r => r.id);

  if (succeeded.length > 0) {
    clack.log.success(`Connected: ${succeeded.join(', ')}`);
  }
  if (failed.length > 0) {
    clack.log.warn(`Failed: ${failed.join(', ')} — re-run setup to retry`);
  }

  clack.outro('Setup complete. Run: docker compose up -d');
}

main().catch(err => {
  clack.log.error(`Setup failed: ${(err as Error).message}`);
  process.exit(1);
});
