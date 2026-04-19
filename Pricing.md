# RealClaw — Cost & Pricing Estimates

> Estimates as of April 2026. LLM costs are the dominant variable; actual spend will depend heavily on agent usage intensity.

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
| Redis (Upstash / Railway) | $5 | $20 | $75 | Per-command pricing scales up |
| RentCast API (market data) | $99 | $199 | $499 | Shared key; higher tier unlocks more call volume |
| Expo EAS Build & Updates | $0 | $99 | $99 | 30 free builds/mo; Production plan for OTA updates |
| **Fixed subtotal** | **~$124–149** | **~$448** | **~$1,223** | |

---

## Variable Monthly Costs (per MAU)

Assumes a typical real estate agent on a standard workday:
- 1 daily briefing (market + calendar summary)
- ~8 chat interactions/day
- ~5 drafted emails or texts/day
- ~20 active work days/month
- **≈ 280 LLM calls/month** averaging ~2,200 input + ~600 output tokens each

### LLM API (Claude / Anthropic)

| Tier | Model | $/MTok in | $/MTok out | Estimated $/MAU/mo |
|------|-------|-----------|------------|-------------------|
| ⚡ Fast | Claude Haiku 4.5 | $0.80 | $4.00 | ~$0.55 |
| ⚖️ Balanced | Claude Sonnet 4.6 | $3.00 | $15.00 | ~$4.40 |
| 🧠 Best | Claude Opus 4.7 | $15.00 | $75.00 | ~$22.00 |

**Blended estimate** (assuming 20% Fast / 70% Balanced / 10% Best):
> ~$5.30/MAU/month

### Other Variable Services

| Service | Estimate | Assumption |
|---------|----------|------------|
| Twilio SMS | $0.40–$1.60/MAU | 50–200 outbound SMS/mo @ $0.0079/segment |
| RentCast call volume overage | $0–$0.50/MAU | Comp analysis + briefing calls |
| Hosting overhead at scale | $0.30–$0.60/MAU | DB connections, CPU, bandwidth |

**Total variable: ~$6.00–$8.00/MAU/month**

---

## Total Monthly Cost Estimates

| Scale | Fixed | Variable | **Total/mo** | **Per-user cost** |
|-------|-------|----------|-------------|-------------------|
| **1 MAU** | $140 | $7 | **~$147** | $147 |
| **10 MAU** | $145 | $70 | **~$215** | $21.50 |
| **100 MAU** | $450 | $700 | **~$1,150** | $11.50 |
| **1,000 MAU** | $1,225 | $7,500 | **~$8,725** | $8.73 |

---

## Annual Cost Summary

| Scale | Monthly | **Annual** |
|-------|---------|-----------|
| 1 MAU | $147 | ~$1,860 |
| 10 MAU | $215 | ~$2,580 |
| 100 MAU | $1,150 | ~$13,800 |
| 1,000 MAU | $8,725 | ~$104,700 |

---

## Break-Even Pricing (suggested subscription tiers)

To maintain ~50% gross margin:

| Tier | Target MAU | Cost/user | Suggested price | Gross margin |
|------|-----------|-----------|-----------------|--------------|
| Solo | 1–10 | $21.50 | **$49/mo** | ~56% |
| Team | 10–100 | $11.50 | **$29/mo** | ~60% |
| Brokerage | 100–1,000 | $8.73 | **$19/mo** | ~54% |

> "Best" AI tier users cost ~$22/MAU in LLM alone — consider a premium add-on (+$10-15/mo) for agents who select that tier.

---

## Key Assumptions & Risks

1. **LLM costs dominate.** At 1,000 MAU, Claude API is ~86% of variable costs. A shift from Balanced → Best tier by 50% of users roughly doubles total variable spend.
2. **RentCast is a shared key.** One plan covers all tenants; cost doesn't scale linearly with users, but call volume limits may require plan upgrades at ~100+ MAU.
3. **Twilio scales with agent behavior.** A high-volume SMS user (100+ texts/day) could cost $6-10/month in Twilio alone — an outlier worth monitoring.
4. **Hosting is conservative.** Estimates use managed services (Railway/Render). Self-managed VPS or AWS EC2 can reduce hosting costs by 30–50% at 1K MAU with DevOps investment.
5. **Expo EAS** is capped at $99/month regardless of user count — good leverage at scale.
6. **No payment infrastructure costs included.** Stripe charges 2.9% + $0.30/transaction; factor into pricing if billing in-app.

---

## Cost Reduction Levers (as you scale)

- **Prompt caching**: Anthropic's prompt caching reduces repeat-context token costs by up to 90% on cached prefixes (e.g. system prompts, agent personas).
- **Downgrade briefing model**: Daily briefings can run on Haiku instead of Sonnet, saving ~$1/MAU/month.
- **Batch RentCast calls**: Pre-fetch market data for all tenants' primary ZIPs in one scheduled job rather than per-request.
- **Self-host Redis + Postgres**: At 1K MAU, moving to a bare-metal or EC2 setup saves ~$200-300/month.
