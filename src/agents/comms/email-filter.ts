/**
 * Email Filter — regex/keyword gate that decides whether to run LLM ingestion on an incoming email.
 *
 * Called BEFORE any body storage. Only the `bodyPreview` (first 500 chars) is passed in so we
 * never read or store the full body of emails we ultimately ignore.
 *
 * Decision order (first match wins):
 *   1. Known contact email address → always ingest
 *   2. Lead platform sender domain/address → always ingest
 *   3. Lead-signal subject line → ingest
 *   4. Trigger words in body preview → ingest
 *   5. Default → ignore
 */

export type FilterCategory = 'known_contact' | 'lead_platform' | 'trigger_words' | 'ignored';

export interface FilterResult {
  shouldIngest: boolean;
  category: FilterCategory;
  matchedRule: string;
}

// ─── Lead platform sender patterns ───────────────────────────────────────────

const LEAD_PLATFORM_SENDERS: RegExp[] = [
  /^leads@zillow\.com$/i,
  /^noreply@zillow\.com$/i,
  /lead.*@realtor\.com$/i,
  /^notifications@trulia\.com$/i,
  /^lead@facebookmail\.com$/i,
  /^leads@homes\.com$/i,
  /^noreply@redfin\.com$/i,
  /^noreply@opcity\.com$/i,       // Realtor.com Opcity lead referral platform
  /^connect@homelight\.com$/i,
  /^lead@move\.com$/i,
  /^inquiries@loopnet\.com$/i,
  /^leads@coldwellbanker\.com$/i,
  /^leads@kw\.com$/i,
  /^leads@century21\.com$/i,
  /^lead.*@boldleads\.com$/i,
  /^notify@ylopo\.com$/i,
  /^leads@boomtown\.com$/i,
];

// ─── Lead-signal subject patterns ────────────────────────────────────────────

const LEAD_SUBJECT_PATTERNS: RegExp[] = [
  /new (lead|inquiry|contact|buyer|seller)\b/i,
  /showing request/i,
  /property inquiry/i,
  /home (valuation|evaluation|estimate)/i,
  /cash offer/i,
  /buyer lead/i,
  /seller lead/i,
  /referral from/i,
  /interested in.*\b(bed|bath|sqft|\$|price)/i,
  /zillow/i,
  /realtor\.com/i,
  /trulia/i,
  /redfin/i,
  /facebook lead/i,
];

// ─── Body trigger words ───────────────────────────────────────────────────────

const TRIGGER_WORDS: RegExp[] = [
  /ready to (buy|sell|move)/i,
  /looking (for a home|to purchase|to (buy|sell)|to list)/i,
  /(pre.?approved|pre.?qual(ified)?)/i,
  /make an offer/i,
  /counter.?offer/i,
  /closing (date|costs|timeline)/i,
  /\bcontingency\b/i,
  /\binspection\b/i,
  /under contract/i,
  /price (drop|reduction|change)/i,
  /first.?time (home)?buyer/i,
  /when can (we|I) (see|tour|visit)/i,
  /schedule (a )?(showing|tour|visit)/i,
  /how much (is|for|would)/i,
  /still available/i,
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify an inbound email to determine if LLM ingestion should run.
 *
 * @param from          Full "From" address (e.g. "leads@zillow.com" or "John Smith <john@email.com>")
 * @param subject       Email subject line
 * @param bodyPreview   First 500 characters of the plain-text body (pass '' if not available)
 * @param knownContactEmails Set of email addresses already in this tenant's contacts table
 */
export function classifyEmail(
  from: string,
  subject: string,
  bodyPreview: string,
  knownContactEmails: Set<string>,
): FilterResult {
  // Normalise: extract bare email address from "Name <email>" format
  const fromEmail = extractEmailAddress(from).toLowerCase();
  const fromDomain = fromEmail.split('@')[1] ?? '';

  // 1. Known contact — always ingest so we don't miss follow-ups
  if (fromEmail && knownContactEmails.has(fromEmail)) {
    return { shouldIngest: true, category: 'known_contact', matchedRule: `contact:${fromEmail}` };
  }

  // 2. Lead platform sender
  for (const pattern of LEAD_PLATFORM_SENDERS) {
    if (pattern.test(fromEmail) || pattern.test(fromDomain)) {
      return { shouldIngest: true, category: 'lead_platform', matchedRule: `sender:${fromEmail}` };
    }
  }

  // 3. Lead-signal subject
  for (const pattern of LEAD_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      return { shouldIngest: true, category: 'lead_platform', matchedRule: `subject:${pattern.source}` };
    }
  }

  // 4. Trigger words in body preview (capped to avoid processing large bodies)
  const preview = bodyPreview.slice(0, 500);
  for (const pattern of TRIGGER_WORDS) {
    if (pattern.test(preview)) {
      return { shouldIngest: true, category: 'trigger_words', matchedRule: `body:${pattern.source}` };
    }
  }

  return { shouldIngest: false, category: 'ignored', matchedRule: 'no_match' };
}

function extractEmailAddress(raw: string): string {
  // "Name <email@domain.com>" → "email@domain.com"
  const match = raw.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  return raw.trim();
}
