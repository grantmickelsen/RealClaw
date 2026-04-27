# RealClaw — Cost & Pricing Estimates

> Estimates as of April 2026. Updated to reflect full feature scope: Deals Hub, Showings/Tours, Contacts CRM, SMS, Content Studio, and Open House. LLM costs are the dominant variable; actual spend depends heavily on agent usage intensity.

---

## One-Time Setup Costs

| Item | Cost | Notes |
|------|------|-------|
| Apple Developer Program | $99/year | Required for iOS App Store distribution |
| Google Play Developer Account | $25 | One-time lifetime fee |
| Domain name | $15/year | e.g. realclaw.com via Namecheap/Cloudflare |
| SSL certificate | $0 | Free via Let's Encrypt / Cloudflare |
| Expo account | $0 | Free tier covers initial setup |
| **Total (first year)** | **~$139** | |

---

## Fixed Monthly Infrastructure

These costs apply regardless of how many users are active.

| Service | 1–10 MAU | 100 MAU | 1,000 MAU | Notes |
|---------|----------|---------|-----------|-------|
| Backend hosting (Railway / Render) | $20 | $80 | $350 | Auto-scaling at 1K |
| PostgreSQL (managed, e.g. Neon / Supabase) | $0–25 | $50 | $200 | Free tier covers early stage |
| Redis (Upstash / Railway) | $5 | $25 | $85 | Slightly higher: 2 daily BullMQ jobs per tenant (briefing + deal deadline monitor) |
| RentCast API (market data) | $99 | $199 | $499 | Shared key across all tenants; higher tier for more call volume |
| Expo EAS Build & Updates | $0 | $99 | $99 | 30 free builds/mo; Production plan for OTA updates |
| **Fixed subtotal** | **~$124–149** | **~$453** | **~$1,233** | |

---

## Variable Monthly Costs (per MAU)

### Usage Model

With the full agent platform (11 agents, 28 WS event types), a typical active agent generates roughly **400 user-visible actions/month** — up from the original 280 estimate. Because the multi-step pipeline (coordinator routing → agent execution → synthesis) makes ~2.5 LLM calls per user action, the backend processes **~700–800 internal LLM calls/month per MAU**.

Key factors that changed from the original estimate:
- **Deal ingest** uses POWERFUL (Opus) tier — accurate contract extraction is high-stakes
- **Property curation** (batch scoring) runs on FAST — very efficient, offsets cost
- New features: contact dossier, field oracle, content studio, SMS suggestions

---

### LLM API — Per-Capability Cost Breakdown

#### Model Pricing (April 2026)

| Tier | Model | $/MTok in | $/MTok out |
|------|-------|-----------|------------|
| ⚡ FAST | Claude Haiku 4.5 | $0.80 | $4.00 |
| ⚖️ BALANCED | Claude Sonnet 4.6 | $3.00 | $15.00 |
| 🧠 POWERFUL | Claude Opus 4.7 | $15.00 | $75.00 |

#### Per-Capability Monthly Cost (per MAU, 20 working days)

| Feature / Capability | Calls/mo | Tier | Input | Output | Cost/MAU |
|---|---|---|---|---|---|
| Daily briefing (ops job) | 20 | ⚡ FAST | 24K | 12K | $0.07 |
| Chat coordinator routing | 160 | ⚡ FAST | 32K | 16K | $0.09 |
| Chat synthesis (final response assembly) | 160 | ⚡ FAST | 320K | 32K | $0.39 |
| Agent execution per chat (8/day) | 160 | ⚖️ BALANCED | 320K | 128K | $2.88 |
| SMS reply suggestions (4 threads/day) | 80 | ⚡ FAST | 40K | 12K | $0.08 |
| Email drafts (3/day) | 60 | ⚖️ BALANCED | 60K | 24K | $0.54 |
| Contact dossier (2 views/day) | 40 | ⚖️ BALANCED | 60K | 24K | $0.54 |
| Comp analysis (0.5/day) | 10 | ⚖️ BALANCED | 20K | 12K | $0.24 |
| Property curation batch scoring | 10 | ⚡ FAST | 30K | 5K | $0.04 |
| Field oracle (property deep-dive) | 5 | ⚖️ BALANCED | 25K | 12.5K | $0.26 |
| Content Studio (listing copy, social, email) | 8 | ⚖️ BALANCED | 16K | 12K | $0.23 |
| Deal ingest (contract extraction) | 2 | 🧠 POWERFUL | 8K | 2K | $0.27 |
| Showing day propose + route optimize | 8 | ⚖️ BALANCED | 16K | 8K | $0.16 |
| Open house debrief | 1 | ⚖️ BALANCED | 3K | 2K | $0.04 |
| **Monthly totals** | **~746** | | **~974K** | **~301K** | **~$5.84** |

**Tier split:** ⚡ FAST: $0.55 | ⚖️ BALANCED: $5.02 | 🧠 POWERFUL: $0.27

> **Note on compliance scanning:** The `ComplianceAgent` content_scan, fair_housing_check, and `property_disclosure_check` are pattern-matching and rule-engine logic — no LLM calls. The `deal-deadline-monitor-job` is also LLM-free (pure SQL). These represent zero LLM cost despite high operational value.

---

### Other Variable Services

| Service | Estimate | Assumption |
|---------|----------|------------|
| Twilio SMS | $0.40–$1.60/MAU | 50–200 outbound SMS/mo @ $0.0075/segment |
| Google Maps API *(new)* | $0.30–$1.10/MAU | Route optimization: 4 showing days/mo × 25-element distance matrix + geocoding. Only for agents with active buyer clients. |
| OpenAI DALL-E *(new)* | $0.10–$0.50/MAU | Virtual staging: 8–20 image edits/mo @ $0.025 each. Zero cost for non-listing agents. |
| RentCast call volume overage | $0–$0.50/MAU | Comp analysis + briefing market data calls |
| Hosting overhead at scale | $0.35–$0.65/MAU | DB connections, CPU, bandwidth |
| Expo Push Notifications | $0/MAU | Free up to 1M pushes/month total; not a near-term constraint |

**Total variable: ~$7.00–$10.00/MAU/month** (midpoint ~$9.00, up from $7.00 in original estimate)

---

## Total Monthly Cost Estimates

| Scale | Fixed | Variable | **Total/mo** | **Per-user cost** |
|-------|-------|----------|-------------|-------------------|
| **1 MAU** | $140 | $9 | **~$149** | $149 |
| **10 MAU** | $145 | $90 | **~$235** | $23.50 |
| **100 MAU** | $455 | $900 | **~$1,355** | $13.55 |
| **1,000 MAU** | $1,235 | $9,000 | **~$10,235** | $10.24 |

---

## Annual Cost Summary

| Scale | Monthly | **Annual** |
|-------|---------|-----------|
| 1 MAU | $149 | ~$1,790 |
| 10 MAU | $235 | ~$2,820 |
| 100 MAU | $1,355 | ~$16,260 |
| 1,000 MAU | $10,235 | ~$122,820 |

---

## Pricing Model

### Option A — Flat Per-Seat (Simplest)

Three tiers, all features included, discounted at volume:

| Tier | Price | Target | Gross Margin |
|------|-------|--------|--------------|
| **Solo** | $59/mo | 1–4 agents | ~60% at 10 MAU |
| **Teams** | $49/mo/seat | 5–14 seats | ~54% at 100 MAU |
| **Brokerage** | $39/mo/seat | 15+ seats | ~62% at 1K MAU |

Pros: Simple to sell, no feature anxiety, agents know exactly what they pay.
Cons: Power users (listing agents heavy on Content Studio + virtual staging; buyer's agents running 5+ showings/week) are subsidized by lighter users.

---

### Option B — Tiered by Feature Set *(Recommended)*

| Tier | Price | Included |
|------|-------|----------|
| **Starter** | $39/mo | Briefing, Contacts CRM, Comms (SMS + email drafts), basic Deals (milestone tracking, compliance checklist) |
| **Professional** | $79/mo | Everything in Starter + Content Studio (listing copy, social, email campaigns, virtual staging), full Showings/Tours (property scoring, route optimization, field oracle), full Deals (contract ingest via Opus, P0/P1 alerts), Open House Kiosk |
| **Brokerage** | $59/mo/seat (10+ seats) | Professional features, team admin dashboard, priority support |

**Why this split:**
- The Starter features (Comms, basic Deals, Briefing) cost ~$6–7/MAU in LLM — healthy margin at $39.
- Professional features add DALL-E, Google Maps, and the POWERFUL-tier deal_ingest call — costs ~$9–10/MAU — still solid margin at $79.
- Listing agents and transaction coordinators who need Content Studio and full Deals will obviously pay for Professional. Buyer's agents benefit most from Showings.

**Gross margin check at 100 MAU (mix of Starter + Professional):**
- If 60% Starter ($39), 40% Professional ($79): blended revenue = $55.40/seat
- Blended cost = $13.55/seat → **~75% gross margin** ✓

---

### Option C — Base + Usage Add-ons (Not Recommended)

| Item | Price |
|------|-------|
| Base plan | $49/mo (all features) |
| Virtual staging | $0.99/image |
| Deal ingest overage | First 2/mo included; $4.99 each additional |

Not recommended: real estate agents dislike usage counters. Creates friction and support burden.

---

### Recommended: Go with Option B

**Rationale:**
1. Aligns price with actual cost drivers (POWERFUL-tier ingest, DALL-E, Maps are in Professional only)
2. Real estate agents self-select clearly: listing agents/TCs → Professional; referral-heavy or buyer's agents → Starter
3. Brokerage volume discount at 10+ seats creates a natural upsell path
4. Virtual staging bundled into Professional avoids per-image anxiety
5. Stripe fees (2.9% + $0.30/transaction) are absorbed within the margin at these price points

---

## Break-Even Analysis (Option B)

| Scale | Cost/seat | Starter ($39) margin | Professional ($79) margin |
|-------|-----------|----------------------|--------------------------|
| 10 MAU | $23.50 | 40% | 70% |
| 100 MAU | $13.55 | 65% | 83% |
| 1,000 MAU | $10.24 | 74% | 87% |

---

## Key Assumptions & Risks

1. **LLM costs dominate.** At 1,000 MAU, Claude API is ~85% of variable costs. A shift to heavier Opus usage (e.g., if deal_ingest is used 10×/month instead of 2×) roughly triples the POWERFUL-tier spend.

2. **DALL-E spikes.** A listing agent with 5 active listings doing 4 staging variants per listing/month = 20 images = $0.50 in DALL-E plus content agent LLM. Bundles into Professional cleanly, but monitor outliers.

3. **Google Maps scales with showing volume.** An agent doing 4 showings/week (high-activity buyer's agent) could run 16 route optimizations/month instead of 4, pushing Maps costs to $4+/MAU. Monitor top-decile users.

4. **RentCast is a shared key.** One plan covers all tenants; cost doesn't scale linearly with users. Call volume limits may require plan upgrades at 100+ MAU.

5. **Twilio outliers.** A high-volume SMS user (200+ texts/day, e.g. farm area agent) could cost $12–15/month in Twilio alone. Consider a soft SMS cap at 1,000 outbound/month with a $0.01/message overage for Starter.

6. **Property scoring is FAST-tier (efficient).** The showings agent batches all listings into one FAST call for scoring — this does not scale poorly with buyer criteria complexity.

7. **Hosting is conservative.** Estimates use managed services. Self-managed VPS at 1K MAU saves ~$200–300/month with DevOps investment.

8. **No payment infrastructure costs included.** Stripe charges 2.9% + $0.30/transaction; built into margin analysis above.

---

## Cost Reduction Levers (as you scale)

- **Prompt caching**: Anthropic's prompt caching reduces repeat-context token costs by up to 90% on cached prefixes (SOUL.md system prompts, agent personas, disclosure rules). Highest impact on chat-heavy users.
- **Downgrade synthesis to Haiku**: The coordinator synthesis step (final response assembly) can run on Haiku instead of Sonnet with minimal quality loss, saving ~$0.39/MAU/month.
- **Batch briefing model to Haiku**: Daily briefing already uses FAST tier — no savings left.
- **Cache field oracle per property**: Already implemented — `field_oracle_cache` column in `property_results` table means the same property is never researched twice.
- **Batch RentCast calls**: Pre-fetch market data for all tenants' primary ZIPs in one scheduled job rather than per-request.
- **Self-host Redis + Postgres**: At 1K MAU, moving to a bare-metal or EC2 setup saves ~$200–300/month.
- **OpenRouter for BALANCED calls**: OpenRouter can route BALANCED-tier requests to Gemini 2.5 Pro ($1.25/$10 per MTok) instead of Sonnet ($3/$15) with comparable quality on drafting tasks. Potential 60% reduction in BALANCED-tier costs.
