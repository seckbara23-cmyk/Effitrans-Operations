# FND-R11-01 — No preview environment exists; D2 not executable as specified

**Raised:** 2026-08-01, by the operator's D2 Step-1 preflight — **the stop condition
working exactly as designed.** No data, migration, flag or account was touched.

## The finding

| Assumed (preview-runbook §1, D2 guide) | Actual |
|---|---|
| A preview Supabase project, ref ≠ `xtpppzhkiagdpmnghdlc` | **One** Supabase project — production |
| A Vercel Preview environment wired to it | Vercel deploys **Production only** |
| Synthetic dataset + reviewer login land in an isolated DB | nowhere to land |

The deeper fact: the FIN-AGING-3A preview-runbook (2026-07-24) *specified* a preview
procedure without auditing that the environment existed. It never did. Every document
that has since said « preview » — including the B4 expired-path deferral and the R1.0-R
temp-password note « verified in PREVIEW only » — inherited an assumption, not a fact.
CI's ephemeral Postgres is the only non-production database this platform has ever had,
and it lives for minutes.

## Standing items that depend on a preview environment (not only D2)

1. **D2** — the aging visual sign-off (this gate).
2. **B4 expired-path** — deferred from R1.0 *"preview-only by rule"*; with no preview,
   that deferral currently has no execution path at all.
3. **R1.2 rehearsal** — the FIN-AGING-4 import of ~430 real receivables should be
   rehearsed against a non-production DB before the real run (staging + maker-checker).
4. **HR-1C legacy import** — same shape, larger.

## The two options, honestly costed

### Option A — amend governance to a Production-only model

What it would actually require, stated plainly:

- **The synthetic dataset cannot follow.** Its own header forbids production, and demo
  rows in the production DB are the exact contamination class the 8.0C audit flagged and
  cleaned. Loading it anyway would reverse a standing doctrine.
- A production-only D2 must therefore review **real data**: currently ~1 issued invoice
  and 3 dossiers. Of the V8 dataset states (seven buckets, 365/366 boundary, partial
  payment, overpayment, dispute, EUR exclusion, « Faible » floor, back-dated arrêté),
  **almost none is exercisable**. The review shrinks to "the page renders and the one
  number is right".
- The flag must go ON in production **before** the Finance Manager has signed — visible
  to every `finance:aging:read` holder in every tenant. That inverts the ratified
  activation order (« the number's meaning is confirmed before the number is shown »),
  so this path requires **re-ratifying D2**, not merely amending prose.
- B4-expired and the R1.2 rehearsal remain homeless.

### Option B — provision a formal preview environment, then run D2 unchanged

- **Scope (deliberately minimal):** one additional Supabase project (free tier is
  sufficient — it holds only migrations + synthetic data) + Vercel **Preview**
  environment variables (`NEXT_PUBLIC_SUPABASE_URL`, anon key, service-role key,
  `EFFITRANS_FINANCE_AGING_ENABLED=true`) + one pushed branch to mint a preview build.
- **Effort:** roughly an hour of operator time; no code change; nothing touches
  production.
- **Pays four debts at once:** D2 now, B4-expired's only execution path, the R1.2
  rehearsal venue, HR-1C later.
- **Cost:** a second project to keep patched at release time — mitigated by the fact it
  holds nothing real and can be reset from migrations at will.

## Recommendation

**Option B.** Option A does not actually save the work — it converts an hour of
provisioning into a re-ratification of a deliberately ordered gate, a near-empty review,
and two standing deferrals with no execution path. The platform has reached the point
(real money on screen, imports ahead) where "no non-production database" is the anomaly,
not the preview requirement.

If B is chosen, the provisioning sequence is §Step-B below; D2 then resumes at Step 2 of
the existing guide with **no changes to it** — the preflight simply starts passing.

### Step-B — provisioning sequence (operator, ~1 h)

1. Supabase: create project `effitrans-preview` (any region; free tier). Record its ref.
2. Apply the schema: run migrations 1→72 in order (`supabase db push` against the
   **preview** ref is acceptable there — the 9.0F prohibition protects *production's*
   ledger; a disposable preview DB is reset-from-migrations by design. Alternatively
   `supabase link --project-ref <preview-ref> && supabase db push` from a scratch clone
   to keep the working repo linked to production).
3. Vercel → Environment Variables → add the three Supabase values scoped **Preview**,
   plus `EFFITRANS_FINANCE_AGING_ENABLED=true` scoped **Preview**.
4. Push branch `preview/aging-d2` → Vercel builds it with the Preview env.
5. Resume the D2 guide at Step 1's fingerprint (it must now pass), then Steps 3–7.

**Decision:** ☑ **Option B — DECIDED AND EXECUTED 2026-08-01** · Decided by: operator (Bara Seck)

Provisioned: preview project **`qrotqyaaugyzgljcwcpg`** (≠ production `xtpppzhkiagdpmnghdlc` ✔).
Verified by the operator: **72/72 migrations** · fingerprint clean before seed
(`org_count = 0`, `invoice_count = 0`, production invoice absent) · synthetic dataset
loaded · **Q-01 data-level check: `DEMO-INV-0023` outstanding = 5 000 000** (8 M billed −
3 M paid). D2 resumes at the reviewer-login step of
[`d2-preview-execution.md`](d2-preview-execution.md); the on-screen Q-01 check (V8)
still applies at review time.
