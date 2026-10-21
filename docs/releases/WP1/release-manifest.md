# Release WP1 — Commercial & dossier opening (CEO-ALIGNMENT) — RELEASE MANIFEST

**Status:** RELEASE CANDIDATE — not pushed, not merged, not deployed, no production migration applied.
**Base:** `main` = production = `08f4397390cd4be810255f510a42bc60028afc7b` (Vercel `dpl_A71wTkPd8dt4ZsgL9N3Q1WoakJ6A`, READY), ledger 156.
**Branch:** `feat/wp1-commercial-opening` (the RC SHA is the branch head at PR time; recorded in the PR).
**Approved decisions:** DEC-CEO-01, DEC-CEO-02, DEC-CEO-03 (owner, 2026-10-21). **Not in this release:** WP1 PR-2 (HARD PO gate + exception policy, blocked on DEC-CEO-19).

---

## 1. What ships

| Slice | CEO req. | What changes for an operator |
|---|---|---|
| WP1-A | CEO-001 | The role is displayed « Business Development Manager ». Code `QUOTATION_MANAGER`, permissions and assignments unchanged. |
| WP1-B1 | CEO-003 | « PO client » on the dossier form (optional), shown in « Identification du dossier ». An import dossier without one shows « Information à compléter : PO client (ouverture du dossier, étape 3) ». **Never blocking.** |
| WP1-C | CEO-003 | « Régime douanier prévu » on the dossier form (free text, suggestions). Shown READ-ONLY in the customs panel to the Déclarant and the Chef de Transit. Never written into the governed « Régime ». |
| WP1-D | CEO-004 | New document type « Ordre de transit / instruction client » in the ordinary upload. In the mail inbox, « Rattacher ce message au dossier comme ordre de transit » files a PDF rendition of the captured e-mail (envelope + original SHA-256 + text). **Dark today** — see §7. |
| WP1-E | CEO-006/010 | « Modifier l'échéance » on an unverified document (reason mandatory, history kept); « Proposer une nouvelle échéance » on a verified one, confirmed or refused by another `document:approve` holder. The document's status never changes. |
| WP1-F | CEO-002 | Tests, verifiers, RLS suite, this manifest, UAT cases, SOP/manual change list. |

## 2. Migration bundle (strict order — one governed run each)

| # | Version | File | Executor | Writes rows? | Verifier |
|---|---|---|---|---|---|
| 157 | `20261021000001` | `role_label_business_development_manager` | db-query | **1 row** (two labels of one `role` row) | 4 checks |
| 158 | `20261021000002` | `file_client_po_and_regime` | db-query | no | 6 checks |
| 159 | `20261021000003` | `document_type_ordre_de_transit` | db-query | 1 catalogue row (`document_type`, global) | 4 checks |
| 160 | `20261021000004` | `document_source_message` | db-query | no | 6 checks |
| 161 | `20261021000005` | `document_expiry_change` | db-query | no (table, triggers, 2 RPCs) | 14 checks |

All additive. No backfill. No historical dossier, step execution, document status or audit row is read-and-rewritten. `build-info.ts` pins `LATEST_MIGRATION = 20261021000005_document_expiry_change`, `MIGRATION_COUNT = 161`.

## 3. Activation list

**None.** No environment flag, no permission grant, no tenant rollout row. Each feature activates itself when its schema exists, through a zero-row probe (`lib/files/opening-fields-158.ts`, `lib/ec/ingest/message-provenance-160.ts`, `lib/documents/expiry-governance-161.ts` — each marked DELETE THIS FILE once applied and stable).

## 4. Verification results (pre-release, local)

| Check | Result |
|---|---|
| `npm run lint:migrations` | OK |
| `tsc --noEmit` | 0 errors |
| `next build` (no secrets, as CI) | success; only warning pre-dates WP1 (supabase-js in Edge middleware) |
| Unit suite (Windows) | 10 459 tests: 10 449 passed, 1 skipped, **9 failed = exactly the base commit's 9 (Windows-only CRLF debt, same 7 files)** |
| New WP1 suites | 60 / 60 |
| Focused regression (40 coupled suites) | 1 229 / 1 229 |
| Disposable-DB rehearsal (PGlite, PostgreSQL in WASM) | 161/161 migrations from empty · seed OK · **24/24 verifiers** · existing `rls_document_test` PASS (harness control) · `rls_wp1_opening_test` PASS · WP1 migrations re-apply idempotently · **7/7 negative controls caught** |

Rehearsal adaptation, declared: PGlite 0.2.17 has no pgcrypto loader, so the single `create extension if not exists pgcrypto` (foundation migration) was neutralised; no migration or seed calls a pgcrypto function.

## 5. Deployment order (doctrine: expand → activate; code ships dark)

1. Push the branch; a human opens the PR; CI `build` + `rls-tests` green (the new suite is a named step).
2. Independent security review (§9 of the PR body).
3. Vercel Preview: **visual check only** — Preview binds the PRODUCTION database. The probes answer `false` there until the migrations are applied, so the new fields and controls must NOT appear; that absence is the Preview check.
4. Merge (owner). Production deploys the code; it is **inert** (probes `false`): no field, no control, no new query against a missing column.
5. Five governed runs of `migrate-production.yml`, in order 157 → 161, each `dry_run=true` then `dry_run=false`, each stopping at the `production-db` environment for the owner's approval. Stop at the first failure; no retry, no ledger repair without authorisation.
6. After #161: features self-activate on the next request.

## 6. Production smoke tests (read-only)

- Ledger = 161; each of the five verifiers returns `ok = true` against production.
- `role` row `QUOTATION_MANAGER` reads « Business Development Manager »; its code unchanged.
- `document_type` has `ORDRE_DE_TRANSIT` (active, `required_for = {}`, no validity).
- `document_expiry_change` exists, RLS on, one SELECT policy; both RPCs not executable by `authenticated`.
- An existing dossier page renders (200) with « PO client — » and « Régime douanier prévu — » in its identification block; the customs panel renders.
- Vercel runtime logs: no new error class after the deploy and after each migration.

## 7. Known issues and limits

1. **Mail filing is dark.** `communication:inbound:read` is held by no role (RATIFY-EC1-1), so the inbox — and therefore « Rattacher ce message … » — is unreachable in production, exactly like EMP-4 attachment filing. Until the owner revisits that ratification, an instruction received by e-mail is filed by uploading it under « Ordre de transit / instruction client ». **Decision item DEC-CEO-20.**
2. **The PO is not enforced.** Deliberately (DEC-CEO-02 / DEC-CEO-19). PR-2 must first make the department queue read the leniency classifier — today `lib/process/queues/service.ts` marks a step `blocked` on ANY missing evidence, which would have made even a non-blocking PO read « Pièces manquantes ».
3. **Client portal visibility.** `operational_file`'s portal SELECT policy is row-level, so a customer user can read the PO and the expected regime of THEIR OWN dossiers. Both are the customer's own information; stated, not hidden.
4. **No validity durations** are defined (DEC-CEO-04/05 pending with the Chef de Transit).

## 8. Rollback and recovery

| Tier | Action | When |
|---|---|---|
| 0 | Nothing to switch off: features are inert until their migration lands. | Before step 5 |
| 2 | Vercel « promote previous » to `dpl_A71wTkPd8dt4ZsgL9N3Q1WoakJ6A` (`08f4397`). **Safe across these migrations**: the schema is a strict superset the old code never reads; the old code never writes `document.expiry_date` after insert, so the governing trigger cannot fire for it. | A UI defect after activation |
| 3 | Forward-fix migration. | A schema defect |
| — | **Never drop `document_expiry_change` once it holds rows** (append-only evidence). Never re-run a migration out of order. The role label can be reverted by a mirror UPDATE in a new migration. | — |

A failed governed run leaves its migration unrecorded and the runner refuses to continue — report and stop.

## 9. UAT

See `uat-cases.md`. **Transactional UAT is blocked until DEC-CEO-18** (UAT environment) is decided: Preview writes production; production records need explicit authorisation and the isolation/cleanup plan in that file.
