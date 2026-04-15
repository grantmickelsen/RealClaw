# OTA Update Changelog

Per Apple Guideline 2.5.2, every EAS OTA update published to the `production`
channel must be logged here with the commit SHA, affected channel, and explicit
justification that the change falls within the "bug fix / performance improvement"
scope permitted without App Store review.

The `check-ota-safety.mjs` script automatically blocks disallowed changes from
reaching `production` via OTA. This log is the human-readable audit trail.

**Format:** `date | channel | commit SHA | justification`

---

<!-- Add new entries at the TOP (newest first) -->

<!-- Example entry:
2026-04-14 | production | sha-abc1234 | Fix: correct timezone offset in morning briefing
  copy. No native code changes. No new permissions. Verified by check-ota-safety.mjs.
-->
