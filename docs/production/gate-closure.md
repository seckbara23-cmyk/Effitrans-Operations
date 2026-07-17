# Phase 8.0B — Pilot Gate Closure Runbook & Evidence Ledger

Operational closure of release conditions **C1–C5** (with C6–C8 governance tracking). This is the
working document: each condition has exact steps and an **evidence table to fill as you execute**.
When C1–C5 tables are complete, re-issue [release-decision.md](release-decision.md) as **GO**
(§Promotion at the end).

**State at runbook creation (2026-07-17, verified live):**
production sealed (302 → Vercel SSO) · repo public · production serves `9fe7cc3` on
`effitrans-operations.vercel.app` (+ the two project aliases) · gate tooling (`/api/version`,
sweep script) ships in the 8.0B commit — **deploy it before starting C1**.

---

## C1 — Open and validate production

**Do not start until you are ready to run the supervised session end-to-end (≈ 1–2 h).**

1. Confirm the 8.0B commit is the current production deployment (Vercel → Deployments).
2. Vercel → `effitrans-operations` → Settings → **Deployment Protection** → set **Standard
   Protection: Only Preview Deployments** (production becomes public; previews stay sealed).
3. Run the mechanical sweep (from any machine with Node ≥ 20):

   ```
   node scripts/gate/verify-production.mjs https://effitrans-operations.vercel.app <intended-sha>
   ```

   It verifies: served SHA = intended SHA (`/api/version`), the 8 brief routes + full
   shipping/air subtrees (200 or correct login redirect, no 404/500/loop), portal routes redirect
   to the **portal** login, uniform 404 on unknown card tokens, HSTS/nosniff/XFO headers, and it
   extracts the Supabase project ref production is wired to (feeds C3).
4. Identity session (manual, one row per identity — **any privilege crossover ⇒ stop, re-seal
   production, NO-GO** per the audit):

| Identity | Login OK | Lands on | Cannot reach (spot-check) | Evidence (screenshot/time) |
|---|---|---|---|---|
| Tenant SYSTEM_ADMIN | ☐ | /dashboard | /platform | |
| OPS_SUPERVISOR | ☐ | /dashboard (+ /dashboard/executive renders) | /users | |
| Customs user (CUSTOMS_DECLARANT) | ☐ | /dashboard → Douane | /departments/finance | |
| Driver | ☐ | /driver | /dashboard, /files | |
| Customer portal user | ☐ | /portal | /dashboard, /files, staff APIs | |
| Platform administrator | ☐ | /platform | tenant pages under tenant identity rules | |
| Disabled portal user | ☐ | blocked with honest message | everything | |

5. After the session, run the sweep again and record the SHA. **Every future deploy:** re-run the
   sweep with the new SHA (this operationalizes finding F-5).

**C1 evidence:**

| Item | Result | Date/verifier |
|---|---|---|
| Deployment Protection flipped (production public) | ✅ observed live: production answers from the app, previews still sealed | 2026-07-17 · operator (Vercel) + engineering (probe) |
| Sweep output | ✅ **ALL CHECKS PASSED** — 36/36: version attestation, 8 brief routes + full shipping/air subtrees (staff→/login, portal→/portal/login), no 404/500/loop, uniform card 404, HSTS/nosniff/XFO live | 2026-07-17 · `scripts/gate/verify-production.mjs` against `https://effitrans-operations.vercel.app` |
| Served SHA | ✅ `b07c6773b8cf84e83bf014b562ec5bab6f7d8e0b` (= pushed HEAD), `env=production`, attested by `/api/version` | 2026-07-17 |
| /login renders (product page, French, no error) | ✅ "Plateforme d'opérations Effitrans", email+password+Google, no error output | 2026-07-17 |
| Identity table complete, no crossover | ☐ **PENDING — supervised session with real credentials (operator)** | |

---

## C3 — Environment separation (pilot-blocking; do BEFORE real data)

1. **Production ↔ Preview ↔ local Supabase:**
   - The sweep printed production's Supabase project ref.
   - Vercel → Settings → Environment Variables: read `NEXT_PUBLIC_SUPABASE_URL` for **Preview**
     (and Development). Record the refs (refs are public identifiers, not secrets).
   - Local: the ref inside `.env.local`.
   - **Required: the production ref differs from Preview and local refs.** If any match →
     provision a separate non-production Supabase project, repoint Preview/local, and **rotate
     the production service-role key** (it was in use outside production).
2. **OpenAI credentials:** `AI_API_KEY`/`OPENAI_API_KEY` must exist (if at all) **only in the
   Preview environment**, and the key must belong to the OpenAI *development* project (check the
   key's project label in the OpenAI dashboard). Production: no AI key set → copilots
   deterministic-only (by design until C5 + explicit enablement).
3. **Local Ollama cannot affect Vercel:** already machine-verified in code
   (`AI_LOCAL_PROVIDER_ENABLED` dark default + `VERCEL=1` hosted guard refuses
   localhost/plain-HTTP/unauthenticated — environment-matrix.md §AI, finding I-5). Confirm no
   `AI_LOCAL_PROVIDER_ENABLED`/`OLLAMA_*` var is set in ANY Vercel environment.
4. **Email links:** `NEXT_PUBLIC_SITE_URL` per environment must equal that environment's own URL
   (production: `https://effitrans-operations.vercel.app` until a custom domain exists; Preview:
   the preview URL or unset).

| Check | Value/result | Date/verifier |
|---|---|---|
| Prod Supabase ref (from sweep) | | |
| Preview Supabase ref | | |
| Local Supabase ref | | |
| All different? | ☐ | |
| OpenAI key: Preview-only + dev project | ☐ | |
| Production AI vars absent | ☐ | |
| No OLLAMA_*/local-provider var on Vercel | ☐ | |
| SITE_URL per env correct | ☐ | |

---

## C4 — Email configuration + one real invitation

1. Resend: verify the sender **domain** (DNS records) — `resend.dev` senders are blocked in
   production by code. Then set in Vercel **Production** (exact names):
   `NEXT_PUBLIC_SITE_URL`, `COMMUNICATIONS_EMAIL_PROVIDER=resend`,
   `COMMUNICATIONS_EMAIL_FROM="Effitrans <ops@verified-domain>"`, `RESEND_API_KEY`. Redeploy.
2. Live test: create one pilot user → email arrives → link points at the production domain →
   set password → sign in → correct workspace.
3. Verify in-app: the communication record shows a **provider-backed sent** (email actually
   dispatched), NOT the no-op stub outcome or a link-returned fallback; the audit row exists and
   stores **no setup link and no password**; the email contains **no temporary password**
   (`PORTAL_ALLOW_PASSWORD_EMAIL` unset/false).

| Check | Result | Date/verifier |
|---|---|---|
| Sender domain verified in Resend | ☐ | |
| 4 env vars set in Production | ☐ | |
| Invitation received; link = production domain | ☐ | |
| Password set + login + correct workspace | ☐ | |
| Outcome is provider-backed sent (not link_returned/stub) | ☐ | |
| No password in email; no link persisted/audited | ☐ | |

---

## C2 — Backup & restore drill (do BEFORE real data)

Follow [backup-and-recovery.md](backup-and-recovery.md) §Mandatory restore drill, with the 8.0B
sequence: create a controlled test record → capture/identify the backup covering it → change or
remove the record → restore into a **scratch project** → verify the tenant data + the test record
at its pre-change state → verify storage separately (documents bucket is NOT in DB backups —
record the boundary) → record elapsed time.

Fill the Evidence table in backup-and-recovery.md **and** record here:

| Item | Value | Date/verifier |
|---|---|---|
| Supabase plan tier / backup frequency / retention | | |
| PITR available? decision | | |
| Restore elapsed (RTO evidence) | | |
| Test record verified restored | ☐ | |
| Storage boundary documented | ☐ | |
| Restore owner named | | |

---

## C5 — OpenAI Preview acceptance (AI stays out of production)

1. Set `AI_API_KEY` (dev-project key) in **Preview only**. Push any branch → preview URL
   (previews remain behind Vercel auth — log in with the team account).
2. As OPS_SUPERVISOR, ask the Logistics Copilot: *Quels dossiers nécessitent une action
   aujourd'hui ?* · *Quels documents obligatoires sont manquants ?* · *Quelles factures sont en
   retard ?* — verify grounded answers citing real references, no invented data.
3. As a portal user, ask the Customer AI Assistant: *Où est mon expédition ?* — verify
   customer-safe scope only (own shipment, no internal fields).
4. As CEO/OPS_SUPERVISOR: one executive-assistant question.
5. Controls: unset the key (or set `AI_COPILOT_ENABLED=false`) → deterministic fallback renders
   with honest notice; 13 rapid requests → rate-limit fallback; usage endpoint shows
   tokens/latency; audit rows carry metadata only (no prompt/answer).
6. OpenAI dashboard (dev project) → Usage/Logs after each request: confirm requests appear
   there and nowhere else.

| Check | Result (provider/latency/tokens) | Date/verifier |
|---|---|---|
| Logistics Copilot ×3 grounded | | |
| Customer Assistant scoped | | |
| Executive assistant | | |
| Fallback (kill switch) | ☐ | |
| Rate limit → deterministic | ☐ | |
| Audit metadata-only | ☐ | |
| OpenAI usage visible in dev project | ☐ | |

---

## Governance

**C6 — repository visibility (recommended: private, before opening production).**
GitHub → repo → Settings → General → Danger Zone → Change visibility → Private.
Continuity facts: the Vercel GitHub App is an *installed app* — it retains access to private
repos (deploys keep working); GitHub Actions runs on private repos (minutes are billed to the
account; the current CI uses standard runners). After flipping: push a trivial commit → confirm
CI runs and Vercel deploys. One side effect to accept: the unauthenticated CI-status checks used
during the 8.0A audit stop working (use authenticated access instead).

**C7 — Senegal data-protection review.** The engineering input packet counsel needs is ready:
[data-protection-inventory.md](data-protection-inventory.md). Synthetic-data testing may proceed;
uncontrolled real-data use may not start before the review.

**C8 — Next.js upgrade.** Dedicated pre-GA phase (audit finding F-3): exact before/after
versions, migration notes, full suite (2,25x tests), build, RLS, browser acceptance, route-bundle
comparison, rollback plan. Not part of gate closure.

---

## Promotion to GO

When the five evidence tables above are complete with no failure:

1. Update [release-decision.md](release-decision.md): decision → **GO**, attach the five tables
   (or link here), record the SHA the evidence was collected against.
2. Record C6/C7/C8 residual state as *controlled conditions* in the decision.
3. Proceed to **8.0C — Live Staging/Production Acceptance** (full Part-7 journeys on production
   with test data), then **8.0D — Controlled Pilot Launch** (real users per pilot-plan.md).
