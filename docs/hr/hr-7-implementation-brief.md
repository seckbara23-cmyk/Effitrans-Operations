# HR-7 — Payroll Preparation: Implementation Brief

**Status: BRIEF ONLY. HR-7 has not begun and must not begin without explicit approval.**
No code, no migration, no permission has been written for this phase.

**Ratified scope (HR-0F freeze, Audit 9):**
> *"compensation domain (C3) + versioned Finance export — **an interface, never a payroll
> engine** (DEC-B63)."*

---

## 1. The line this phase must not cross

HR-7 prepares data **for** payroll. It does not run payroll.

**In scope:** what a person is contractually paid, what varies this period, what the
period is, and a **versioned, immutable export** handed to Finance.

**Out of scope, and this is the whole design constraint:** gross-to-net computation ·
income-tax calculation · CSS / IPRES / IPM contribution rates and bases · payslip
generation · bank payment files · statutory declarations · retroactive recalculation.

Those are **legal computations under Senegalese law**. Encoding a rate — even a correct
one, even a "temporary" one — makes this platform a payroll engine and makes its authors
responsible for the arithmetic on someone's wages. The HR-5 precedent applies exactly:
no legal quantity is invented, every rate is either entered by the tenant or absent.

## 2. Blocking dependencies — HR-7 cannot start on schema alone

Unlike HR-1..HR-6, HR-7's blockers are **legal, not architectural**. Each must be closed
*before* the corresponding surface is built, not after.

| Ref | Dependency | Blocks | Owner |
|---|---|---|---|
| **B5 / DEC-B63** | identifier storage, retention classes, statutory seeds | the compensation table itself — it is C3 and may hold identifiers | **counsel** |
| **HRQ-OD1** | cost-center vocabulary on `hr_org_unit` | the export's cost dimension | management **+ Finance** (vocabulary is theirs) |
| **NEW — HRQ-PR1** | which seat may READ compensation | every read surface | management |
| **NEW — HRQ-PR2** | which seat may APPROVE a payroll period for export | the export gate (maker-checker) | management |
| **NEW — HRQ-PR3** | the Finance hand-off contract: format, fields, cadence, who consumes it | the export format | **Finance** |
| Pre-existing | `hr:config:manage` (HRQ-D2), `hr:performance:finalize` (RATIFY-HR6-1) | unrelated to HR-7, but still open | management |

**Recommendation: close HRQ-PR3 with Finance *first*.** The export contract determines
the shape of everything upstream; building the compensation model before knowing what
Finance needs from it is the one sequencing error that would cost a migration.

## 3. Proposed model (subject to the dependencies above)

Every element below reuses a proven pattern rather than inventing one.

**`hr_compensation`** — versioned, immutable rows. A change in pay is a **new row**, never
an UPDATE, exactly as `hr_template_version` and the HR-6 objective amendment work.
Effective-dated. **C3 throughout**, gated on `hr:sensitive:read` *plus* a new compensation
authority. Amounts in **integer minor units** (XOF) — the aging/leave/basis-point
discipline; no float ever touches money.

**`hr_payroll_period`** — `DRAFT → OPEN → LOCKED → EXPORTED`, terminal and immutable once
exported, on the HR-6 cycle-guard pattern. A locked period refuses new variable elements.

**`hr_payroll_element`** — the variable inputs for one employee in one period: bonus,
allowance, unpaid-leave deduction, overtime. **Each is entered or derived from an
existing HR fact** (approved leave from HR-5, recorded attendance from HR-5) — never
computed from a rate.

**`hr_payroll_export`** — an immutable artifact with a content hash, version number and
the actor who released it. Reuses the WES-4/expense-document evidence idiom. **This is
the Finance boundary**: HR writes the artifact, Finance consumes it. HR never writes a
Finance table; Finance never reads `hr_compensation`.

**Transactional RPCs** — locking a period, and releasing an export, each commit their
transition, their artifact and their ledger events together, per ADR-HR2-01.

**Ledger kinds** — `compensation_recorded` (kind and effective date only, **never the
amount** — the HR-1 C3 payload rule), `payroll_period_locked`, `payroll_export_released`.

## 4. Permissions — expected shape

On the HR-6 finding that most `hr:*` needs are already covered:

* **`hr:compensation:read`** — genuinely new. Compensation is more sensitive than the
  rest of C3 and a *separate* population reads it. Reusing `hr:sensitive:read` would give
  every C3 reader access to salaries, which is not least privilege.
* **`hr:payroll:approve`** — the export gate, granted to nobody until HRQ-PR2, on the
  `hr:leave:approve` / `hr:performance:finalize` precedent.
* Ordinary period and element management: **`hr:manage`** — no new code.

Expected total: **two** new codes, both catalogued and granted to nobody at ship.

## 5. Non-negotiables carried forward

Tenant isolation · RLS on every table · no portal policy · **SYSTEM_ADMIN sees zero**
(DEC-B25) · additive forward-only idempotent migrations · **no C3 in logs, URLs,
notifications, AI prompts or audit payloads** · immutable finalized records · no
permission granted without ratification · **no production application until CI is green
with zero skipped** — reinforced by DEV-HR6-01.

## 6. Recommended sequencing

1. **HR-7-0** — audit + Finance contract workshop closing HRQ-PR3 and HRQ-OD1. *Documents
   only.* Nothing is built.
2. **HR-7-A** — compensation domain, dark, gated on the counsel answer to B5/DEC-B63.
3. **HR-7-B** — payroll periods + variable elements.
4. **HR-7-C** — the versioned Finance export and its hand-off.
5. **HR-7-D** — workspace activation (the « Préparation de paie » tile, currently a
   correctly-labelled HR-7 roadmap tile).

**HR-7 begins only on explicit approval.**
