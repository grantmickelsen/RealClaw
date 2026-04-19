export interface Skill {
  command: string;       // The slash keyword, e.g. "email"
  label: string;         // Display name
  description: string;   // One-line hint shown in picker
  icon: string;          // Emoji icon
  template: string;      // Text inserted into input (cursor at end)
  agentId: string;
}

export const SKILLS: Skill[] = [
  // ─── Comms ──────────────────────────────────────────────────────────────
  {
    command: 'email',
    label: 'Draft Email',
    description: 'Compose an email to a contact',
    icon: '✉️',
    template: 'Draft an email to [contact] about [topic]',
    agentId: 'comms',
  },
  {
    command: 'follow-up',
    label: 'Follow-Up Message',
    description: 'Send a follow-up to a contact',
    icon: '🔁',
    template: 'Send a follow-up to [contact name] about [topic]',
    agentId: 'comms',
  },
  {
    command: 'text',
    label: 'Send Text',
    description: 'Draft an SMS to a contact',
    icon: '💬',
    template: 'Text [contact name]: [message]',
    agentId: 'comms',
  },
  {
    command: 'campaign',
    label: 'Email Campaign',
    description: 'Draft a multi-touch email campaign',
    icon: '📣',
    template: 'Draft a [3-touch / 5-touch] email campaign for [audience] about [topic]',
    agentId: 'comms',
  },

  // ─── Calendar ───────────────────────────────────────────────────────────
  {
    command: 'schedule',
    label: 'Schedule Meeting',
    description: 'Book a meeting or showing',
    icon: '📅',
    template: 'Schedule a [meeting type] with [name] on [date/time]',
    agentId: 'calendar',
  },
  {
    command: 'reschedule',
    label: 'Reschedule',
    description: 'Move an existing appointment',
    icon: '🔄',
    template: 'Reschedule my [meeting/showing] with [name] to [new date/time]',
    agentId: 'calendar',
  },
  {
    command: 'brief',
    label: 'Morning Briefing',
    description: 'Get today\'s schedule and priorities',
    icon: '☀️',
    template: 'Give me my morning briefing',
    agentId: 'calendar',
  },
  {
    command: 'availability',
    label: 'Check Availability',
    description: 'Find open times on your calendar',
    icon: '🕐',
    template: 'What\'s my availability [this week / on date]?',
    agentId: 'calendar',
  },

  // ─── Content ────────────────────────────────────────────────────────────
  {
    command: 'listing',
    label: 'Listing Description',
    description: 'Write a compelling property description',
    icon: '🏡',
    template: 'Write a listing description for [address] — [beds] bed/[baths] bath, [key features]',
    agentId: 'content',
  },
  {
    command: 'social',
    label: 'Social Posts',
    description: 'Generate social media content batch',
    icon: '📱',
    template: 'Create social posts for [property address / just sold at address / market update]',
    agentId: 'content',
  },
  {
    command: 'market-report',
    label: 'Market Report',
    description: 'Generate a neighborhood market update',
    icon: '📊',
    template: 'Write a market report for [neighborhood/zip] for [month/quarter]',
    agentId: 'content',
  },
  {
    command: 'just-sold',
    label: 'Just Sold Post',
    description: 'Announce a closed transaction',
    icon: '🎉',
    template: 'Write a just sold announcement for [address]',
    agentId: 'content',
  },

  // ─── Research ───────────────────────────────────────────────────────────
  {
    command: 'comps',
    label: 'Pull Comps',
    description: 'Comparable sales analysis for a property',
    icon: '🔍',
    template: 'Pull comps for [address] — [beds] bed/[baths] bath, [sqft] sqft',
    agentId: 'research',
  },
  {
    command: 'market',
    label: 'Market Stats',
    description: 'Current market data for a zip or area',
    icon: '📈',
    template: 'What are the current market stats for [zip/neighborhood]?',
    agentId: 'research',
  },
  {
    command: 'property',
    label: 'Property Data',
    description: 'Look up details on a specific address',
    icon: '🏠',
    template: 'Look up property data for [address]',
    agentId: 'research',
  },

  // ─── Relationship ────────────────────────────────────────────────────────
  {
    command: 'contact',
    label: 'Look Up Contact',
    description: 'Find and summarize a contact\'s history',
    icon: '👤',
    template: 'Look up contact [name]',
    agentId: 'relationship',
  },
  {
    command: 'leads',
    label: 'Lead Score',
    description: 'Score and prioritize your leads',
    icon: '⭐',
    template: 'Score my leads and show me the top [5/10] to follow up with this week',
    agentId: 'relationship',
  },
  {
    command: 'pipeline',
    label: 'Pipeline Overview',
    description: 'Summary of your active pipeline',
    icon: '🏦',
    template: 'Give me an overview of my active pipeline',
    agentId: 'relationship',
  },

  // ─── Transaction ─────────────────────────────────────────────────────────
  {
    command: 'offer',
    label: 'Track Offer',
    description: 'Log or check status of an offer',
    icon: '📝',
    template: 'Track the offer for [address] — [status/details]',
    agentId: 'transaction',
  },
  {
    command: 'timeline',
    label: 'Transaction Timeline',
    description: 'View milestones and deadlines for a deal',
    icon: '📋',
    template: 'Show me the timeline for [address/transaction]',
    agentId: 'transaction',
  },
  {
    command: 'closing',
    label: 'Closing Checklist',
    description: 'What\'s still needed to close',
    icon: '✅',
    template: 'What\'s outstanding for the closing on [address]?',
    agentId: 'transaction',
  },

  // ─── Open House ──────────────────────────────────────────────────────────
  {
    command: 'open-house',
    label: 'Plan Open House',
    description: 'Set up and prep an open house',
    icon: '🚪',
    template: 'Plan an open house for [address] on [date/time]',
    agentId: 'open_house',
  },
  {
    command: 'signins',
    label: 'Process Sign-ins',
    description: 'Log open house visitors and follow up',
    icon: '📋',
    template: 'Process open house sign-ins for [address]: [visitor names/emails]',
    agentId: 'open_house',
  },

  // ─── Compliance ──────────────────────────────────────────────────────────
  {
    command: 'check',
    label: 'Compliance Check',
    description: 'Scan content for fair housing issues',
    icon: '🛡️',
    template: 'Check this for compliance: [paste text here]',
    agentId: 'compliance',
  },

  // ─── Ops ─────────────────────────────────────────────────────────────────
  {
    command: 'expense',
    label: 'Log Expense',
    description: 'Record a business expense or mileage',
    icon: '💰',
    template: 'Log expense: [amount] for [category] on [date]',
    agentId: 'ops',
  },
  {
    command: 'mileage',
    label: 'Log Mileage',
    description: 'Track a drive for tax purposes',
    icon: '🚗',
    template: 'Log mileage: [miles] from [origin] to [destination] on [date]',
    agentId: 'ops',
  },
];

export function filterSkills(query: string): Skill[] {
  if (!query) return SKILLS;
  const lower = query.toLowerCase();
  return SKILLS.filter(
    s =>
      s.command.includes(lower) ||
      s.label.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower),
  );
}
