# HR-6 — Permission Analysis & Ratification Request

**Date:** 2026-08-02 · **Phase:** HR-6 Performance & Training
**Outcome:** **one** new permission code, catalogued and **granted to nobody**. Three
candidate codes were considered and deliberately **not** created.

## 1. The existing catalogue, audited first

| Code | Granted to | Purpose |
|---|---|---|
| `hr:read` | HR_OFFICER | directory + employment data |
| `hr:manage` | HR_OFFICER | create/update/lifecycle/account-link |
| `hr:config:manage` | **nobody** | HR structure & configuration (HRQ-D2 pending) |
| `hr:sensitive:read` | **nobody** | C3-classed HR data |
| `hr:leave:approve` | **nobody** | leave decisions (distinct from `hr:manage`) |

SYSTEM_ADMIN holds **no** `hr:*` (DEC-B25) and this phase does not change that.

## 2. What HR-6 created — and why exactly one code

### CREATED: `hr:performance:finalize` (granted to nobody)

Finalization is not an edit. It **freezes a person's performance record
permanently**: the evaluation becomes immutable, every objective locks, and the only
remaining transition is the employee's acknowledgment of receipt. An irreversible act on
C3 personal data should not be as routine as correcting a phone number, which is exactly
what riding `hr:manage` would make it.

This is the `hr:leave:approve` precedent applied unchanged: **the consequential authority
gets its own code, catalogued and unassigned, and activation is one INSERT after
management ratifies.** Until then the RPC is reachable by nobody — and the database
enforces the weight rule and the actor separation independently, so the gate is not the
only thing standing between a record and permanence.

## 3. What HR-6 deliberately did NOT create

### REJECTED: `hr:performance:read`

Performance **content** (comments, strengths, development areas, moderation, summary) is
C3 — and **`hr:sensitive:read` is already the C3 gate**, established in HR-3 for
C3-classed documents. Reusing it gives least privilege *and* a smaller catalogue:

* row-level access (who is in which cycle, at which stage) rides `hr:read`;
* the **prose** requires `hr:sensitive:read`, withheld at the *query*, not just the mapping.

A new read code would have split the C3 rule across two permissions, so a future
reviewer would have to know which one guards which C3 field. One rule, one gate.

### REJECTED: `hr:performance:manage`

Creating cycles and assigning objectives is ordinary HR administration — the same
authority that already creates onboarding cases and assigns equipment. The act that
needed separating is finalization, and that one **was** separated.

### REJECTED: `hr:training:manage`

Training is operational HR data, not a distinct authority. A separate code would only be
justified by a **training-coordinator seat that is not an HR seat**, and no such role
exists. Creating a permission nobody holds and no role needs is a permission nobody
maintains. If management later wants that seat, the smallest change is a new role plus
this code — additively, at that time, with the reason recorded.

## 4. Ratification requested

**RATIFY-HR6-1 — assign `hr:performance:finalize`.**

Until this is granted, evaluations can be created, self-assessed, reviewed and tracked,
but **none can be finalized**. That is the intended dark state, not a defect: the
workspace names the missing authority on screen rather than showing a button the server
refuses.

Management must decide **which seat finalizes a performance review** — and it is a real
decision, because the finalizer is structurally barred from being the reviewer
(`evaluation_finalizer_differs_from_manager`). Candidate seats:

| Option | Effect |
|---|---|
| **HR_OFFICER** | HR moderates and finalizes. Simplest. Note HR_OFFICER also holds `hr:manage`, so the *same person* could review and then finalize — the CHECK blocks it, meaning a second HR seat is required in practice. |
| **A dedicated HR manager role** | Cleanest separation: reviewer ≠ finalizer by construction, not by staffing luck. |
| **CEO / direction** | Strongest oversight, heaviest bottleneck at scale. |

**Recommendation:** a dedicated HR-manager seat. The maker-checker constraint is
structural, so a single-seat HR department cannot finalize *anything* — which will be
discovered at the worst moment if it is not decided now.

## 5. Related open decisions (not blocking HR-6 schema)

* **HRQ-P1 — employee self-service.** There is no employee-facing surface: the customer
  portal is for `client_user`, not staff. So "self-assessment" is today **entered by an HR
  operator on the employee's behalf**, and the column is named `self_entered_by` so nobody
  can later mistake it for proof the employee typed it. A genuine self-service surface is
  its own phase and its own governance decision.
* **HRQ-P2 — manager write authority.** `employee_assignment.manager_employee_id`
  reliably *identifies* the responsible manager, but DEC-B63 ratified it as
  organizational only, granting **no data access**. HR-6 therefore records the manager as
  a fact and gates the write on `hr:manage`. Letting a manager write their own team's
  reviews requires ratifying manager-scoped authority — a change to DEC-B63, not a
  side-effect of HR-6.
* **HRQ-P3 — aggregate scoring.** No overall score, average, ranking or talent
  classification exists anywhere in the schema or the code. Per-objective achievement and
  per-competency levels are stored as primitives. A formula, and what it may be used for,
  is a management and legal decision.
* **HRQ-P4 — competency framework.** No competency is seeded. What this company values in
  its people is not a decision a migration gets to make.
