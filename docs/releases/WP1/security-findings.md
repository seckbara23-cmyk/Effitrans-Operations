# WP1 — Security findings and remediation evidence

**Scope:** every security finding raised against WP1 (CEO-ALIGNMENT, PR #51) and the WP1 closure-hardening pull request, from discovery to its current state.
**Sources:** the independent audit of PR #51 at `5ea636d` (Claude Fable 5.1: CONDITIONAL PASS, no BLOCKER, no HIGH), the independent re-review at `ddfcd43` (findings N-1, R-1, R-2, I-1 to I-3), the two CI repairs, and the closure-hardening inspection (AL-1, AL-2).
**Production state when this was written (2026-10-23):** `main` = `2c3acc8` (PR #51), Vercel `dpl_DzSdDCaGUgUqBMpSDmmpPQdTtwwQ`, ledger **161**. The closure items marked *this PR* are **not in production** until that PR is merged and migration #162 goes through its own governed run.

Status vocabulary: **Fixed (production)** = merged and live, verified against production · **Fixed (this PR)** = in the closure pull request, not yet merged or applied · **Documented** = behaviour kept by design and written down · **Accepted** = residual, judged not worth a change, stated · **Open** = needs a decision or a follow-up.

---

## 1. Register

| ID | Severity | Finding | Status | Where it was closed |
|---|---|---|---|---|
| F-1 | MEDIUM | A service-key holder could forge or wipe the expiry history (the migration overstated « impossible whoever holds the service key »). | **Fixed (production)** | #161: every privilege revoked from PUBLIC/`anon`/`authenticated`/`service_role`, SELECT granted back; BEFORE TRUNCATE trigger; EFX04 guard refuses a direct INSERT by any API role whatever its grants. Production run #32, verifier 18/18. |
| F-2 | MEDIUM (HIGH once the inbox is active) | Cubic line wrapping in the e-mail rendition: 20 000 characters took 42.6 s. | **Fixed (production)** | PR #51: linear wrap, header values and body lines bounded; renderer `wp1d-2`. |
| F-3 | LOW | Confirming a proposal whose document had left the verified statuses raised an exception instead of answering. | **Fixed (production)** | #161: `decide_document_expiry_change` answers `proposal_stale`; the approver refuses the proposal to close it. |
| F-4 | LOW | A proposer cannot withdraw their own expiry proposal; with one available approver the document stays blocked. | **Documented — Open (business decision)** | Release manifest §7.5, SOP/manual v2.0 drafts. Allowing withdrawal is the owner's decision; nothing is built. |
| F-5 | LOW | The message lookup named the dossier a message was filed on without checking dossier visibility. | **Fixed (production)** | PR #51: the dossier is named only to someone who can see it. |
| F-6 | LOW | The decision trail lacked DEC-CEO-19/20 and the explicit HARD-PO deferral. | **Fixed** | CEO decision register (owner's working copy) on 2026-10-22; tracked rows in `docs/decision-register.md` in this PR (I-2). |
| F-7 | LOW | Promotion-walk baseline was stale (`20260930000001`). | **Fixed (production)**, superseded by R-2 | PR #51 set `20261020000001`; this PR sets `20261021000005` and fixes the rule (R-2). |
| F-8 | INFO | `service_role` SELECT on the expiry history relied on hosted default privileges. | **Fixed (production)** | #161: explicit `grant select … to service_role`. |
| F-9 | INFO | Verifier #157 cannot discriminate on a seeded database (the seed already writes the new label). | **Documented** | Release manifest §6 and §11: read on production before run #23 (« Quotation Manager ») and after run #24 (« Business Development Manager », code unchanged). |
| F-10 | INFO | The integrity trigger does not check `actor_id`'s tenant. | **Accepted** | Reachable only by a direct INSERT, which F-1's revoke and the EFX04 guard close; the RPCs assert the actor. |
| F-11 | INFO | Rows written in one transaction share `occurred_at`. | **Accepted** | Unreachable through the application (one RPC per request). |
| F-12 | INFO | The history of a soft-deleted document stays readable to its dossier's readers. | **Documented** | Release manifest §7.7 — evidence of decisions taken remains. |
| F-13 | INFO | `anon`/`authenticated` held table-level write and TRUNCATE privileges on the new table in the hosted shape. | **Fixed (production)** | #161 revoke (same change as F-1). |
| F-14 | INFO | The verifier security probe does not exercise the WP1 verifiers. | **Accepted** | They are exercised by the CI verifier sweep and the promotion walk. |
| F-15 | INFO | PGlite returned EFX03 instead of 23505 for a duplicate decision in one multi-statement batch. | **Accepted** | Rehearsal artefact; separate statements are refused by the UNIQUE index. True concurrency remains unverified (single session). |
| CI-REPAIR-01 | — | `service_role` lacked EXECUTE on the #161 RPCs in CI (the local harness masked it with emulated default privileges). | **Fixed (production)** | `5ea636d`: explicit grant; the harness now runs in two privilege shapes. |
| CI-REPAIR-02 | — | A verifier check asserted the ABSENCE of grants, which CI's journey fixture legitimately gives back later. | **Fixed (production)** | `ddfcd43`: the guarantee moved to a structural, grant-independent trigger (EFX04) that the verifier asserts instead. |
| N-1 | MEDIUM (HIGH once the inbox is active) | `htmlToText` was super-linear on hostile HTML and ran on the whole stored body before the cap. | **Fixed (this PR)** | See §2. Renderer `wp1d-3`. |
| R-1 | LOW | The EMP-4 attachment lookup named the dossier an attachment was filed on without checking dossier visibility. | **Fixed (this PR)** | See §3. |
| R-2 | LOW | The walk-baseline rule contradicted itself once every migration was deployed (« nothing to walk » on every later pull request). | **Fixed (this PR)** | `docs/migration-policy.md` *The walk baseline*; CI baseline `20261021000005`; pinned by a test. |
| I-1 | INFO | The EFX04 guard is a denylist of three roles; a future API-facing role would not be covered by it. | **Accepted, stated** | Any new API role must be added to the guard and to the #161 verifier — recorded here so it is not lost. |
| I-2 | INFO | No DEC-CEO rows in the tracked register; SOP/manual drafts silent on stale proposals and on withdrawal. | **Fixed (this PR)** for the register; drafts updated outside git | `docs/decision-register.md` CEO-ALIGNMENT series. The four SOP/manual v2.0 drafts are still uncommitted, awaiting the owner's review. |
| I-3 | INFO | Both lookups still return the *document* id to an inbox reader who cannot see the dossier. | **Accepted** | An opaque UUID; the re-review found no route that resolves a document id without dossier visibility. The dossier id is the disclosure that mattered (F-5, R-1). |
| AL-1 | MEDIUM (latent) | `audit_log` could be emptied by TRUNCATE. | **Fixed (this PR)** — migration #162, **not applied to production** | See §4. |
| AL-2 | LOW (follow-up) | 20 other append-only tables refuse UPDATE/DELETE through `prevent_mutation()` but have no TRUNCATE guard. | **Open** | See §4.4. |

---

## 2. N-1 — the inbound e-mail reduction is linear and bounded

**What was wrong.** `htmlToText` used three regular expressions (`<(script|style|…)\b[\s\S]*?<\/\1\s*>`, `<!--[\s\S]*?-->`, `<[^>]*>`) and a whitespace normaliser whose trailing-space rule backtracks. On unclosed constructs each is quadratic. Measured on the old code: 64 KB of `<` without `>` took 663 ms; a 64 KB whitespace run in `normalizeText` took 1.2 s, and that path is reached by **plain-text** bodies too. The reduction ran on the whole stored body, and only the result was capped at 20 000 characters.

**What changed** (`lib/ec/ingest/message-render.ts`, renderer `wp1d-3`).
- The source is cut to `MAX_SOURCE_CHARS` = 500 000 characters **before** any reduction; the rendition says so in its truncation note.
- Comments, raw-text elements (`script`, `style`, `head`, `noscript`, `template`) and tags are removed by forward `indexOf` scans: every character is visited a bounded number of times. An unclosed element drops only its opening tag, never the rest of the message.
- A `<` that cannot open a tag (`a < b`, `<3`) is kept as text, as a browser does.
- Trailing whitespace is trimmed per line with `trimEnd()` instead of a backtracking pattern.

**Evidence** (`tests/wp1-closure-hardening.test.ts`, N-1 block).
- Differential: 3 000 generated well-formed messages produce byte-identical text under the old reducer and the new one (400 in the committed test, seeded).
- Malformed input: 1 000 messages with stray `<` — every word kept.
- Hostile shapes at 200 000 characters (unclosed `<`, `<script`, `<!--`, `<br`, `<li`; closing-tag lookalikes; a closing-tag prefix followed by whitespace runs) each finish under 500 ms in the test; measured at ≤ 11 ms on 488 KB locally.
- Provenance unchanged: the envelope, the SHA-256 of the original and the renderer version are still written into the rendition; the version string moved to `wp1d-3`, so a rendition says which reducer produced it.

**Residual.** None known for the reducer. The feature stays dark: `communication:inbound:read` is held by no role (RATIFY-EC1-1, DEC-CEO-20 pending).

## 3. R-1 — the attachment lookup names the dossier only to someone who can see it

**What was wrong.** `lookupIngestedDocument` (EMP-4) checked `communication:inbound:read`, then returned `{ id, fileId }` — and the inbox page rendered a link to `/files/{fileId}`. Anyone holding the inbox permission learned which dossier an attachment had been filed on, whether or not they could see that dossier.

**What changed** (`lib/ec/ingest/actions.ts`, `components/ec/attachment-ingest.tsx`). The lookup asks `isFileVisible(user, tenant, fileId)` — the platform's dossier-visibility predicate, the one F-5 gave the message lookup — and returns `fileId: null` when the answer is no. The component then says « Déjà rattachée, à un dossier que vous ne pouvez pas consulter. » with no link. Tenant scoping is unchanged: `findIngestedDocument` reads within the caller's tenant only.

**Evidence** (behavioural, collaborators mocked — `tests/wp1-closure-hardening.test.ts`, R-1 block): visible dossier → `fileId` returned, the predicate having been asked with the caller's own id and tenant; dossier not visible → `fileId: null`; no inbox permission → `null`, and neither the store nor the predicate is called; attachment not filed → `null`. The F-5 message lookup is re-asserted beside it. The authorised filing path itself (`ingestAttachment`) is not touched; its 31 existing tests pass.

## 4. AL-1 — `audit_log` refuses TRUNCATE (migration #162)

### 4.1 What was measured (read-only, production, 2026-10-23)

| Fact | Value |
|---|---|
| Owner, RLS | `postgres`, RLS enabled |
| Raw ACL | `{postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}` (Supabase default privileges) |
| Policies | one: `audit_log_select_scoped` (SELECT, `authenticated`) |
| Triggers | `trg_audit_log_no_update`, `trg_audit_log_no_delete` → `prevent_mutation()`; **none for TRUNCATE** |
| Rows | 3 372 |
| Tables referencing it | `expense_visa` (`audit_log_id`) |
| TRUNCATE guards platform-wide | 1 (`document_expiry_change`, #161) |

TRUNCATE is not a row operation: no row trigger sees it and RLS does not govern it. A plain `truncate audit_log` was refused **only by accident** — Postgres checks `expense_visa`'s foreign key before any TRUNCATE trigger — while `truncate audit_log cascade` would have emptied the audit trail **and every expense signature** in one statement. PostgREST has no TRUNCATE verb and no function truncates, so neither a browser session nor a service-key call could do it; the exposure was direct SQL: an operator's SQL-editor session, a script, a future migration.

### 4.2 What #162 does — and does not

`supabase/migrations/20261023000001_audit_log_truncate_guard.sql`, the same two layers #161 gave the expiry history:
1. a statement-level **BEFORE TRUNCATE** trigger on `prevent_mutation()`: refused for every role, the owner included, with or without CASCADE, whatever the grants;
2. `REVOKE TRUNCATE` from PUBLIC, `anon`, `authenticated`, `service_role`, so the API roles are refused before the trigger is reached.

**Nothing else changes**: INSERT stays (the server records audit rows through the service role), SELECT stays (RLS scopes it), UPDATE and DELETE stay refused by the existing triggers. No data is read or rewritten; re-running it is a no-op. A DO block aborts the migration if the trigger is not bound as required, if the UPDATE/DELETE guards are missing, or if any API role still holds TRUNCATE.

**Limit, stated plainly:** the owner can still drop or disable the trigger, and a superuser can bypass ordinary triggers (`session_replication_role = replica`). The guard stops accidents and every non-owner role; it is not a defence against a deliberate owner. Dropping it is a reviewed migration.

### 4.3 Evidence

- **Verifier** (`supabase/verifiers/20261023000001_audit_log_truncate_guard.verify.sql`), 4 structural checks: the TRUNCATE trigger is BEFORE, statement-level, enabled and bound to `prevent_mutation()`; UPDATE and DELETE are still refused by it; RLS still enabled. It deliberately does **not** assert the absence of a grant (CI-REPAIR-02).
- **Behavioural test** (`supabase/tests/rls_audit_log_truncate_test.sql`, a new CI step after the WP1 suite): `service_role` TRUNCATE with and without CASCADE → 42501; `authenticated` → 42501; the owner's plain TRUNCATE → refused (0A000, the foreign key); the owner's **TRUNCATE … CASCADE → P0001 from the trigger**; after a broad `grant truncate on all tables … to service_role`, its TRUNCATE … CASCADE → still P0001; the owner and `service_role` (where it holds INSERT) still append; UPDATE and DELETE still refused; row count = before + appended rows. All in BEGIN/ROLLBACK.
- **Disposable-database rehearsal** (PGlite, PostgreSQL 16 in WASM), in both privilege shapes (hosted default privileges, and none): 162/162 migrations from empty, seed OK, 25/25 verifiers, the three suites PASS, re-apply idempotent, **27/27 negative controls caught** (12 new for #162: trigger dropped, disabled, re-bound to a no-op, moved to AFTER; UPDATE/DELETE guard dropped; RLS disabled; TRUNCATE re-granted to `service_role` or `authenticated`; the migration without its REVOKE aborts), and every verifier still passes after CI's journey-fixture grants.
- **Pins** (`tests/wp1-closure-hardening.test.ts`): the migration revokes TRUNCATE and nothing else and grants nothing; the verifier never calls `has_table_privilege`; the CI step sits after the WP1 suite and before the journey fixture; the test reaches the trigger through CASCADE.

### 4.4 AL-2 — follow-up: the other append-only tables

These tables refuse UPDATE (and most DELETE) through `prevent_mutation()` and have **no** TRUNCATE guard. Each holds evidence the platform treats as append-only. Recommended: one migration per business area, same two layers, each with its own verifier — not folded into WP1.

`air_tracking_event` · `assignment_event` · `business_event` · `collection_follow_up` · `customs_reference_scan` · `document_review` · `ec_inbound_attachment` · `ec_inbound_message` · `ec_webhook_event` · `evidence_consumption` · `expense_authorization_version` · `expense_visa` · `expense_voucher_version` · `file_state_transition` · `hr_employee_event` · `hr_template_version` · `invoice_deposit_event` · `legacy_receivable_link` · `ocean_tracking_event` · `provider_webhook_event`

(Four of them — `air_tracking_event`, `collection_follow_up`, `file_state_transition`, `ocean_tracking_event` — also have no DELETE guard; whether that is intended is part of the same follow-up.)

---

## 5. What stays dark, and why

| Capability | Gate | Before it can be opened |
|---|---|---|
| Filing a client's instructing e-mail from the inbox (WP1-D) and EMP-4 attachment filing | `communication:inbound:read`, held by no role (RATIFY-EC1-1) | DEC-CEO-20 decided by the owner. N-1 and R-1 — the two code conditions the re-review set — are fixed in this PR and must be **merged and deployed** first. |
| HARD « PO client » requirement before step-3 completion | not built (WP1 PR-2) | DEC-CEO-19 (exception policy) and the department-queue fix (`lib/process/queues/service.ts` counts any missing evidence as « bloqué »). |
