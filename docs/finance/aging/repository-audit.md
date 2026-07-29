# FIN-AGING-0 · Repository Audit — what exists, what's missing, what conflicts

Verified against the working tree at `fc03136` (2026-07-29) by direct inspection —
migrations, `lib/finance`, `lib/collections`, `lib/bi`, `lib/reports`, `lib/brand`.

## 1. Existing and REUSABLE (do not rebuild)

| Contract | Where | What it already gives the aging module |
|---|---|---|
| **Invoice model** | `public.invoice` (migration 20260615000004) | status `DRAFT/ISSUED/PARTIALLY_PAID/PAID/VOID`, `currency` (default XOF), `issue_date`, `due_date`, `invoice_number` unique per tenant, `client_id`, `file_id` → the dossier, `voided_at` |
| **Invoice lines** | `public.invoice_line` | amounts; `charge_id` → `billing_charge` (billable conversion chain) |
| **Payments** | `public.payment` | `amount > 0`, `method`, `paid_at` (date), `reversed_at/by` — the as-of inputs |
| **Payment maker-checker** | migration 20260615000010 + `lib/finance/verification.ts` | `verification_status PENDING/VERIFIED/REJECTED`, `verified_by/at` — identity separation precedent |
| **Dispute flag** | `invoice.disputed_at/dispute_reason` (20260714000001) | one flag, not a second status machine |
| **Collection notes** | `public.collection_follow_up` (append-only, channel/outcome/note/`promised_payment_date`/`next_follow_up_at`) | the permanent home for « Commentaires » + the responsible/follow-up fields the workbook lacks |
| **Deposits chain** | `invoice_deposit` + custody (5.0D) | payment-side operational flow — untouched by this module |
| **Money arithmetic** | `lib/finance/calc.ts` | `invoiceTotals`, `paidAmount` (non-reversed), `balanceDue`, `paymentStatus`, `isOverdue` — the single money calculator (closure + UAT-2A already pinned on it) |
| **Aging engine (coarse)** | `lib/collections/aging.ts` | PURE, injected `today` (tenant-tz), due-today-not-overdue, `DUE_DATE_MISSING` doctrine, dispute freeze, deterministic ordering — the doctrinal base to extend |
| **Report snapshot pattern** | UAT-2B invoice artifact (20260728000001 + `lib/finance/invoice-artifact.ts`) | immutable bytes + `content_sha256` + DB-enforced uniqueness + pinned renderer version + delete protection + one-time render; **this is the FINAL-report pattern to copy** |
| **Generated artifacts** | WES-4G (20260727000004) | artifact provenance/hashing for file-scoped documents |
| **PDF engine** | `lib/reports/templates.ts` (`ReportLayout`) + `lib/reports/report-pdf.ts` | corporate header/footer, KPI card row, auto-paginating tables, totals rows — deterministic, dependency-free |
| **XLSX writer (minimal)** | `lib/bi/xlsx.ts` + `lib/bi/zip.ts` | valid multi-sheet OOXML workbook, dependency-free — the base to extend (see "incomplete") |
| **OOXML experience** | `lib/brand/docx/*`, `lib/brand/pptx/*` | hand-rolled ZIP+OOXML shipping in production since DBC-4/5 |
| **Template registry precedents** | `brand_template` (DBC-6), `expense_template` (11.0B) | versioned template rows, immutability discipline |
| **Numbering** | `next_invoice_number` RPC + `invoice_counter` (locked) | per-tenant sequence pattern to clone for report numbers |
| **Report tables/exports** | `lib/bi/reports.ts` + reporting center + DBC-6 download center | export routes, honest-outcome download UX |
| **Email delivery** | comms queue + provider (`queueAndSend`), honest outcomes | report delivery channel |
| **Public-token route pattern** | `/card/[token]` (DBC-3): uniform-404, token rotation, no-index | the secure-share-link shape to reuse |
| **Portal invoice visibility** | portal docs-service (UAT-2A/2B) | future client statements build on this, not on a new surface |
| **RBAC & granularity pattern** | 29 roles; `finance:*` family; 2026-07-29 `admin:users:*` split + umbrella-fallback (`assertAnyPermission`) | exactly how `finance:aging:*` should land |
| **Audit / RLS / tenancy** | `writeAudit` append-only; SELECT-only RLS + service-role actions; tenant filters + leak-guard test | non-negotiable rails, all in place |
| **Tenant timezone / per-currency discipline** | 10.0D KPI engine | arrêté defaulting + per-currency reporting rules |
| **Finance workspaces** | `/finance`, `/collections`, finance nav | mounting points; `/finance/aging` joins them |

## 2. Existing but INCOMPLETE (extend, don't fork)

| Gap | Detail | Extension path |
|---|---|---|
| `lib/bi/xlsx.ts` | inline strings + bare numbers only — **no** styles, fills, borders, number formats, column widths, merges, autofilter, defined names, charts, sheet colors | grow it into a styled writer (or a sibling `lib/reports/xlsx/` engine reusing `lib/bi/zip.ts`); chart XML is hand-rollable — the reference workbook's own chart parts were parsed this audit and serve as the target fixtures |
| `lib/collections/aging.ts` | buckets stop at `OVER_90_DAYS`; single "today" semantics; no client aggregation; no report concept | keep intact for the collections queue; add `lib/finance/aging/` with the 7-bucket scheme as **data** (bucket-scheme registry) reusing the same doctrines; queue migrates to the shared engine later, deliberately |
| Payment→invoice linkage | `payment.invoice_id` is direct (fine); no allocation across invoices, no credit-note allocation | sufficient for v1; allocation tables arrive only with credit notes (D-02) |
| `isOverdue` in calc.ts | boolean, now-based | superseded for reports by the arrêté-parameterized engine; untouched for its current callers |
| Report chrome | `ReportLayout` has no chart primitives | add bar/pie primitives to the PDF core (vector rects/arcs — no images) |

## 3. MISSING (to be created)

- **Credit notes** (« avoirs ») — no table, no UI. Explicitly deferred at UAT-2B; the
  workbook shows none. Schema is *provisioned* in the ERD; build gated on D-02.
- **Adjustments / write-offs** — no model. Provisioned; gated on D-03.
- **Opening balances** — no mechanism for pre-platform receivables. The workbook's oldest
  row is ~2 505 days before the arrêté (≈ 2019): the AR history predates the platform, so a
  **legacy-import path is mandatory** (D-01 decides the representation).
- **Aging report snapshot tables** — `aging_report` (+ immutable rows) with lifecycle
  `DRAFT → VALIDATED → FINAL → SUPERSEDED / CANCELLED`.
- **Report template registry** — `report_template` rows pinning template version ↔ renderer.
- **Styled/charted XLSX renderer** — v1 target = the reference workbook, part for part.
- **Secure external share links for reports** — expiring, revocable, download-audited;
  `/card/[token]` shape, new storage.
- **`finance:aging:*` permissions** — none exist; granted to nobody until role review
  (§9 of the prompt; D-11).
- **Spreadsheet-like bulk entry / Excel import** — no precedent for paste-from-Excel grids;
  new UI work with validation-before-save.

## 4. CONFLICTING (resolved by design, not by accident)

| Conflict | Resolution |
|---|---|
| Two bucket schemes (collections 5-bucket vs workbook 7-bucket) | Bucket schemes become registry data keyed by consumer; the collections queue keeps its scheme until deliberately migrated. Nothing silently changes under COLLECTIONS_OFFICER. |
| Collections freezes DISPUTED out of aging; the workbook has no dispute concept | Aging report includes disputed invoices (money still owed) with a visible marker — pending Q-05; the collections queue behaviour is untouched. |
| `DUE_TODAY` is its own collections bucket; the workbook folds d=0 into `Non échu` | The 7-bucket scheme maps d ≤ 0 → `Non échu`; the underlying `daysOverdue` stays exact so nothing is lost. |
| Workbook trusts a manually keyed `Montant`; platform doctrine derives balances | Platform derives (aging-calculation-spec §3). The manual surface survives only as the legacy-import path with explicit provenance. |
| Report data changing after finalization | UAT-2B snapshot doctrine applies: FINAL pins rows + hashes; later payments produce a *new* report, never a silent edit. |

## 5. DEPRECATED / not to be used

- `admin:users:manage`-style umbrellas — new permissions are granular from day one.
- `lib/bi` CSV-ish "raw table" export styling — the aging Excel is a styled template
  artifact, not a data dump; it must not go through `toXlsx()`'s unstyled path.
- Any temptation to store `days_overdue`/`bucket`/`risk` on invoice rows — derived-only
  (matches the workbook: those columns are computed there too).
