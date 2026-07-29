# FIN-AGING-0 · Deliverables F, G — Web Workspace, Renderers, Print & Sharing

## F. Web workspace (`/finance/aging`)

Mounted beside `/finance` and `/collections` in the Finance nav; gated `finance:aging:read`
(granular family — see roadmap §RBAC). French-first labels, exactly the workbook's
vocabulary (field dictionary).

### F.1 Screens — one per workbook function

| Screen | Workbook tab | Content |
|---|---|---|
| **Rapports** (list) | — | reports by arrêté date: number, status chip (DRAFT/VALIDATED/FINAL/SUPERSEDED/CANCELLED), preparer, validator, artifacts; « Nouvelle balance âgée » (picks the arrêté; defaults to today in tenant tz) |
| **Tableau de bord** | 📊 | six KPI cards (same colors/labels/formats) + the 7-bucket table with risk chips (emoji labels), all from the report view model |
| **Données** | 📋 | the invoice grid (below) with autofilter-equivalent column filters, sort, search, pagination/virtualization above ~200 rows |
| **Analyse clients** | 👥 | ranked client table, TOTAL row, risk chips; row click → client's invoices filtered in Données |
| **Dossiers critiques** | ⛔ | >365 j list, desc, red styling, TOTAL row (count in the days column, faithfully); inline Commentaires editor; deep-links to the dossier and to `/collections` follow-ups |
| **Graphiques** | 📈 | the three charts (bar / pie / horizontal top-10) rendered from the same view model series the exports use |
| **Exports & partage** | — | artifact list with SHA-256, download, share-link management (FINAL only) |

### F.2 The data grid — Excel familiarity without Excel's weaknesses

- **Live rows are read-only projections** of invoices: Facture, dates, Dossier, Client come
  from the invoice; Montant/Jours retard/Tranche/Risque are computed. There is no cell
  where a user can overtype a derived value — the four derived columns render with a
  "calculated" affordance (same doctrine as the workbook, §Tab 2).
- **What IS editable, and where**: due date (invoice edit, `finance:update`, audited);
  payments (existing payment flow, `finance:payment`); comments (follow-up note,
  `finance:aging:comment`); dispute flag (existing collections action). Each edit lands in
  the *live* data — a DRAFT report refreshes on demand («Recalculer»); VALIDATED/FINAL
  never move (snapshot doctrine).
- **Legacy/bulk entry** (the spreadsheet-parity requirement): a dedicated **Import** flow
  (`finance:aging:import`) accepting (a) paste-from-Excel (TSV clipboard grid) and (b) an
  .xlsx upload matching Données Brutes A–F. Staged rows are validated before save —
  per-cell inline errors (unknown client → controlled picker suggestion; unknown dossier;
  bad dates; duplicate invoice number; non-positive amount), nothing partial is committed,
  and the batch lands as invoices with `source='OPENING_IMPORT'` provenance (D-01) plus one
  synthetic line each. Draft staging is saveable and resumable.
- Column widths per the workbook proportions; virtualized beyond one screen; keyboard
  navigation in the staging grid.
- **Row-level audit history**: existing audit trail per invoice surfaced in a drawer
  (created/issued/payments/disputes/notes) — no new mechanism.

### F.3 Report lifecycle UX

`DRAFT` (recompute freely) → « Valider » (`finance:aging:validate`, maker-checker:
validator ≠ preparer, enforced server-side) → `VALIDATED` (frozen rows; visual diff against
live data available) → « Finaliser » (`finance:aging:finalize`) → `FINAL` (artifacts
rendered once, hashes displayed; sharing unlocked) → `SUPERSEDED` (a newer FINAL for the
same arrêté names its predecessor) / `CANCELLED` (reason required). Every transition
audited with actor + IP (request-ip pattern).

## G. Renderer architecture

```
aging_report(+rows) ──► view-model builder (pure)  ──►  renderers (versioned, dumb)
                                                        ├── aging-xlsx-v1
                                                        ├── aging-pdf-v1
                                                        ├── web components
                                                        └── print stylesheet
```
Renderers receive the **finished view model** — they format, they never calculate
(constraint §"no business rules in export code"). Template constants (labels, palette,
widths, formats) live in `report_template.config`, versioned as data.

### G.1 Excel — `aging-xlsx-v1` (target: the reference workbook, part for part)

Extends the dependency-free OOXML approach (`lib/bi/zip.ts` + DBC-4/5 experience) into a
styled writer producing:

- the five sheets, exact names **including emoji**, exact order;
- `styles.xml`: the three custom formats (`#,##0\ [$FCFA]`, `0" jours"`, `0.0%`),
  Arial fonts, the full fill palette, thin `CCCCCC` borders, alignments — as catalogued in
  [workbook-specification.md](workbook-specification.md);
- column widths / row heights / merges (including the single-cell KPI merges) / zebra rows
  / the `Données Brutes` autofilter + hidden defined name;
- values precomputed (no formulas), matching the reference behaviour;
- the three chart parts (`chart1..3.xml` + drawing + rels): bar `barDir=col`, pie,
  bar `barDir=bar`; legend right, `varyColors`, data labels, deleted value axes,
  gapWidth 150, `oneCellAnchor` positions — the reference workbook's own chart XML
  (extracted during this audit) is the literal fixture the writer must satisfy;
- workbook metadata: creator `Effitrans`, title = report number.

**Fidelity testing — how "pixel-level" is made objective.** Byte-identity is not the
target (zip timestamps, id ordering); **semantic part-identity** is:
1. A canonicalizer (test-side) parses a generated workbook and the recorded reference
   schema into comparable JSON: sheet names/order, per-sheet dimension, merges set, column
   widths, row heights, per-cell {value, type, numFmt, font, fill, border, alignment},
   autofilter, defined names, chart {type, refs, title, options}, anchors.
2. The reference JSON was extracted from the real workbook in this audit (structure only —
   committed fixtures contain no client data; synthetic values are injected through the
   view model).
3. A vitest parity suite diffs the two JSONs — any styling drift fails CI by name
   (`sheet 2 col F numFmt expected #,##0`).
4. A golden end-to-end: synthetic 430-row dataset → render → canonicalize → snapshot;
   plus re-render determinism (`sha256(render(vm)) === sha256(render(vm))` — no clock, no
   randomness, no `Intl` in the renderer, per the established deterministic-artifact rule).
5. Manual gate at rollout: open in real Excel (2016+ and 365) side-by-side with the
   Finance Manager's original — a checklist per tab, signed off in UAT.

### G.2 PDF — `aging-pdf-v1`

`ReportLayout` (existing) + two new vector chart primitives (bar, pie — pure PDF paths, no
images). Pagination: page 1 = title/arrêté + KPI cards + bucket table (dashboard);
then Données Brutes as an auto-paginated table (landscape, repeated header, zebra);
then Analyse Clients; then Dossiers Critiques (red chrome, total row); then a charts page.
Same figures, same French labels, same risk colors; footer = report number + page x/y +
« Confidentiel ». Deterministic byte output, SHA-256 recorded in `report_artifact`.

### G.3 Print (browser)

Print stylesheet on the workspace: A4; **landscape** for Données/Analyse/Critiques tables,
**portrait** acceptable for dashboard + charts; `break-inside: avoid` on cards/rows;
`thead` repeats via CSS table semantics; charts print as rendered SVG; Effitrans branding
header identical to the PDF chrome; scale-to-fit width with a minimum 9pt body.

### G.4 Sharing & delivery

- **Internal**: workspace downloads (`finance:aging:export`), audit on every download.
- **Email**: existing comms queue (`queueAndSend`) with the artifact attached — reusing the
  invoice-send pattern (attach stored bytes, never re-render; audit with SHA).
- **External share links** (`finance:aging:share`, FINAL artifacts only): token minted →
  hashed at rest; `/share/reports/{token}` public route with uniform-404 (invalid = expired
  = revoked, indistinguishable), optional password (Q-11), expiry (default 7 days,
  configurable), revocation, per-download audit + counter, `X-Robots-Tag: noindex`,
  `Content-Disposition` download of the exact stored bytes with the SHA-256 in a response
  header (invoice-route precedent).
