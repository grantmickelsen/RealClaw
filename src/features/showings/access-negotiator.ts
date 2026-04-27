/**
 * Stateless helper that converts a property's showing type + instructions
 * into an actionable AccessPlan. The SHOWINGS agent calls this once per stop
 * during the showing_access_negotiate capability.
 */

export type ShowingType = 'go_direct' | 'contact_agent' | 'platform_booking' | 'unknown';

export type AccessPlan =
  | { type: 'auto_confirm' }
  | { type: 'sms_draft'; draft: string; recipientPhone: string }
  | { type: 'browser_navigate'; url: string }
  | { type: 'manual_required'; instructions: string };

/**
 * Build an AccessPlan for a single showing stop.
 *
 * @param showingType      Classified type from MLS instructions
 * @param address          Property address — included in access SMS drafts
 * @param instructions     Raw ShowingInstructions text from MLS
 * @param agentPhone       Listing agent's direct phone (E.164 or formatted)
 * @param proposedDateTime Human-readable date+time string for the SMS (e.g. "Monday April 28 at 10:00 AM")
 */
export function buildAccessPlan(
  showingType: ShowingType,
  address: string,
  instructions: string | null | undefined,
  agentPhone: string | null | undefined,
  proposedDateTime?: string,
): AccessPlan {
  switch (showingType) {
    case 'go_direct':
      return { type: 'auto_confirm' };

    case 'contact_agent': {
      const phone = agentPhone?.trim();
      if (!phone) {
        return {
          type: 'manual_required',
          instructions: instructions ?? 'Contact listing agent — no phone number available',
        };
      }
      const when = proposedDateTime ? ` ${proposedDateTime}` : '';
      const draft =
        `Hi, this is [Agent] with [Brokerage]. I have a buyer interested in viewing ` +
        `${address}${when}. Would you be available? Please let me know a convenient time. Thank you!`;
      return { type: 'sms_draft', draft, recipientPhone: phone };
    }

    case 'platform_booking': {
      // Extract a ShowingTime / BrokerBay URL from the instructions
      const urlMatch = instructions?.match(/https?:\/\/[^\s,)]+(?:showingtime|brokerbay|showing\.com)[^\s,)]*/i);
      if (urlMatch?.[0]) {
        return { type: 'browser_navigate', url: urlMatch[0] };
      }
      // No URL found — surface manual fallback with agent contact
      const contact = agentPhone?.trim() ?? 'listing agent';
      return {
        type: 'manual_required',
        instructions: `Platform booking required. Contact ${contact}. ${instructions ?? ''}`.trim(),
      };
    }

    case 'unknown':
    default:
      return {
        type: 'manual_required',
        instructions: instructions ?? 'No showing instructions available — contact listing agent directly',
      };
  }
}
