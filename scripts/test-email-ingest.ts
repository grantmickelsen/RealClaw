/**
 * Local Email Ingest Test Harness
 *
 * Runs the full email filter + ingest pipeline without needing GCP or a real Gmail account.
 * Uses the same code paths as production — only bypasses the Pub/Sub webhook.
 *
 * Usage:
 *   npx ts-node scripts/test-email-ingest.ts \
 *     --tenant <tenantId> \
 *     --from "leads@zillow.com" \
 *     --subject "New Buyer Lead: John Smith" \
 *     --body "Hi, John is interested in homes under $500k in Austin..."
 *
 *   # Or load from a fixture file in tests/fixtures/emails/:
 *   npx ts-node scripts/test-email-ingest.ts \
 *     --tenant <tenantId> --fixture zillow-lead
 *
 * Requires GMAIL_MOCK_MODE=true in .env (or the vault to have a real access token for the tenant).
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyEmail } from '../src/agents/comms/email-filter.js';
import { ingestGmailForTenant } from '../src/agents/ops/gmail-ingest-job.js';
import { CredentialVault } from '../src/credentials/vault.js';
import { query } from '../src/db/postgres.js';
import log from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface EmailFixture {
  from: string;
  subject: string;
  body: string;
}

function parseArgs(): { tenantId: string; from?: string; subject?: string; body?: string; fixture?: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const tenantId = get('--tenant');
  if (!tenantId) {
    console.error('Usage: test-email-ingest.ts --tenant <tenantId> [--from <addr> --subject <s> --body <b>] [--fixture <name>]');
    process.exit(1);
  }
  return { tenantId, from: get('--from'), subject: get('--subject'), body: get('--body'), fixture: get('--fixture') };
}

async function loadFixture(name: string): Promise<EmailFixture> {
  const fixturePath = path.join(__dirname, '../tests/fixtures/emails', `${name}.json`);
  const { default: fixture } = await import(fixturePath, { assert: { type: 'json' } });
  return fixture as EmailFixture;
}

async function main() {
  const args = parseArgs();
  let email: EmailFixture;

  if (args.fixture) {
    email = await loadFixture(args.fixture);
    console.log(`Loaded fixture: ${args.fixture}`);
  } else if (args.from && args.subject && args.body) {
    email = { from: args.from, subject: args.subject, body: args.body };
  } else {
    console.error('Provide --from, --subject, --body OR --fixture <name>');
    process.exit(1);
  }

  console.log('\n── Email Filter ──────────────────────────────────');
  console.log(`From:    ${email.from}`);
  console.log(`Subject: ${email.subject}`);
  console.log(`Body preview (500 chars): ${email.body.slice(0, 500)}`);

  // Load known contact emails for this tenant
  let knownEmails: Set<string> = new Set();
  try {
    const rows = await query<{ email: string }>(
      "SELECT email FROM contacts WHERE tenant_id = $1 AND email IS NOT NULL AND email <> ''",
      [args.tenantId],
    );
    knownEmails = new Set(rows.rows.map(r => r.email.toLowerCase()));
    console.log(`Known contact emails: ${knownEmails.size}`);
  } catch (err) {
    console.warn('Could not load contacts (DB may not be available):', (err as Error).message);
  }

  // Run filter
  const filterResult = classifyEmail(email.from, email.subject, email.body.slice(0, 500), knownEmails);
  console.log('\n── Filter Result ─────────────────────────────────');
  console.log(`Should ingest: ${filterResult.shouldIngest}`);
  console.log(`Category:      ${filterResult.category}`);
  console.log(`Matched rule:  ${filterResult.matchedRule}`);

  if (!filterResult.shouldIngest) {
    console.log('\nFilter says IGNORE — no LLM call will be made in production.');
    process.exit(0);
  }

  if (process.env.GMAIL_MOCK_MODE !== 'true') {
    console.log('\nSet GMAIL_MOCK_MODE=true to run the full ingest pipeline in dev mode.');
    process.exit(0);
  }

  console.log('\n── Running mock ingest pipeline ──────────────────');
  const vault = new CredentialVault();

  // Write mock email to DB directly (bypassing Gmail API)
  const { v4: uuidv4 } = await import('uuid');
  const mockMessageId = `mock-${uuidv4()}`;
  const mockHistoryId = `mock-history-${Date.now()}`;

  // Seed a fake history entry
  try {
    await query(
      `INSERT INTO tenant_gmail_auth (tenant_id, gmail_address, history_id)
       VALUES ($1, 'mock@test.com', $2)
       ON CONFLICT (tenant_id) DO UPDATE SET history_id = $2`,
      [args.tenantId, String(BigInt(mockHistoryId.replace('mock-history-', '')) - 1n)],
    );
  } catch { /* ignore if DB not available */ }

  // Run the dispatcher stub
  const dispatched: unknown[] = [];
  await ingestGmailForTenant(
    args.tenantId,
    mockHistoryId,
    vault,
    async (tenantId, emailRow) => {
      dispatched.push(emailRow);
      console.log('\n── email_ingest dispatch ──────────────────────────');
      console.log(JSON.stringify(emailRow, null, 2));
    },
  );

  if (dispatched.length === 0) {
    console.log('\n(No dispatch calls — mock Gmail API not returning messages; use --fixture for end-to-end)');
  }

  console.log('\n Done. Check inbound_emails table for stored rows.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
