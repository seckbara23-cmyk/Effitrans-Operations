# HR-0A — Tenant Setup, Configuration & Legacy Migration (Architecture Addendum)

Part of [HR-0R](hr-0r-reaudit-2026-07-31.md) · documentation only · nothing implemented.

The addendum's premise is accepted and evidenced: **Effitrans has no structured HR data**
(this re-audit found zero digital HR records beyond the HR-1 registry), so the module must
be configurable and loadable *through the application*, and must not hard-code one
company's structure into the engine.

## 1. The layer model, mapped to repository reality

```
HR Core Engine            permanent logic: lifecycle transition table, permission engine,
      │                   RLS + tenant triggers, audit + redaction, scope helpers,
      │                   maker-checker constraints, numbering RPC mechanics
      ▼
Tenant HR Configuration   hr_configuration + catalogs (§3) — everything company-specific
      │
      ▼
Organization Setup        the wizard (§2) writing ONLY configuration + org entities
      │
      ▼
Legacy Data Migration     staged imports (§4) — the FIN-AGING-2 pipeline shape
      │
      ▼
Operational HR            directory, documents, leave, … over engine + config
```

The platform already practices this split — the aging engine's bucket scheme is registry
*data*; `aging_template_version.config` carries workbook constants as data; the process
engine's rollout is tenant rows over env kill-switches. HR adopts the same discipline:
**if two tenants could legitimately differ on it, it is configuration; if a change to it
would need a code review to stay safe, it is engine.**

### Engine (never tenant-editable)

Lifecycle state machine and transition legality · permission codes and their enforcement ·
RLS policies, tenant triggers, SELECT-only + service-role writes · audit + redaction rules
· maker-checker constraints (verifier ≠ uploader, approver ≠ preparer) · numbering
*mechanics* (atomic counter) · scope helpers · import pipeline mechanics · the canonical
department vocabulary (platform-wide, WES-3 depends on it).

### Configuration (tenant-owned, wizard-managed)

Org units & positions & work locations · numbering *pattern* (pre-activation only) ·
contract-type vocabulary · termination-reason vocabulary · probation policy (default
durations per contract type) · leave categories + entitlement rules (HR-4) · document-type
catalog + which types are `required_for_activation` · onboarding/offboarding checklist
templates · equipment categories · payroll-preparation field list (HR-7) · approval seats
(which role approves leave, comp, imports) · notification preferences · document/letter
templates (§5).

Employment *statuses* are *engine* — the request lists them as configurable, but a
tenant-editable state machine cannot be reconciled with ratified DEC-B62 or with tested
transition legality. What tenants configure is the **vocabulary around** states (reason
codes, labels), not the machine. Recorded as an explicit divergence for ratification
(HRQ-A1).

## 2. The Setup Wizard (first-run, restartable)

A guided sequence over `/departments/hr/configuration` (design only):

1. **Organisation** — units (under canonical departments), work locations
2. **Postes** — position catalog (+ optional grade labels)
3. **Hiérarchie** — default reporting lines per unit (used to pre-fill assignments)
4. **Numérotation** — pattern preview (`EMP-{YEAR}-{SEQ4}` default); locks at activation
5. **Contrats & période d'essai** — contract types (legal-review flagged), probation defaults
6. **Congés** — categories + entitlement rules (encoded but inert until HR-4)
7. **Documents** — document types, sensitivity, validity, required-for-activation set
8. **Intégration / Départ** — onboarding + offboarding checklist templates
9. **Équipements** — categories
10. **Paie (préparation)** — field list + Finance handoff seat (inert until HR-7)
11. **Approbations & notifications** — approval seats, notification toggles
12. **Récapitulatif & activation**

Mechanics: every step writes DRAFT configuration rows; the wizard is **re-enterable and
restartable at will while `hr_configuration.status = 'DRAFT'`**. **Activation** (an
explicit, audited action) flips to ACTIVE, locks the numbering pattern, and requires the
activation checklist (§6). Post-activation changes happen per-catalog (not by rerunning the
wizard) and are versioned where history matters (templates, checklists) or effective-dated
(entitlement rules). The tenant onboarding checklist from Phase 6.0E is the UI precedent
for a stepper with per-step completion state.

## 3. Tenant configuration model (entities; ERD-registered)

`hr_configuration` (one row per tenant: status DRAFT/ACTIVE, numbering_pattern, wizard
step-completion, activation metadata) · `hr_org_unit` · `hr_position` ·
`hr_work_location` · `hr_contract_type` · `hr_termination_reason` · `hr_leave_category`
+ `hr_leave_entitlement_rule` · `hr_document_type` · `hr_checklist_template`
(+ items) · `hr_equipment_category` · `hr_payroll_field` · `hr_approval_seat` ·
`hr_notification_setting` · `hr_template_version` (§5). All tenant-scoped, RLS-gated on
the HR config permission, service-role writes, audited (`hr.config.updated` with safe
metadata). Catalogs are flag-inactive, never deleted, once referenced.

## 4. Legacy migration — the FIN-AGING-2 pipeline shape, generalized

Ratified precedent, reused deliberately rather than re-invented:

```
Excel/CSV upload  →  hr_import_batch        (source filename + sha256, preparer, status)
                  →  hr_import_staging_row  (source_row_number + verbatim raw jsonb +
                                             parsed candidate columns + status)
                  →  column mapping         (import_kind-specific mapping saved on batch)
                  →  validation             (hr_import_error rows: field, code, message_fr)
                  →  duplicate detection    (deterministic: employee_number + name+DOB-less
                                             heuristics per kind; partial unique per batch)
                  →  preview                (the exact rows that would be created)
                  →  maker-checker approval (approved_by <> prepared_by CHECK — structural)
                  →  creation               (accepted rows become canonical records with
                                             provenance = 'OPENING_IMPORT'; REJECTED rows
                                             structurally cannot carry a created id)
```

`hr_import_batch.import_kind` enumerates the supported loads and phases them:
`EMPLOYEES` (HR-1C — the first real need) · `DEPARTMENTS/UNITS`, `POSITIONS`,
`REPORTING_LINES` (HR-1C, config-stage imports) · `CONTRACT_METADATA` (HR-2) ·
`EQUIPMENT_ASSIGNMENTS`, `ONBOARDING_CHECKLISTS` (HR-3) · `LEAVE_BALANCES` (HR-4) ·
`ATTENDANCE_HISTORY` (HR-5) · `PAYROLL_PREPARATION` (HR-7). One pipeline, one staging
model, per-kind mapping/validation modules — never a parallel importer per domain.

Rules carried over verbatim from the ratified aging import: nothing enters production
directly; a rejected staging row leaves a trace and can never create a record; batches are
idempotent to re-validate; imported personal data in `raw` jsonb inherits the batch's RLS
(config permission) and is **purgeable after approval** (retention decision HRQ-A4 —
`raw` holds C2/C3 values, unlike the aging case, so indefinite staging retention is not
acceptable by default). Import files never enter the repository; fixtures stay synthetic.

## 5. HR templates — versioned, tenant-owned

`hr_template_version` follows `aging_template_version` exactly: `(tenant_id, code,
version)` unique; kinds: `CONTRAT_TRAVAIL`, `AVENANT`, `CHECKLIST_INTEGRATION`,
`CHECKLIST_DEPART`, `DEMANDE_CONGE`, `COURRIER_PROMOTION`, `COURRIER_DISCIPLINAIRE`,
`FICHE_REMISE_EQUIPEMENT`; body/config as data; **a version becomes immutable the moment
anything references it** (pinned-template trigger, proven this week); a generated document
records `template_version_id`, so changing a template never rewrites any historical
employee document. Generated artifacts use the deterministic-render + sha256 discipline
where they become files (HR-2+, the invoice-artifact idiom).

## 6. HR activation checklist (gate to Operational HR)

Configuration ACTIVE requires, at minimum: ≥1 org unit and ≥1 position defined · numbering
pattern confirmed · contract types confirmed (or explicitly deferred with the legal flag) ·
document types confirmed with the required-for-activation set · onboarding + offboarding
templates having ≥1 item each · approval seats named · either an approved `EMPLOYEES`
import batch **or** an explicit « démarrage à vide » choice · the HR permission grants
reviewed (matrix in the permissions doc) · RLS suite green in CI for every new table.

## 7. Rollout strategy

Same two-layer discipline as every module: env kill-switch (`EFFITRANS_HR_ENABLED`-style)
AND tenant enablement; the wizard usable in preview first with synthetic data (the aging
preview runbook is the model — demo tenant, guarded dataset, four-gate table); production
activation only after the checklist passes and the ratification items in the decision
register close. The registry (HR-1) already being live narrows this: rollout here governs
the *new* configuration/import/document surfaces, not the existing directory.
