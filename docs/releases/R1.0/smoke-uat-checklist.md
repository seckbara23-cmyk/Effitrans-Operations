# R1.0 Smoke & UAT Checklist · R1.1 Activation Checklist

Companion to the [reconciliation runbook](reconciliation-runbook.md). Run **after** the
ledger repair verifies 72/72 *(done — 2026-07-31)*.

> **Execute from [`operator-validation-checklist.md`](operator-validation-checklist.md)**,
> which is the step-by-step form of §A–B below: exact URL, seat, clicks, expected result,
> pass/fail criterion and the remedy on failure. This page remains the summary contract;
> record the outcome in [`../release-signoff-R1.0.md`](../release-signoff-R1.0.md). Every step is performed by the named seat on production,
with test-designated records only. Record each result inline (✔/✘ + date + initials) —
this document, filled in, becomes the release's UAT record.

## A. R1.0 technical smoke (operator)

| # | Check | How | Pass criterion |
|---|---|---|---|
| A1 | Served SHA | `curl https://effitrans-operations.vercel.app/api/version` | `sha` = current `main` HEAD; `env=production` |
| A2 | Core sweep | `node scripts/gate/verify-production.mjs` (pass the expected SHA per the script header) | exit 0 |
| A3 | Migration probe | `/platform/operations` (platform login) | probe row present; no drift warning |

## B. R1.0 business UAT

### B1 — UAT-2B three-hash verification (seat: Finance / DAF)

1. Staff side: open invoice **EFT-INV-2026-00001** → download the official PDF.
   *The first download performs the backfill render — expected, once.*
   Record the `X-Invoice-Sha256` response header.
2. Portal side: log in as the pilot customer → download the same invoice. Record header.
3. SQL editor (read-only):
   `select content_sha256 from public.document where artifact_code='OFFICIAL_INVOICE' and invoice_id = (select id from invoice where invoice_number='EFT-INV-2026-00001');`
4. **Pass:** all three values identical. Record the hash here: `________`

### B2 — Douane discovery (seat: Chef de transit / any customs role)

1. Log in as a customs account with **no dossier assignment**.
2. **Pass:** dossiers with a live, required `customs_record` are visible in the customs
   workspace; a dossier with `required=false` customs is not.

### B3 — Dossier closure (seat: OPS_SUPERVISOR)

1. Open **EFT-IMP-2026-00003** → « Clôture du dossier » → « Avancer → Clôturé ».
2. **Pass:** transition succeeds (the `file:transition` grant is live); the closure gate
   names no blocker (customs RELEASED, POD received, invoice settled & verified — all
   previously validated); status history + audit row written.

### B4 — Temporary password lifecycle (seat: tenant SYSTEM_ADMIN + a TEST account)

1. `/users` → details page of a **test** account → « Générer un nouveau mot de passe
   temporaire » → reason required → confirm.
2. **Pass:** password displayed once with expiry + copy button; dialog says it cannot be
   retrieved again; audit row carries actor/target/reason/IP — never the password.
3. Log in as the test account with the temp password.
   **Pass:** forced to `/auth/change-password` before any app page; after changing,
   session continues to `/dashboard`.
4. **Expired-path** — the honest options, pick one and record which:
   - **(a) Preview verification (recommended):** in the *preview* environment, set the
     test row's `temp_password_expires_at` into the past (a write — permitted there),
     log in → **Pass:** terminal notice at `/auth/password-expired`, no exchange possible.
   - **(b) Production wait:** issue a temp password to the test account and verify after
     24 h.
   Production writes to force expiry are **not** authorized by this checklist.

## C. R1.0 sign-off

| Seat | Scope | Result / date / initials |
|---|---|---|
| Operator | A1–A3 | |
| DAF | B1 | |
| Chef de transit | B2 | |
| OPS supervisor | B3 | |
| SYSTEM_ADMIN | B4 | |

R1.0 is **complete** when every row above is recorded and `STATUS.md` is updated.

---

## D. R1.1 activation checklist (Finance Aging)

Migration 72's schema **and grants** are already live; the workspace stays dark solely
because `EFFITRANS_FINANCE_AGING_ENABLED` is unset in production (route 404s). R1.1 is
therefore **pure activation** — and it does not begin until its gates close:

| # | Gate / step | Owner | Status |
|---|---|---|---|
| D1 | **Q-01 formally closed**, recorded verbatim: « Montant = outstanding balance as of the reporting date » | Finance Manager | ☐ |
| D2 | Aging preview **visual sign-off** recorded (checklist in `docs/finance/aging/preview-runbook.md` §4) | Finance Manager | ☐ |
| D3 | R1.0 sign-off complete (§C above) | operator | ☐ |
| D4 | Verify grants match the ratified matrix (read-only): `select r.code, p.code from role_permission rp join role r on r.id=rp.role_id join permission p on p.id=rp.permission_id where p.code like 'finance:aging:%' order by 1,2;` — SYSTEM_ADMIN must NOT hold validate/finalize/import_approve/share/template_manage | operator | ☐ |
| D5 | Set `EFFITRANS_FINANCE_AGING_ENABLED=true` on the **Production** Vercel environment; redeploy | operator | ☐ |
| D6 | Smoke: « Balance âgée » tile appears on `/departments/finance` for a `finance:aging:read` holder and NOT for others; `/finance/aging` renders all five tabs; foreign-currency exclusion notice appears when applicable; the view states it is provisional | DAF | ☐ |
| D7 | DAF business sign-off recorded | DAF | ☐ |

R1.1 is **complete** at D7. Not before D1 — the activation order is deliberate: the
number's meaning is confirmed before the number is shown.
