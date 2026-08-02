# HR-3 — Documents & Contracts: Implementation Brief

**Status:** BRIEF ONLY — implementation awaits explicit approval.
**Ratified scope (§11):** `hr_document_type` / `hr_document` · `employment_contract` ·
`employee_identifier` (**legal-gated**) · tenant template versions · dedicated private bucket.

## Scope

1. **Migration 75** — `hr_document_type` (per-tenant catalog; required-set per contract
   kind; validity/expiry idiom reused), `hr_document` (C2/C3 class per type, soft delete,
   sha-256, storage path in a **new private HR bucket**, never `public.document` — the
   ratified refusal), `employment_contract` (kind CDI/CDD/STAGE… from configuration;
   probation_end; dates; document ref; **maker-checker verification** `prepared_by <>
   verified_by` as a CHECK), `hr_template_version` (immutable once referenced). Candidate
   RPCs per ADR-HR2-01: contract-create + ledger-emit in one transaction.
2. **`employee_identifier`** — CNI/passport/IPRES/CSS/IPM numbers, C3: **own gate
   `hr:sensitive:read`** (exists, ungranted — activation is part of B1), values never in
   audit/ledger/exports; **ships only if DEC-B63's legal gates on identifier storage are
   answered; otherwise the table waits — schema dark-first does NOT apply to C3 data.**
3. **Profile tabs go live** — Contrats and Documents replace their dark tiles; upload via
   the private bucket + short-TTL signed URL idiom; contract verification flow; expiry
   surfaced on the HR dashboard. Notes stays dark (no ratified home).
4. **Ledger kinds added** — `contract_added`, `contract_verified`, `contract_renewed`,
   `document_added`, `document_expired` (payloads: kind + dates, never values).
5. **Transition requirements begin** — « TERMINATED requires the signed solde de tout
   compte » becomes enforceable once documents exist (addendum §6), seeded via
   configuration, engine-checked.

## NOT in HR-3

Onboarding checklists/equipment (HR-4) · leave (HR-5) · payroll/compensation (HR-7) ·
batch application (HRQ-A4) · e-signature (store signed scans only) · dotted-line (HRQ-OD2).

## Gate sensitivity

| Gate | Effect on HR-3 |
|---|---|
| **DEC-B63 identifier/retention answers** | **blocks §2 only** — the rest of HR-3 proceeds |
| B1 (HRQ-D2) | `hr:sensitive:read` grants; document/contract surfaces ride `hr:read`/`hr:manage` |
| B2 seeds | contract kinds come from configuration — usable defaults seed with the migration |

## Test obligations

RLS suite (appended last): document/contract tenant confinement, SYSTEM_ADMIN zero,
C3-table isolation under `hr:sensitive:read`, maker-checker CHECK, template immutability ·
vitest: schema-compat guard over 75, no `public.document` usage for HR files, ledger-kind
labels exhaustive, signed-URL-only file access, soft-delete-not-delete pinned.

## Acceptance shape

HR_OFFICER uploads a CDD contract document, records the contract, a second `hr:manage`
holder verifies it; the Timeline shows both events; the dashboard warns 30 days before the
CDD ends; `hr:sensitive:read` remains ungranted and the identifiers panel (if legally
cleared) stays invisible to everyone until B1 activation.
