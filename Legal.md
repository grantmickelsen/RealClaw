# Legal Working List — RealClaw

Working list of required provisions, disclosures, and obligations derived from the
compliance audit. Each item is tied to the specific law or requirement that drives it.
Checkboxes indicate implementation status: ☐ = not yet drafted, ☑ = drafted/implemented.

---

## 1. Terms of Service

### 1.1 Eligibility and Professional Use
- ☐ Service is intended solely for **licensed real estate professionals** (agents, brokers, teams).
  Cite: state real estate licensing laws; NAR Code of Ethics applicability.
- ☐ User must be 18 or older (COPPA safe harbor; App Store requirement).
- ☐ User represents they hold a current, valid real estate license in their jurisdiction and will
  keep it current for the duration of the subscription.

### 1.2 Subscription and Billing
- ☐ Description of Free vs. Professional tiers and included features.
- ☐ **Auto-renewal disclosure** — subscriptions renew automatically; user may cancel any time
  before the renewal date. Required by Apple App Store, Google Play, and many state auto-renewal
  laws (CA, NY, TX, FL, IL).
- ☐ Refund policy — App Store / Play Store purchases governed by platform refund policies.
  Direct web purchases (if any) need an explicit policy.
- ☐ Price change notice — N days advance notice before price increase.

### 1.3 AI-Generated Content
- ☐ **AI assistance disclosure** — The service uses large language models to draft communications,
  listing descriptions, and marketing content. All AI-generated content requires user review and
  is provided as a starting point, not a final product.
- ☐ **User responsibility** — User is solely responsible for the accuracy, legality, and
  appropriateness of all content sent or published via the service, including AI-assisted content.
  Cite: FTC Endorsement Guides 2023; FTC Act § 5.
- ☐ **No legal advice** — AI-generated content is not legal, financial, or professional advice.
  Users must independently verify compliance with applicable laws before use.

### 1.4 Communications Compliance — TCPA
- ☐ User represents and warrants that they have obtained **prior express written consent** (PECW)
  from every contact before sending SMS messages through the service.
  Cite: TCPA 47 U.S.C. § 227; FCC 2023 one-to-one consent rule.
- ☐ User agrees to honor opt-out requests (STOP) within the platform within **24 hours**.
- ☐ User agrees not to use the service to send SMS to numbers on the **National Do-Not-Call
  Registry** without an established business relationship exemption.
- ☐ User indemnifies RealClaw against any TCPA claims arising from the user's contact list or
  consent-management practices.

### 1.5 Communications Compliance — CAN-SPAM
- ☐ User agrees to provide an accurate **physical mailing address** (brokerage address) in their
  profile, which will be included in all outbound marketing emails.
  Cite: CAN-SPAM Act 15 U.S.C. § 7704(a)(5).
- ☐ User agrees to honor email unsubscribe requests within **10 business days**.
  Cite: CAN-SPAM Act § 7704(a)(4).
- ☐ User agrees not to use deceptive subject lines or sender information.

### 1.6 Fair Housing Compliance
- ☐ User acknowledges that the service includes automated Fair Housing Act screening of
  AI-generated content, but that **the user bears full legal responsibility** for compliance with
  the Fair Housing Act (42 U.S.C. § 3604), applicable state fair housing laws, and NAR's Code
  of Ethics Article 10.
- ☐ User agrees not to circumvent or disable the Fair Housing compliance screening features.
- ☐ User indemnifies RealClaw against Fair Housing claims arising from content the user approves
  and publishes.

### 1.7 RESPA Compliance
- ☐ User agrees not to use the service to communicate, arrange, or suggest any kickback,
  fee-splitting, or referral payment arrangement prohibited under RESPA § 8 (12 U.S.C. § 2607).
- ☐ The service's RESPA-detection feature is a best-effort tool; users must independently ensure
  compliance with RESPA.

### 1.8 Real Estate Advertising Disclosures
- ☐ User agrees to maintain accurate brokerage name, license number, and physical address in
  their profile settings. These are included in AI-generated listing descriptions and email
  footers as required by most state real estate commission advertising regulations.
- ☐ User acknowledges that **state-specific advertising requirements vary** (e.g., California DRE
  license required in all advertisements) and that the user is responsible for knowing and
  meeting their jurisdiction's requirements.

### 1.9 Data and Privacy
- ☐ User grants RealClaw a limited license to process contact data and communications content
  for the sole purpose of providing the service.
- ☐ User represents that they have a **lawful basis** for sharing contact data with the service
  (e.g., legitimate interest under GDPR, or consent under CCPA).
- ☐ User agrees to comply with applicable data protection laws (GDPR, CCPA/CPRA, state laws)
  with respect to contacts whose data is stored in the service.

### 1.10 Prohibited Uses
- ☐ Sending unsolicited commercial messages (spam) via any channel.
- ☐ Generating or distributing discriminatory content under the Fair Housing Act.
- ☐ Impersonating another person or organization.
- ☐ Using the service to process data of minors (under 18).
- ☐ Reverse engineering, scraping, or automated access outside the documented API.
- ☐ Reselling or sublicensing access.

### 1.11 Intellectual Property
- ☐ RealClaw retains ownership of the platform, models, and outputs. User owns the input data
  and approved, published content after human review.
- ☐ Third-party model usage is subject to provider terms (Anthropic, OpenAI, Google).

### 1.12 Limitation of Liability
- ☐ Disclaimer of warranties (service provided "as is").
- ☐ Limitation of liability to fees paid in the prior 12 months.
- ☐ Exclusion of consequential, punitive, and indirect damages.
- ☐ Carve-out: limitation does not apply to indemnification obligations or gross negligence.

### 1.13 Indemnification
- ☐ User indemnifies RealClaw for claims arising from: TCPA violations, CAN-SPAM violations,
  Fair Housing violations, RESPA violations, user's contact data, and user-approved content.

### 1.14 Dispute Resolution
- ☐ Governing law (select jurisdiction — suggest Delaware for entity, California for consumers).
- ☐ Mandatory arbitration clause with class action waiver (review enforceability by state).
- ☐ Small claims court carve-out.
- ☐ 30-day notice-and-cure period before arbitration.

### 1.15 Modifications
- ☐ Right to modify terms with 30-day notice.
- ☐ Continued use constitutes acceptance.

---

## 2. Privacy Policy

### 2.1 Data We Collect
- ☐ **Account data**: name, email, brokerage, license number, phone (from agent registration).
- ☐ **Contact data**: names, emails, phones, addresses, financial information, notes — provided
  by the agent from their CRM/practice.
- ☐ **Communication content**: email body text (retained max 30 days, then purged), SMS messages,
  AI-generated drafts.
- ☐ **Transaction data**: deal addresses, prices, buyer/seller names, contract summaries.
- ☐ **Usage data**: API calls, feature usage, model tier selections (for product analytics).
- ☐ **Device data**: Expo push notification tokens, device platform (iOS/Android).
- ☐ **OAuth tokens**: Gmail, Google Calendar, Google Drive access credentials (encrypted at rest).

### 2.2 How We Use Data
- ☐ Providing and improving the AI assistant service.
- ☐ Generating AI-assisted drafts — contact data is sent to third-party LLM providers (see §2.5).
- ☐ Sending notifications (push, WebSocket) to the agent's device.
- ☐ Subscription management via RevenueCat.
- ☐ Security monitoring and abuse prevention.

### 2.3 Data Retention
- ☐ **Email body text**: automatically purged after 30 days (GDPR storage limitation).
- ☐ **Email metadata** (subject, sender, timestamps): retained for audit purposes.
- ☐ **SMS messages**: retained for [N] days (define period — recommend 12 months; note current
  gap: no retention policy implemented yet).
- ☐ **Contacts and deals**: retained until account deletion.
- ☐ **Account data**: deleted within 30 days of account deletion request.
- ☐ **OAuth tokens**: deleted immediately upon integration disconnect.
- ☐ **Backup retention**: [N] days (per `CLAW_BACKUP_PATH` infrastructure).

### 2.4 Data Security
- ☐ OAuth credentials encrypted at rest with AES-256-GCM.
- ☐ Refresh tokens stored as SHA-256 hashes.
- ☐ All data in transit encrypted via TLS 1.2+.
- ☐ Multi-tenant isolation — no data shared between agents.
- ☐ **Note**: Database fields (contact PII, SMS bodies) are not individually encrypted; security
  relies on database-level encryption (cloud provider) and access controls.

### 2.5 Third-Party Data Processors (Sub-Processors)
- ☐ **Anthropic** — AI text generation (contact profiles, drafts sent as context).
- ☐ **OpenAI** — AI image generation (virtual staging feature).
- ☐ **Google** — Gmail/Calendar/Drive OAuth, LLM (Gemini, optional), Pub/Sub notifications.
- ☐ **Twilio** — SMS sending and receiving.
- ☐ **RevenueCat** — subscription management (does not receive contact data).
- ☐ **Apple / Google** — payment processing (does not receive contact data).
- ☐ **Redis / PostgreSQL cloud provider** — database and cache infrastructure.

### 2.6 User Rights

#### GDPR (EU residents)
- ☐ Right of access (Article 15) — `GET /v1/export` ☑ implemented.
- ☐ Right to rectification (Article 16) — contact/deal data editable via the app.
- ☐ Right to erasure (Article 17) — `DELETE /v1/account` ☑ implemented; contact-level deletion
  via contact delete endpoint (verify this exists or add it).
- ☐ Right to data portability (Article 20) — `GET /v1/export` ☑ implemented.
- ☐ Right to restrict processing — no implementation yet; ☐ add `processing_restricted` flag.
- ☐ Right to object — user can disconnect integrations and delete account.
- ☐ **Legal basis**: legitimate interest (agent's professional use of their own client data).
- ☐ DPA / SCCs required if data transfers to non-EU LLM providers (Anthropic, OpenAI).

#### CCPA / CPRA (California residents)
- ☐ Right to know — `GET /v1/export` ☑ implemented.
- ☐ Right to delete — `DELETE /v1/account` ☑ implemented.
- ☐ Right to opt-out of sale/sharing — RealClaw does not sell personal data; state this clearly.
- ☐ Right to correct — data editable in app.
- ☐ Sensitive personal information (SPI) handling disclosure — deal financial data qualifies.

### 2.7 Communications Consent
- ☐ Email marketing: opt-in required; opt-out honored via unsubscribe link in every email.
- ☐ SMS: contacts must explicitly opt in; STOP keyword honored immediately.

### 2.8 Children's Privacy
- ☐ Service not directed at children under 18; no knowing collection of minors' data (COPPA safe harbor).

### 2.9 Changes to Privacy Policy
- ☐ 30-day notice of material changes; continued use constitutes acceptance.

### 2.10 Contact for Privacy Requests
- ☐ Privacy contact email address (e.g., `privacy@realclaw.com`).
- ☐ Designated EU/UK representative (if serving EU/UK customers — GDPR Art. 27).

---

## 3. Data Processing Agreement (DPA) — GDPR

Required if serving any EU/UK customers. RealClaw acts as a **Data Processor**; the
agent acts as the **Data Controller** for their clients' data.

- ☐ Scope of processing — what data, for what purpose, for how long.
- ☐ Sub-processor list (see §2.5) with right to object to new sub-processors.
- ☐ Security measures (Article 32) — encryption, access controls, breach response.
- ☐ Data breach notification within 72 hours of discovery (GDPR Article 33).
- ☐ Data subject request assistance — RealClaw assists controller in responding to DSARs.
- ☐ Deletion / return on termination.
- ☐ Standard Contractual Clauses (SCCs) for transfers to US sub-processors.
- ☐ Audit rights.

---

## 4. TCPA / Communications Compliance Addendum

Standalone addendum or inline in ToS. Core provisions:

- ☐ Agent certifies they possess and will retain documentation of **prior express written consent**
  (PEWC) for every contact receiving SMS through the service.
- ☐ Agent certifies they will not use the service to send SMS to any contact who has opted out
  or is on the National Do-Not-Call Registry without a valid exemption.
- ☐ Agent acknowledges that TCPA statutory damages are **$500–$1,500 per message** and that
  RealClaw bears no liability for violations arising from agent's contact management.
- ☐ RealClaw discloses that the service includes an SMS opt-in/opt-out tracking feature, but that
  this feature does not constitute a DNC compliance program and is not a substitute for
  independent TCPA compliance.

---

## 5. Acceptable Use Policy (AUP)

- ☐ Explicit ban on: discriminatory content, spam, TCPA/CAN-SPAM violations, RESPA kickbacks.
- ☐ Rate limits — agents agree to use the service within documented API rate limits.
- ☐ Consequences of violation: warning, suspension, termination; no refund on termination for cause.

---

## 6. In-App Disclosures Required at Signup / Onboarding

- ☐ Links to Privacy Policy and Terms of Service (Apple App Store requirement; GDPR Art. 13).
- ☐ AI content disclosure: "Communications drafted with AI assistance require your review and
  approval before sending."
- ☐ TCPA acknowledgment checkbox: "I confirm I have prior written consent from my contacts before
  sending SMS through this service."
- ☐ Data processing acknowledgment for GDPR users.

---

## 7. Open Implementation Gaps (Code must be completed before these provisions are enforceable)

| Gap | Legal Provision | Status |
|-----|----------------|--------|
| SMS retention policy (no defined TTL) | GDPR Art. 5(1)(e) / CCPA minimization | ☐ Add migration + purge |
| Email unsubscribe link in footer | CAN-SPAM § 7704(a)(3) | ☑ Implemented |
| Unsubscribe endpoint | CAN-SPAM § 7704(a)(4) | ☑ Implemented |
| Physical address in email footer | CAN-SPAM § 7704(a)(5) | ☑ Via footer.md |
| Data export endpoint | GDPR Art. 20 / CCPA 1798.100 | ☑ Implemented |
| Account delete endpoint | GDPR Art. 17 | ☑ Implemented |
| `do_not_contact` field + enforcement | TCPA / CCPA | ☑ Implemented |
| Email consent field (`email_unsubscribed`) | CAN-SPAM / GDPR | ☑ Implemented |
| RESPA keyword detection | RESPA § 8 | ☑ Implemented |
| AI disclosure footer | FTC Endorsement Guides 2023 | ☑ Implemented |
| Brokerage address + license in ads | State RE advertising law | ☑ Implemented |
| Email body 30-day purge job | GDPR Art. 5(1)(e) | ☑ Implemented |
| Breach notification mechanism | GDPR Art. 33 / state breach laws | ☐ Not implemented |
| Data Processing Agreement template | GDPR Art. 28 | ☐ Not drafted |
| Processing restriction flag | GDPR Art. 18 | ☐ Not implemented |
| DNC registry integration | TCPA / FTC DNC Rule | ☐ Not implemented |
| SMS retention / purge job | GDPR / CCPA | ☐ Not implemented |
| Privacy policy URL in onboarding | GDPR Art. 13 / App Store rules | ☐ Not added to UI |

---

*Last updated: 2026-05-01. Review with qualified legal counsel before publication.*
