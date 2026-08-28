# Gestion de la Performance — completion + BI / reporting architecture audit

**Date:** 2026-08-28 · **Status:** audit only — nothing implemented.
Baseline: module live at `e5c2415` (CI 33191226917), assignable role
`PERFORMANCE_MANAGEMENT`, migrations 127/128 live in production, 129 pending
operator activation.

**The question answered:** the smallest governed architecture in which the same
authoritative operational data feeds ICTD/ICAM/IPAM, interactive BI, and frozen
management reports — one source of truth, no parallel spreadsheet process, and a
finite end.

---

## THE MATRIX

Classification: **SATISFIED** (already true, proven) · **DERIVABLE**
(automatically computable from existing authoritative data) · **GAP**
(implementation required) · **QUESTION** (needs an Effitrans decision) ·
**UAT** (needs operator action/testing, not code) · **DEFERRED** (valuable,
not needed for the first management report).

### A — Performance data foundation

| # | item | class | evidence & smallest path |
|---|---|---|---|
| A1 | **NF — nombre de factures** | **CORRECTED 2026-08-28 — see below** | ⚠ **This row was WRONG and is retained corrected rather than deleted.** It claimed NF = `VENDOR_INVOICE`. The frozen Phase-0 source map §B (ICTD inputs) states: *"NF — nombre de factures (I) \| count of dossier `document` rows **`type_code='COMMERCIAL_INVOICE'`** (active versions)"*. `VENDOR_INVOICE` (« Facture tierce payable », category `financial`, gates no customs) appears in the map's **ICAM** block as NFACT « factures fournisseurs contrôlées » — a different indicator measuring a different person's work. This audit conflated the two. NF is still **DERIVABLE** and still needs no new capture; the source is COMMERCIAL_INVOICE, which is catalogued (`20260615000001:37`), applies to `{IMP,EXP}` and **gates customs**. Awaiting the corrected ruling before implementation. |
| A2 | **Nombre de cotations** | **DERIVABLE** | `quotation.converted_file_id` links the accepted quotation to the dossier it became, and the QO-1 chain groups a request's quotation versions. Phase-0 source map row 41: AUTO, with the statuses that count flagged for ratification (« réellement réalisée et traçable » → sent? accepted? every superseded version?) (→ Q1). No migration. |
| A3 | ICTD five governed elements | **SATISFIED** + **UAT** | D4 capture live (127/128 in prod). Empty on historical dossiers by design — fills as declarants work the MAYA pilot dossiers. |
| A4 | ICTD délai (complet→BAE) | **SATISFIED** | ICTD-D11 engine proven against F-SLA-06; needs only the calendar populated (B1). |
| A5 | ICAM — réclamations client + imputabilité | **GAP** | No claims register exists anywhere (grep: only mail-triage machinery; the "debt-customs-error" suite is about UI error placement, not redressements). Closest reusable substrate: EC triage already receives inbound client mail — a claim register could be FED from triage, but the register itself (claim, imputabilité verdict with « En analyse », GOV-04 truth table) must be built. New table + workflow. |
| A6 | ICAM — erreurs imputables / redressements douaniers / retours | **GAP** | No source. Genuinely new governed registers (Phase-0 §6 said so; still true). |
| A7 | ICAM — incidents critiques | **GAP** | No register. Doubles as the GOV-09 « Revue managériale » trigger, which today can never fire (`criticalIncident: false` hard-wired in read.ts with a comment saying exactly this). |
| A8 | IPAM — objectifs de capacité (P) | **GAP** (+ Q3) | `hr_objective` exists (HR-6) but carries evaluation-cycle objectives (weights, manager assessment) — not the numeric UTD/jour capacity target the P dimension needs. Reuse the HR-6 *pattern*, not the table. Needs: who sets targets, per collaborator per period (→ Q3). |
| A9 | IPAM — CSAT | **GAP** | No survey instrument (Phase-0 Q11, still open). |
| A10 | IPAM — quality inputs | **GAP** | Derived from A5–A7; blocked by them. |

**ICTD becomes fully calculable (7/7 terms) with zero new capture** — A1+A2 are
joins, not features. ICAM/IPAM remain register-gated.

### B — Calendar

| # | item | class | detail |
|---|---|---|---|
| B1 | 2026 fixed civil holidays (1 jan, 4 avr, lun. Pâques, 1 mai, Ascension, lun. Pentecôte, 15 août, 1 nov, 25 déc) | **UAT** (HR entry), optionally **DERIVABLE** as a one-click seed | HR owns the calendar (ratified); the fixed dates are public fact. Smallest aid: a « Proposer les jours fériés 2026 » button in the existing HR-gated editor that pre-fills the fixed list for HR to confirm — HR stays the author, nothing is seeded behind their back. No migration. |
| B2 | 2026 movable Islamic holidays (Korité, Tabaski, Tamkharit, Maouloud…) | **QUESTION → UAT** | Officially declared dates vary; must come from Effitrans/HR (→ Q2), entered through the existing editor. |
| B3 | Leave/half-day/no-double-deduction semantics | **SATISFIED** | D3 engine, CI-proven. |

### C — Time authority

| # | item | class | detail |
|---|---|---|---|
| C1 | Persisted business facts | **SATISFIED** | Every write path uses database `now()` (`corrected_at`, `reviewed_at`, `created_at`, audit, events). No client timestamp is ever persisted. |
| C2 | Default period selection | **SATISFIED** (note) | `new Date()` in the /performance pages runs in **server components** — server clock, never the browser's. Senegal is UTC+0 year-round, so server-UTC "today" *is* Dakar "today". Hardening worth one line in the first slice: a named `dakarToday()` helper so the assumption is written down, not coincidental. |
| C3 | Client-side dates | **SATISFIED** | Only display formatting (`toLocaleString`) touches the client clock; a wrong user clock mislabels nothing persisted and shifts no period boundary. |
| C4 | Report/publication timestamps | carried into E | Must be DB `now()` like everything else — design requirement, trivially met by the same idiom. |

### D — BI (Rapports & BI)

| # | item | class | detail |
|---|---|---|---|
| D1 | Dimensions already authoritative | **SATISFIED** | collaborateur (customs `created_by`), dossier, client (`operational_file.client_id`), type de déclaration, activité douane (status/dates/BAE), délai (ICTD-D11), ICTD, fiabilité, jours travaillés. Department is derivable from role mappings (`lib/organization/departments.ts`). |
| D2 | Period selector (mois / trimestre / année / libre) | **GAP** (small) | `monthPeriod()` exists; quarter/year/custom are generalizations of the same pure function. Custom periods valid for workload/delay; the < 10-dossier reliability marker applies per period regardless — semantics survive because `reliabilityStatus` is period-agnostic. |
| D3 | Drill-down aggregate → collaborateur → dossier | **GAP** (small) | The read service already returns per-dossier rows; drill-down is presentation over data that exists, RBAC-checked at each level (dossier links honour file visibility). |
| D4 | ICAM/IPAM in BI | blocked by A5–A10 | Tabs stay honest: `non calculable` + named missing registers, aggregated as absences, never zeros. |
| D5 | Recommended first dashboard set | design (below) | Five views answer the management questions the brief lists; more is Power-BI-shaped scope creep. |

**Recommended first dashboards (and the question each answers):**
1. **Activité** — dossiers processed, by month, by declaration type, by client (top N). *How much work, what kind, for whom.*
2. **Charge & capacité** — per collaborateur: dossiers, ICTD, jours travaillés, ICTD/jour, reliability chip. *Who carries the load; who approaches capacity.*
3. **Délais** — délai jours ouvrés distribution + per-dossier outliers. *Where the bottlenecks are.*
4. **Tendances** — monthly series of the above (computed from the same engine per month — no stored series needed at this scale). *How it is trending.*
5. **Points d'attention** — dossiers non calculables (missing capture), à revalider, PROVISOIRE collaborators, empty-calendar warning. *What needs management intervention — built from honesty signals that already exist.*

Declarant performance = dashboard 2 filtered to declarants. AM performance
honestly = IPAM, which is register-gated; until then AM workload appears in
dashboard 1/2 only, labelled as workload, not performance.

### E — Report generation

| # | item | class | detail |
|---|---|---|---|
| E1 | Lifecycle BROUILLON → PRÊT POUR REVUE → PUBLIÉ | **GAP** | New table `performance_report` + status machine, the platform's ordinary CAS-guarded action idiom. |
| E2 | Immutable published snapshot | **GAP** | On publish: freeze computed facts + methodology notes as jsonb, WORM-trigger the row (customs_correction idiom, already proven). |
| E3 | PDF export | **GAP** (cheap) | The hand-rolled PDF engine exists and renders official invoices (`lib/finance/invoice-pdf.ts`, DBC-0); quotation artifacts already carry the immutable-artifact idiom (`storage_path` + `sha256` + `renderer_version` + `generated_at`). Reuse both. |
| E4 | Excel export | **DEFERRED** | Nothing in the first briefing needs it; PDF + on-platform BI cover presentation and follow-up. Revisit on demand. |
| E5 | Sections (see I) | design | Structure challenged below. |

### F — Parameter versioning

| # | item | class | detail |
|---|---|---|---|
| F1 | Smallest safe model for NOW | **GAP** (tiny) | Parameters live as code constants and exactly one version has ever existed. So: export `PARAMETER_SET_VERSION = "2026.1"` from the engine; every calculation result and every report snapshot carries it. Published reports store **computed facts + the version label** — reproducible and self-describing without a parameter database. |
| F2 | Snapshot content | design | **Facts + version reference, not raw operational data.** The snapshot is what management saw (the numbers, the reliability flags, the section prose), plus the engine/parameter version that produced it. Re-running the engine over live data answers "what would it say now"; the snapshot answers "what did we publish" — both exist, neither pretends to be the other. |
| F3 | DB-backed effective-dated parameter table | **DEFERRED** | Needed only when a SECOND parameter version becomes editable. Building it before any coefficient may change is speculative structure. Paramètres stays read-only until then — already the shipped behaviour, already pinned. |

### G — RBAC

| # | item | class | detail |
|---|---|---|---|
| G1 | `performance:read` / `performance:manage` on the assignable role | **SATISFIED** | e5c2415, CI-proven, capability diff pinned as an equality. |
| G2 | `performance:report:create` | **GAP** | New capability, granted to `PERFORMANCE_MANAGEMENT` — drafting a report is the working half of the module's purpose. |
| G3 | `performance:report:publish` | **GAP** + recommendation | **Publishing is an official act; viewing must not imply it.** Since the admin UI grants roles (not individual permissions), the clean separation with existing mechanisms is a second thin assignable role — **`PERFORMANCE_PUBLISHER` / « Publication des rapports de performance »** — holding exactly `performance:report:publish`, assigned to Fary (and whoever Effitrans chooses). Two chips on Fary's profile; ordinary administration; no new mechanism. |
| G4 | Further splits | not necessary | Four capabilities, two roles. More separation inside a 2–4-person population is ceremony, not control. |
| G5 | Standing guards | **SATISFIED** | No automatic CEO/OPS_SUPERVISOR/SYSTEM_ADMIN access; assign-without-hold for SYSTEM_ADMIN; both directions CI-pinned. New capabilities join the existing equality test so leakage stays impossible to add silently. |

### H — Data / BI architecture

| # | item | class | detail |
|---|---|---|---|
| H1 | Computation source | **SATISFIED** as-is | **Transactional queries through the one engine** (`lib/performance/*`). DEC-B02 sizes the platform at ~65 users, moderate volume; the current whole-month read is a handful of indexed queries. Materialized views / aggregation tables would duplicate business logic to solve a load problem that does not exist. |
| H2 | One source of truth | **SATISFIED** by design, enforced in slice 1 | Dashboards, tabs and report generation all call the same `computeIctdDossier` / `workedDaysInPeriod` / `reliabilityStatus`. The report generator must be built ON the read service, and a pin should assert no second formula appears (the D2 signature-pin idiom). |
| H3 | Reporting storage | **GAP** (one table) | `performance_report` is the only new storage: lifecycle + jsonb snapshot + artifact reference. RLS: select on `performance:read`; no write policy — the actions are the boundary (HR-A2 idiom). Tenant-scoped, registered in TENANT_SCOPED_TABLES. |
| H4 | Reproducibility | **SATISFIED** via F1/F2 | Snapshot facts + version label + `sha256` PDF. |

### I — Report structure, challenged

Keep (supportable today): **Synthèse exécutive** (authored) · **Activité
globale** (D1 dims) · **Charge / capacité** (dashboard 2 data) · **Performance
des collaborateurs** (ICTD table + reliability) · **ICTD** (per-dossier basis) ·
**Délais** (ICTD-D11) · **Clients / typologie** (client + declaration-type dims)
· **Points d'attention** (honesty signals) · **Méthodologie / fiabilité**
(auto-generated: parameter version, inputs captured, PROVISOIRE counts, calendar
state — this section is the platform's honesty made printable).

Amend: **ICAM / IPAM** appear as a single « Indicateurs en préparation » block
naming the missing registers — a report that silently omits them invites the
question; one that fabricates them is worse. **Incidents / exceptions** folds
into Points d'attention until A7 exists (no register → no section of its own).
**Commentaire de direction** stays — it is Fary's voice, authored not computed.

### J — Pilot / UAT readiness

| # | item | class |
|---|---|---|
| J1 | ICTD with real MAYA-pilot dossiers | **UAT now** (after migration 129 + role assignment): declarants capture the five elements on live dossiers; HR populates the calendar; Fary reads Vue d'ensemble/ICTD with honest partial-basis flags. NF/cotations join in slice 1. |
| J2 | ICAM / IPAM UAT | blocked by registers — architecturally separable, does not block J1. |
| J3 | Fary's minimal management scenario (open → inspect → drill → understand flags → draft → review → publish → export → reopen unchanged) | possible at end of **slice 1**; the last step (reopen and prove unchanged) is the WORM trigger + sha256 doing their job. |

---

## 1. Target architecture

```
OPERATIONAL FACTS (owned elsewhere, never copied)
  customs_record (D4 governed)   documents (VENDOR_INVOICE → NF)
  quotation (converted_file_id → cotations)   operational_file (client, type)
  hr_calendar_day + hr_leave_request (D3)
        │  read-only, tenant-filtered
        ▼
GOVERNED CALCULATION — lib/performance/* (the ONLY formulas)
  computeIctdDossier · delaiJoursOuvres · workedDaysInPeriod · reliabilityStatus
  stamped PARAMETER_SET_VERSION ◄── parameter versions enter HERE, once
        │  one read service (lib/performance/read.ts)
        ├──────────────────────────────┐
        ▼                              ▼
BI — Rapports & BI (live)        REPORT DRAFT (same service, same numbers)
  period selector, 5 dashboards,   BROUILLON → PRÊT POUR REVUE
  drill-down under RBAC                 │ publish (performance:report:publish)
                                        ▼
                                 PUBLISHED SNAPSHOT (immutable)
                                   facts + version label + prose, WORM row
                                        │
                                        ▼
                                 PDF (existing engine, sha256, stored artifact)
```

Live BI answers "what would it say now"; the snapshot answers "what did we
publish". Same engine, one entry point for parameter versions, no duplicated
truth.

## 2. Finite implementation slices — three, then closed

**SLICE 1 — « Premier rapport » (gets Fary to her first published report).**
NF + cotation derivation into the read service (7/7 ICTD terms; « base
partielle » disappears where documents exist) · `dakarToday()` · period
generalization (month/quarter/year/custom) · **Rapports & BI** tab with the five
dashboards + drill-down · `performance_report` table (the one new table) +
lifecycle actions + WORM publish + PDF via the existing engine ·
`performance:report:create`/`:publish` + `PERFORMANCE_PUBLISHER` role ·
holiday-proposal button in the calendar editor · proofs (one-formula pin,
lifecycle, immutability, RBAC diff updates). *One migration (report table +
capabilities + publisher role).*

**SLICE 2 — ICAM registers.** Claims + imputabilité (GOV-04 truth table),
erreurs, redressements, retours, incidents critiques (activates GOV-09 for
real); ICAM computation against frozen fixtures; ICAM dashboard + report
section. *Gated on register design ratification.*

**SLICE 3 — IPAM + editable parameters.** Capacity targets (Q3) + CSAT
instrument (Phase-0 Q11) + IPAM computation; DB-backed effective-dated parameter
versioning, unlocking Paramètres. *Last, because it depends on slice 2's quality
inputs.*

Nothing else. Slice 1 closes the reporting area; 2 and 3 close the indicators.

## 3. Business questions (only what the repository cannot answer)

- **Q1 — counting rules for the two derived ICTD terms.** NF: every
  VENDOR_INVOICE document, or only VERIFIED ones? Cotations: which quotation
  statuses count as « réellement réalisée » (sent? accepted? superseded
  versions?) — Phase-0 flagged this exact ratification (source map rows 41/61).
  One answer unblocks full ICTD.
- **Q2 — the official 2026 movable holiday dates** (Korité, Tabaski, Tamkharit,
  Maouloud, and any Effitrans-observed others). HR enters them; we cannot
  invent lunar dates.
- **Q3 — capacity targets (IPAM P): who sets a collaborator's UTD/jour target,
  per what period, and may it change mid-period?** Needed for slice 3 only.
- *(Recommendation, not question: publisher separation via `PERFORMANCE_PUBLISHER`
  assigned to Fary — follows directly from "viewing must not imply publishing";
  say the word if Effitrans prefers a single role.)*

## 4. GO / NO-GO

| area | verdict |
|---|---|
| **ICTD UAT** | **GO now** — after migration 129 + role assignments + HR calendar entry; 7/7 terms after slice 1 + Q1 |
| **ICAM UAT** | **NO-GO** — source registers do not exist (slice 2) |
| **IPAM UAT** | **NO-GO** — capacity targets + CSAT do not exist (slice 3) |
| **BI** | **GO after slice 1** — all dimensions authoritative today |
| **Management report** | **GO after slice 1** — engine, PDF and immutability idioms all exist; only the report table and lifecycle are new |

## 5. Recommended next build

**Slice 1**, exactly as bounded above, upon approval of **Q1** (the only
question it depends on — Q2 is HR data entry, Q3 is slice 3). It is one
migration, one new table, two capabilities, one thin role, and it ends with
Fary publishing a frozen August report and reopening it unchanged.
