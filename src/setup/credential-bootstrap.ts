import type { CredentialVault } from '../credentials/vault.js';
import { IntegrationId } from '../types/integrations.js';

export interface BootstrapResult {
  seeded: IntegrationId[];
  skipped: IntegrationId[];  // vault entry already present — not overwritten
  failed: { id: IntegrationId; error: string }[];
}

interface BootstrapEntry {
  envVar: string;
  vaultKey: string;
}

interface BootstrapMapping {
  id: IntegrationId;
  entries: BootstrapEntry[];
}

const BOOTSTRAP_MAP: BootstrapMapping[] = [
  {
    id: IntegrationId.TWILIO,
    entries: [
      { envVar: 'CLAW_TWILIO_ACCOUNT_SID', vaultKey: 'username' },
      { envVar: 'CLAW_TWILIO_AUTH_TOKEN', vaultKey: 'password' },
    ],
  },
  {
    id: IntegrationId.GMAIL,
    entries: [
      { envVar: 'CLAW_GMAIL_CLIENT_ID', vaultKey: 'client_id' },
      { envVar: 'CLAW_GMAIL_CLIENT_SECRET', vaultKey: 'client_secret' },
    ],
  },
  {
    id: IntegrationId.GOOGLE_CALENDAR,
    entries: [
      { envVar: 'CLAW_GMAIL_CLIENT_ID', vaultKey: 'client_id' },
      { envVar: 'CLAW_GMAIL_CLIENT_SECRET', vaultKey: 'client_secret' },
    ],
  },
  {
    id: IntegrationId.HUBSPOT,
    entries: [
      { envVar: 'CLAW_HUBSPOT_ACCESS_TOKEN', vaultKey: 'access_token' },
    ],
  },
  {
    id: IntegrationId.RENTCAST,
    entries: [
      { envVar: 'CLAW_RENTCAST_API_KEY', vaultKey: 'api_key' },
    ],
  },
];

/**
 * Seeds the vault from environment variables at gateway startup.
 * Idempotent — skips any key that's already stored in the vault.
 * Catches per-entry errors so one failure doesn't abort the rest.
 */
export async function bootstrapCredentialsFromEnv(vault: CredentialVault): Promise<BootstrapResult> {
  const result: BootstrapResult = { seeded: [], skipped: [], failed: [] };

  for (const mapping of BOOTSTRAP_MAP) {
    let anySeeded = false;
    let anyFailed = false;
    let failReason = '';

    for (const entry of mapping.entries) {
      const envValue = process.env[entry.envVar];
      if (!envValue) continue;  // env var not set — nothing to seed

      try {
        const existing = await vault.retrieve(mapping.id, entry.vaultKey);
        if (existing !== null) {
          // Already in vault — idempotent skip
          continue;
        }
        await vault.store(mapping.id, entry.vaultKey, envValue);
        anySeeded = true;
      } catch (err) {
        anyFailed = true;
        failReason = (err as Error).message;
      }
    }

    if (anyFailed) {
      result.failed.push({ id: mapping.id, error: failReason });
    } else if (anySeeded) {
      result.seeded.push(mapping.id);
    } else {
      result.skipped.push(mapping.id);
    }
  }

  return result;
}
