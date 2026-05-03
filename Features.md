# RealClaw — Complete Feature List

> **Version:** May 2026  
> **Tiers:** Starter (free trial & default) · Professional (paid) · Brokerage (volume)

---

## 1. Authentication & Onboarding

### Sign-In
- **Apple Sign-In** (iOS) — native one-tap authentication via Sign In with Apple
- **Google Sign-In** (Android & web) — native one-tap authentication via Google Identity
- Cryptographic identity token verification (RS256 against Apple/Google JWKS)
- Automatic account creation on first sign-in; persistent login via 90-day rotating refresh tokens
- Sign-out revokes all active sessions on all devices simultaneously

### Onboarding Wizard (8 steps)
1. **Welcome** — animated brand intro, benefit overview
2. **Profile** — name, brokerage, phone number
3. **Market** — primary market ZIP code (with 5-digit validation)
4. **Voice & Tone** — email salutation, text salutation, emoji preferences, formality slider (5-point: Casual → Formal), writing sample for AI voice training
5. **Integrations** — connect Gmail, Google Calendar, Twilio SMS, HubSpot CRM, RentCast MLS (DocuSign coming soon)
6. **AI Quality** — tier selection: Fast ⚡ / Balanced ⚖️ / Best 🧠
7. **All Set** — confirmation summary, auto-advances to paywall
8. **Paywall** — start 14-day free trial or skip; RevenueCat in-app purchase

### Subscription Tiers
- **Starter** (free/trial) — Briefing, SMS, Contacts, Chat
- **Professional** — all Starter features + Content Studio, Virtual Staging, Paperwork, Open House Kiosk, Contract Ingest, Showing Coordination, Contract X-Ray, Route Optimization
- **Brokerage** — multi-agent volume pricing ($59/seat)
- 14-day free trial on Professional for all new accounts; trial countdown displayed on home screen

---

## 2. Daily Briefing

Every morning, RealClaw analyzes your pipeline and generates a personalized set of action cards — each with a pre-drafted message ready to approve and send.

### Briefing Cards
- **6 card types:** follow_up · deal_deadline · new_lead · showing_prep · compliance_flag · market_alert
- **Urgency scores** (1–10) — displayed on each card so you triage at a glance
- **Pre-drafted content** — attached SMS or email draft ready to approve with one tap
- **Suggested action** — specific next step (e.g., "Send SMS", "Review contract", "Schedule showing")
- **Contact linking** — briefing cards optionally linked to a specific contact record

### Controls
- **Pull-to-refresh** — reload current cards
- **Manual regenerate** — force a fresh briefing on demand at any time
- **Pending approval badge** — header icon shows count of items awaiting your approval
- **Dismiss** — swipe away cards you've handled; cards auto-expire after 24 hours

### Approval Carousel
- Tap any card's CTA to open a full-screen swipe carousel
- Each card: preview content, approve / edit / reject
- Editing re-drafts with your instructions via AI
- Auto-advances to the next card after each decision

---

## 3. Communications Hub

A unified inbox combining SMS threads and your full contact list — organized by AI-computed relationship temperature.

### Contact Temperature Sorting
- **Hot** (score 70–100) — full-width cards, highest visual priority
- **Warm** (score 40–69) — two-column grid
- **Cold / Dormant** (score < 40) — compact horizontal scroll chips
- Temperature score (0–100) computed from: phone, email, buying criteria, timeline, recency, stage

### SMS Conversations
- Real-time unread badges with message counts
- Last-message previews (bold = unread)
- Relative timestamps ("2:34 PM", "Thu")
- Stage pill color-coding (hot/warm/cold border)
- Search across conversations and contacts simultaneously

### SMS Thread Detail
- Full message history (inbound left, outbound right)
- Timestamps shown between messages with gaps > 1 hour
- Per-message send status (sending / sent / error)

### AI Signal Extraction
- Incoming SMS automatically analyzed for: budget signals · timeline signals · property preferences · objections · competitor mentions · urgency level · sentiment
- Extracted signals displayed as chips below each message

### Smart Reply Bar
- 3 AI-generated suggested replies per thread: direct follow-up · action CTA · nurture
- Tap any suggestion to populate the input
- **Regenerate** — request 3 new suggestions at any time
- Suggestions are context-aware (reads recent thread history + contact profile)

### Composing Messages
- Multiline text input (160 chars per SMS standard)
- Character counter
- **Voice-to-text** — microphone button for hands-free drafting
- Optimistic send (message appears immediately, confirmed async)

### Compliance
- **SMS opt-in enforcement** — contacts without opt-in cannot be messaged; opt-in confirmation sheet shown
- **Do-not-contact flag** — system blocks all outbound for flagged contacts
- **Email unsubscribe** — tracked per contact; blocks email drafts

---

## 4. RealClaw Chat

A persistent AI assistant channel always accessible via the floating "RealClaw" button.

### Chat Interface
- Full-duplex WebSocket connection with streaming responses
- Typing indicator (animated three-dots) while the assistant is processing
- Progressive token streaming — assistant responses appear word by word
- User messages pinned left; assistant responses right

### Skills (Slash Commands)
- Type `/` to open an autocomplete skill picker
- Skills provide structured templates for common tasks:
  - `/sms` — draft a smart reply
  - `/email` — compose an email
  - `/research` — pull market data or comps
  - `/listing` — generate listing description
  - `/dossier` — pull up a contact profile
  - And more

### Inline Approvals
- Approval cards appear directly in the chat thread when the assistant generates content requiring your review
- Swipe approve / edit / reject without leaving the chat

### Offline Mode
- Messages typed while offline are queued locally (SQLite)
- Queued messages display "(queued — will send when online)"
- Queue drains automatically on reconnect

---

## 5. Content Studio *(Professional)*

A full-featured marketing content generator that turns property details into platform-ready copy across every channel.

### Generation Presets
- **New Listing** — fresh-to-market announcement
- **Just Sold** — celebration post with social caption + email subject + body
- **Open House Recap** — post-event summary content
- **Price Reduction** — urgency-driven price update announcement

### Platform Coverage
Select any combination: **MLS** · **Instagram** · **Facebook** · **LinkedIn** · **Email** · **SMS**

Each platform gets purpose-built copy respecting its format:
- MLS: 150–200 words, fair-housing compliant
- Instagram: ≤ 150 chars + 5 hashtags
- Facebook: ≤ 300 chars, conversational
- LinkedIn: ≤ 400 chars, professional
- Email: subject line + 3 paragraphs
- SMS: ≤ 160 chars, no links

### Photo Intelligence (Vision)
- Upload one or more listing photos
- AI analyzes images and extracts: property type · bed/bath · key features · condition signals · style era · standout attributes
- Extracted features automatically populate the content prompt

### Tone Selection
- Choose tone (Standard, Luxury, Casual, etc.) before generating
- **Regenerate** with a new tone after initial generation

### Contact Personalization *(optional)*
- Select a buyer contact to personalize copy for their stated criteria and budget
- Pulls buyer profile from Relationship Agent
- Highlights features matching their stated preferences

### Fair-Housing Compliance Scan
- Every piece of generated content is automatically scanned against fair-housing rules
- Violations (by severity: error / warning) are flagged with explanations
- Content with violations requires manual review before the approval gate opens

### Approval Gate
- Clean content proceeds to an approval carousel (post_social action type)
- Content with flags is held for review; no content is posted without your approval

---

## 6. Virtual Staging *(Professional)*

Turn empty room photos into magazine-quality furnished spaces.

- Upload an empty or partially furnished room photo
- Choose a staging style (Modern, Traditional, Minimal, etc.)
- AI generates a photorealistic staged version via GPT-Image-1 (with DALL-E-2 fallback)
- **Regenerate** to try a different interpretation of the same style
- Result image displayed in 1:1 aspect ratio for easy sharing

---

## 7. Paperwork Delivery *(Professional)*

Send standard real estate documents to clients with a single action.

- Browse a curated catalog of real estate documents (configurable per brokerage)
- Each document shows: label, short code, description, "Required" badge
- Select one or more documents
- Choose the recipient contact
- Add an optional cover note
- **Approval-gated delivery** — review the batch before anything is sent (send_document action type)

---

## 8. Open House Kiosk *(Professional)*

A full-screen guest sign-in experience designed to hand the phone directly to visitors.

### Kiosk Mode
- Tap "Start Kiosk Mode" — optionally authenticate with Face ID / Touch ID or a 4-digit PIN
- Device locks into a full-screen interface (hardware back button disabled)
- Sign-in form: guest name · phone number (optional) · "Working with an agent?" toggle

### Guest Management
- All sign-ins captured in a scrollable guest list during the event
- Each guest: name, phone, agent status, notes preview
- Voice-to-text **Brain Dump** — tap the mic and speak notes about a guest (transcribed and saved)
- Attach notes to a specific guest via the guest selector

### Conclude & Debrief
- Tap "Conclude Open House" — prompts to review notes for all guests
- AI generates personalized follow-up drafts for each guest (email or SMS)
- Review drafts in a swipeable **Debrief Carousel** — approve or edit each one

### Guest → Contact Pipeline
- Every guest automatically creates or updates a contact record (stage: Lead, source: Open House)
- Briefing card generated (type: new_lead) so no guest is forgotten the next morning

### Security Settings
- Toggle biometric requirement on/off (useful when handing device directly to guests)
- Set or change a 4-digit kiosk PIN as a fallback

---

## 9. Contact Management

A smart CRM built specifically for real estate relationship management.

### Contact Records
- Store: name, phone, email, stage, source, budget, desired location, bed/bath, timeline, notes
- Consent flags: SMS opt-in date, email unsubscribe date, do-not-contact flag
- Contacts created from: manual entry, phone import, open house sign-in, lead emails, SMS inbound

### AI Relationship Dossier
- Tap any contact to open a **Dossier Sheet**
- AI generates a 2–3 sentence relationship narrative in second person
- Surfaces 2–3 **Suggested Actions** (send_sms / send_email / modify_calendar) with draft previews

### Lead Scoring
- Every contact receives a **temperature score** (0–100) updated as interactions occur
- Scoring factors: phone present (10 pts) · email present (10 pts) · buying criteria (20 pts) · timeline (15 pts) · recency (20 pts) · pipeline stage (10 pts) · baseline (15 pts)

### Pipeline View
- Contacts grouped by stage in a pipeline view
- Stages: Lead → Prospect → Active Buyer/Seller → In Escrow → Past Client

### Import
- "Import from Phone" — uses native device contacts picker
- Phone number, name, email pre-filled from device contact

### Compliance Controls
- **Do-Not-Contact** — one-tap flag; blocks all outbound communications
- **Email Unsubscribe** — tracked per contact; automated via one-click unsubscribe link in emails
- **SMS Opt-In** — tracked per contact with timestamp

---

## 10. Deals & Transaction Management *(Professional)*

End-to-end escrow tracking from contract to close, with AI-powered extraction and real-time alerts.

### Contract Ingest
- Paste any ratified contract text (or key deal terms) into a text field
- AI extracts: address · deal type (buyer/seller/dual) · purchase price · earnest money & due date · acceptance date · closing date · buyer name · seller name · escrow company & number · MLS number · year built · HOA presence · seller foreign-person status · state
- Deal record created in seconds; contract text preserved for reference

### Milestone Timeline
- Auto-seeded milestones from built-in templates:
  - **Buyer:** Inspection (day 7) · Appraisal (day 10) · Clear to Close (day -2) · Final Walkthrough (day -1)
  - **Seller:** Inspection Response (day 10) · Remove Contingencies (day 21) · Clear to Close (day -2)
- Visual horizontal timeline with completion status
- Tap to complete or waive any milestone
- Blocking milestones highlighted in red when overdue

### Deal Stage Tracking
Pre-Offer → Offer Drafting → Mutual Acceptance → Contingency → Clear to Close → Closed / Cancelled

### Document Compliance Checklist
- Required documents seeded based on deal type, state, year built, HOA presence, foreign person status
- Per-document status: required → uploaded → signed → waived / n/a
- Blocking documents shown with red indicator (must be resolved before close)
- Document status editable in the **Documents** tab of deal detail

### Contract X-Ray *(Professional)*
- Dedicated tab in deal detail
- AI-extracted summary of: key dates · contingency types · financial terms · party information
- Instant at-a-glance understanding of any deal's critical points

### Deal Alerts (Real-Time)
- **P0 alerts** — overdue milestones or blocking issues (urgent red)
- **P1 alerts** — deadlines within 48 hours (orange)
- Pushed in real time via WebSocket — appears as a banner on the Deals screen
- Priority carousel on the Deals tab shows all active alerts; swipe to dismiss

### Wire Fraud Protection
- Detect wire fraud risk patterns in any text (e.g., "change bank account", "new wiring instructions")
- Triggered automatically on deal ingest and on demand

### Post-Closing Sequence
- Generate a post-close follow-up plan (day 1 thank-you · week 1 check-in · 30-day · anniversary · review request)

---

## 11. Showing Coordination *(Professional)*

An end-to-end showing workflow from property discovery to post-tour report.

### AI Property Matching
- Enter or update buyer criteria (price, beds/baths, location, sqft, pool, garage, etc.)
- RealClaw searches MLS (CRMLS or RentCast) and scores every result 0–100
- Scoring considers: matched criteria · missing criteria · compensating factors
- Results available immediately for curation

### Swipe-to-Curate
- Cards stack in a full-screen swipe interface (Tinder-style)
- Each card: address, price, bed/bath, sqft, agent notes
- Swipe right (♥) to add to the showing day; swipe left (✕) to skip
- Progress bar shows how many properties remain
- Curated batch queued for showing day proposal

### Showing Day Proposal
- RealClaw proposes a showing day with 3 calendar-aware date options
- Time estimate calculated: 30 min per stop + 20 min drive buffer per leg
- Available dates pulled from your Google Calendar
- Proposed date formatted: "Proposed date: YYYY-MM-DD"

### Route Optimization
- VRPTW (Vehicle Routing Problem with Time Windows) heuristic orders stops optimally
- Generates a shareable **multi-stop Google Maps URL** for the client
- Total distance and drive time estimated

### Live Showing Mode
- Enter live mode during the showing day
- Turn-by-turn stop tracking: current stop details, next 3 stops preview
- Per-stop notes with voice transcription
- Time-in / time-out tracked automatically per property

### Field Oracle
- Deep per-property research dossier available during or before showings
- Includes: permit history, HOA details, school ratings, neighborhood stats, listing agent notes
- Cached per property to avoid redundant API calls

### Post-Tour Reports
- **Agent brief** — internal notes summary, buyer reactions, recommended next steps
- **Client recap** — client-friendly summary of the day's showings with highlights

---

## 12. Gmail Integration

Connect your Gmail inbox and let RealClaw monitor, filter, and act on incoming emails automatically.

### Real-Time Inbox Monitoring
- OAuth 2.0 connection to Gmail (scope: gmail.modify)
- Google Cloud Pub/Sub push delivery — new emails processed within seconds of arrival
- No polling; event-driven architecture means zero delay

### Intelligent Email Filter
- 4-way classification per incoming email:
  - **Known Contact** — from someone in your contacts
  - **Lead Platform** — from Zillow, Realtor.com, Trulia, etc. (auto-detected by sender domain/pattern)
  - **Trigger Words** — contains keywords indicating a hot lead or urgent matter
  - **Ignored** — newsletters, marketing, etc. (body never stored)
- Filter decision and reason stored for audit; only relevant emails fetch full body content

### AI Email Triage
- Relevant emails categorized as: **urgent** · **response-needed** · **fyi** · **junk**
- Summary and suggested action extracted from each email
- High-urgency emails (score ≥ 7) surface as briefing cards the next morning
- Pre-drafted reply generated and attached to the briefing card

### Writing Style Analysis
- Connect Gmail → tap "Analyze Writing Style"
- RealClaw fetches your 30 most recent sent emails
- AI analyzes: greeting/sign-off patterns · formality · sentence structure · punctuation · emoji usage · recurring phrases · personal voice
- Writes a tone model that informs all future draft compositions
- Re-analysis available at any time (rate-limited to once per 6 hours)

### Gmail Labels
- Processed emails automatically labeled "RealClaw/Processed" in Gmail
- Keeps your inbox organized without manual tagging

### Data Privacy
- Email body text purged after 30 days (GDPR Article 5(1)(e) storage limitation)
- Metadata (subject, sender, timestamps, contact link) retained for audit
- HTML stripped before storage; maximum 2,000 chars per email body

---

## 13. Market Research & Intelligence

Pull live market data and competitive analysis directly inside RealClaw.

### Comparable Sales (Comps)
- Enter an address; RealClaw fetches sold comps within a configurable radius and lookback period
- AI analysis: price-per-sqft range · suggested list price · DOM trends · value assessment

### Market Stats
- Enter a ZIP code for live market data: median sale price · average days on market · active/pending/sold counts · price direction (appreciating/depreciating/stable)
- Available in chat, briefing cards, and Showings agent

### Active Listings
- Fetch current active inventory for any ZIP; used for competitive tracking and buyer curation

### Neighborhood Guide
- Request a full neighborhood guide (schools, commute, amenities, walkability, market trends, buyer appeal)
- Compliance-checked before delivery to prevent steering language

### Document Summary
- Paste any document text; AI summarizes key points and flags potential concerns

---

## 14. Calendar Integration

*(Integration enabled when Google Calendar is connected)*

- **Schedule events** from natural language ("Schedule a showing at 10am Friday for John")
- **Check schedule** — daily event summary for any day
- **Morning briefing** — AI brief of tomorrow's events
- **Showing coordination** — calendar availability consulted when proposing showing days
- **Availability check** — free/busy lookup for attendees before scheduling
- Approval gate for all calendar modifications (modify_calendar action type)

---

## 15. Settings & Preferences

### Profile
- Edit: display name · brokerage · phone · primary market ZIP
- All fields editable inline with save/cancel
- Updates sync to server immediately

### AI Quality Tier
- Switch between Fast ⚡ (quick), Balanced ⚖️ (default), Best 🧠 (maximum quality) at any time
- Affects every AI-generated output: drafts, research, briefings

### Auto-Approval Controls
- Toggle auto-send vs. require-approval per action type:
  - Text Messages (send_sms)
  - Emails (send_email)
  - LinkedIn Messages (send_linkedin_dm)
  - Calendar Changes (modify_calendar)
  - Social Posts (post_social)
  - Document Delivery (send_document)
- Financial actions always require manual approval (cannot be auto-approved)

### Integrations
- View connection status for all integrations from one screen
- Connect / disconnect: Gmail · Google Calendar · Twilio · HubSpot · RentCast · DocuSign *(coming soon)*
- Writing-style analysis trigger for Gmail

### Subscription
- Current plan badge and status (Active / Free Trial / Past Due / Cancelled / Paused)
- Trial countdown (red when ≤ 3 days remaining)
- Upgrade to Professional
- Manage subscription (Apple/Google platform billing)
- Restore purchase
- Brokerage inquiry (10+ agents: contact for volume pricing)

---

## 16. Compliance & Legal

RealClaw is built compliance-first for real estate professionals.

### Fair Housing
- All generated content (listings, social posts, neighborhood guides) scanned against a configurable rule engine
- Rules cover: discriminatory language · steering · protected-class references
- Violations categorized by severity (error = blocked; warning = flagged but allowed)
- Full rule library configurable per brokerage

### CAN-SPAM / Email Compliance
- Unsubscribe link included in all outgoing emails
- One-click unsubscribe landing page (`/v1/unsubscribe`) requires no authentication
- Unsubscribe status tracked per contact; blocks future email drafts
- Brokerage name, address, and license number appended to all AI-drafted emails

### AI Disclosure
- Configurable AI disclosure mode (footer / modal / none) per tenant
- Footer automatically appended to every LLM-drafted email and letter

### GDPR / CCPA
- **Data Export** (Art. 20 portability) — download all personal data as JSON: profile, contacts, SMS messages, deals, briefing items
- **Account Deletion** (Art. 17 right to erasure) — permanently deletes all tenant data, vault credentials, and memory files
- Email body purge job runs nightly (removes stored email body text after 30 days)
- OAuth tokens encrypted at rest (AES-256-GCM) and never logged in plaintext

### Wire Fraud
- Pattern detection for common wire fraud indicators in any incoming text
- Surfaces a warning before any wire transfer–related action is taken
