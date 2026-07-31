# HR — Employee Master Record & Field Dictionary

Part of [HR-0R](hr-0r-reaudit-2026-07-31.md) · documentation only · synthetic examples only.

Sensitivity classes used throughout (ratified direction, DEC-B63):

- **C1 — General directory**: visible to any `hr:read` holder; name, position, department,
  work contact.
- **C2 — Confidential HR**: `hr:read` today, narrowing candidates later; personal contact,
  emergency contact, employment dates, contract metadata.
- **C3 — Highly restricted**: own permission pair per domain; **never on `employee`**, never
  under plain `hr:read`, never in audit payloads, logs, URLs or exports: compensation, bank
  details, identity numbers, medical, disciplinary, termination detail beyond the reason
  code.

## 1. The implemented record (migration 57) — status EXISTING

| Field | Class | E/C | Notes |
|---|---|---|---|
| `employee_number` | C1 | system | `EMP-{YEAR}-{NNNN}`, per-tenant counter; **immutability after activation is convention, not yet a trigger → EXTEND item HR-1B** |
| `first_name`, `last_name` | C1 | entered | the only mandatory identity |
| `preferred_name` | C1 | entered | display name |
| `professional_email`, `professional_phone` | C1 | entered | work contact |
| `personal_email`, `personal_phone` | **C2** | entered | redacted from audit payloads (test-pinned) |
| `emergency_contact_name/phone` | **C2** | entered | two columns, deliberately unstructured (HR-0 §6.1) |
| `department` | C1 | selected | canonical code CHECK (`OPERATIONS/TRANSIT/FINANCE/HUMAN_RESOURCES`) |
| `job_title` | C1 | entered | HR-owned free text — the position *catalog* is the org-model gap |
| `manager_employee_id` | C1 | selected | display-only; self-FK, cycle risk handled at action level |
| `work_location` | C1 | entered | free text; a location catalog is a later decision |
| `employment_type` | C2 | selected | `CDI/CDD/STAGE/JOURNALIER/PRESTATAIRE/AUTRE` — **provisional pending legal review** (DEC-B63) |
| `hire_date`, `probation_end_date` | C2 | entered | probation is a **derived phase**, not a status |
| `termination_date`, `termination_reason` | C2 | entered | reason is free text today → vocabulary proposal below |
| `status` | C2 | lifecycle | five states; pure transition table |
| `linked_app_user_id` | C2 | action | audited link/unlink; grants nothing |

## 2. Proposed additions — by phase, none in HR-0R

### 2.1 C1/C2 additions that need no legal gate

| Field | Class | Phase | Rationale |
|---|---|---|---|
| `photo_path` | C1 | HR-2 | private-bucket path, signed-URL render; **never** reuse the Brand Center photo (different consent + privacy class) |
| `nationality` | C2 | HR-2 | operational (work-permit tracking later); ISO country code |
| `work_schedule` (reference) | C2 | HR-5 | with attendance, not before |
| `cost_center` | C2 | HR-7 | Finance boundary input; code only, no amounts |
| `employee_grade` / band | **C3** | HR-7 | lives in the compensation domain, not on `employee` |

### 2.2 Identity documents — a restricted domain, not columns (HR-2+, legal-gated)

CNI/passport numbers are **C3** and ratified off the `employee` row (DEC-B63; test-enforced
absence). Proposal: `employee_identifier` (see ERD) — `kind` (`CNI`, `PASSPORT`,
`IPRES`, `CSS`, `IPM`, other social/tax identifiers as legal review confirms each), the
number, issue/expiry, verification state; own permission (`hr:sensitive:read` — a decision,
see the permission doc), SELECT policy separate from `hr:read`, value **redacted from
audit** (event says *which kind* changed, never the number).

### 2.3 Fields assessed and NOT recommended for storage yet

`gender`, `date_of_birth`, `marital status`, medical/fitness data: each is C3, each is
currently **absent by ratified test**, and each stays out until the Senegal legal review
names the lawful basis, the retention period and the operational need (payroll and
IPM coverage will likely justify DOB at HR-7; nothing today does). Recording the refusal is
deliberate — "collect it in case" is how HR modules become liabilities.

## 3. Senegal localization — flags, not facts (unchanged doctrine from HR-0 §13)

Legal review required before any of these is encoded: contract-type vocabulary and
probation limits per type (Code du travail), IPRES/CSS/IPM identifiers and employer NINEA
context, leave categories and accrual (annual/sick/maternity/paternity), public-holiday
calendar, working time and overtime, disciplinary formalities, termination documentation
(certificat de travail, solde de tout compte), payslip and personnel-file retention.
XOF salary representation follows the platform rule (integer minor units in any engine;
ISO code in display — the FIN-AGING precedent). Phone/address structure: keep free text
until a validated need exists; premature format constraints reject real data.

## 4. Termination-reason vocabulary (proposal for ratification)

The prompt's RESIGNED/RETIRED states are **reasons, not states** under DEC-B62's five-state
machine. Proposed closed vocabulary on `termination_reason_code` (free-text note alongside):
`DEMISSION` · `FIN_CDD` · `LICENCIEMENT` · `RUPTURE_PERIODE_ESSAI` · `RETRAITE` · `DECES` ·
`AUTRE` (note required). Wording and completeness are an HR-management question.

## 5. Redaction & exposure rules (binding, already partly test-pinned)

- Audit payloads: ids, status before/after, dates, kind labels — never contact values,
  never identifier numbers, never amounts, never document bodies (pinned for HR-1; extend
  the pin to every new domain).
- No C2/C3 value in URLs, logs, analytics, copilot contexts, or general search.
- Exports: none in the registry; any later export is a per-domain, permission-gated,
  audited action (HR-9), C3 excluded by default.
- Fixtures and demos: synthetic only (« Employé Démo Alpha » convention), enforced the same
  way the aging fixtures are (whitelist guards, not blacklists).
