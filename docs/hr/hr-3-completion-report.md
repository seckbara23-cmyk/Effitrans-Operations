# HR-3 — Documents, Contracts & Employee File: Completion Report

**Date:** 2026-08-02 · **Status:** CLOSED — deployed to production (operator PASS)
**Commit:** `70a65c0` · CI: build 10/10 · rls-tests **68/68, zero skipped** (clean 1->75 chain)

## Production deployment record

| Step | Result |
|---|---|
| Migration `20260802000001` | applied |
| `hr_document_type` / `hr_document` / `employment_contract` / `hr_template_version` | present (independently probed) |
| `hr-documents` bucket | private |
| `SOLDE_TOUT_COMPTE` document type | present |
| `hr:sensitive:read` grants | **0** — B1 pause intact |
| Ledger | repaired; **75/75**, last `20260802000001` (independently verified) |

**No operator work remains for HR-3.**

## INC-HR3-01 — ledger drift found during close-out

At close-out the production ledger recorded only 72 versions: **73, 74 and 75 were all
unrecorded**, although their objects were live (read-only probe). The HR-1 and HR-2 repairs
had been reported as complete, so the reports and the database disagreed. Cause not proven;
the most likely explanation is that those `migration repair` invocations ran while the CLI
was linked to the preview project provisioned mid-session. Resolved by a history-only repair
of all three versions; 75/75 verified afterwards.

**Two hardenings adopted:** (1) a close-out now *verifies* the ledger with `migration list`
rather than accepting the deployment report; (2) **check `supabase/.temp/project-ref` before
any repair** — a repair against the wrong ref silently writes the wrong history. The preview
project's own ledger may carry the mistaken 73/74 entries and should be checked before D2
resumes.

## What shipped

Dedicated bounded context (private `hr-documents` bucket, 60s server-minted signed URLs,
per-access audit) - never `public.document` · `hr_document_type` with C1/C2/C3 classes and
`required_for_termination` · `hr_document` (sha-256, soft delete only) · `employment_contract`
DRAFT->VERIFIED->ENDED with maker-checker `verified_by <> prepared_by` · immutable
`hr_template_version` · C3 documents RLS-invisible without `hr:sensitive:read` · the ratified
termination rule enforced (« solde de tout compte ») · four new ledger kinds with compensation.

**DEC-B63 gate honoured:** `employee_identifier` was **not** built — the legal answers on
identifier storage are still pending, and C3 data gets no dark-first pass. Test-pinned absent.

## Gates open after HR-3

B1 HRQ-D2 grants · B2 structure seeds · B3 HRQ-A4 purge window · **DEC-B63** (blocks
`employee_identifier` only). None blocks HR-4.
