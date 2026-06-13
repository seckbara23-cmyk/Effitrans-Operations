# Effitrans S0 Readiness Checklist

> **Governance Notice**
>
> This document is derived from decisions recorded in [`docs/decision-register.md`](decision-register.md). It is the single source of truth for **readiness/Go-No-Go status**; the Decision Register remains the authoritative source for the **decisions** themselves.
>
> The Decision Register is the **authoritative source** for all business, architecture, security, workflow, hosting, integration, and platform decisions.
>
> Contributors must **not** change assumptions or requirements directly in this document without first updating the corresponding decision entry in the Decision Register.
>
> If a decision changes: (1) update or supersede the decision in the Decision Register, (2) record the date and owner, (3) update all affected downstream documents.
>
> **In case of conflict between documents, the Decision Register takes precedence.**

Single source of truth for deciding whether Phase 1 development (Sprint S0) can begin. Aggregates every blocker from the planning docs and both workshop sheets into one Go/No-Go view.

**Sources:** [audit.md](audit.md) · [requirements.md](requirements.md) · [state-machine.md](state-machine.md) · [document-catalog.md](document-catalog.md) · [database-design.md](database-design.md) · [rbac-matrix.md](rbac-matrix.md) · [architecture.md](architecture.md) · [phase-1-roadmap.md](phase-1-roadmap.md) · [chief-of-transit-workshop.md](workshops/chief-of-transit-workshop.md) · [management-it-decision-workshop.md](workshops/management-it-decision-workshop.md) · [decision-register.md](decision-register.md)

---

## Executive Summary

**Overall Readiness:** ☐ Not Started · ☑ **In Progress** · ☐ Ready For S0 · ☐ Ready For S1

| Field | Value |
|---|---|
| Last Updated | 2026-06-13 |
| Owner | Project facilitator (Bara Seck) |
| Phase | Pre-S0 — planning complete, decisions pending |
| Headline | All 11 governance docs + 2 workshop sheets authored. **Zero blockers ratified.** S0 cannot fully start until BLK-1, BLK-3, BLK-6, BLK-9 close. |

**One-line status:** *Documentation is done; decisions are not. Run the two workshops, close the four S0-gating blockers, then start S0.*

---

## Critical Blockers Register

Status values: **Open** · **Pending Validation** (in a scheduled workshop) · **Closed** · **Accepted Risk** (proceeding on a documented default).

Severity: 🔴 S0-gating · 🟠 S1-gating · 🟡 sprint-local (needed later in Phase 1).

| ID | Sev | Description | Owner | Source Workshop | Status | Decision Date | Notes |
|---|---|---|---|---|---|---|---|
| BLK-1 | 🔴 | GAINDE / Orbus real API availability vs manual reference-tracking | IT + Chief of Transit | CoT §7 Integration Reality + Mgmt/IT §1 | Open | — | Default: reference-tracking. Closing confirms S7 design. |
| BLK-2 | 🟠 | Volumes: files/month, docs/file, storage growth | Operations / Management | Mgmt/IT §5 Capacity | Open | — | Needed for sizing; default = size for 65 users. |
| BLK-3 | 🔴 | Complete document-type list + validity periods + block-vs-warn | Chief of Transit | CoT §2 + §3 | Open | — | Drives the expiry engine (S5/S6). Hard S0 gate. |
| BLK-4 | 🟡 | Notification matrix (event × audience × channel) | Operations | CoT §6 + Mgmt/IT §3 | Open | — | Needed by S9. Default = email+SMS to AM + next-action role. |
| BLK-5 | 🟡 | WhatsApp Business API budget approved? | Management | Mgmt/IT §3 | Open | — | Default = email+SMS in P1, WhatsApp P2. |
| BLK-6 | 🔴 | File-numbering scheme per type (year/branch/sequence) | Operations | Ops sync (ref requirements/DB) | Open | — | Needed for S2. Hard S0 gate. |
| BLK-7 | 🟡 | Field/port offline tolerance required? | Operations | Ops sync (NFR-06) | Open | — | Affects S8 transport UX. |
| BLK-8 | 🟠 | Migrate history vs clean start + legacy archive | Management | Mgmt/IT §2 | Open | — | Default = clean start. Affects S12 cutover. |
| BLK-9 | 🔴 | Data residency / hosting / Supabase acceptable / client restrictions | Management + clients | Mgmt/IT §1 | Open | — | Strategic-client (BP/Woodside/Kosmos/Petrosen) restrictions must be confirmed. Hard S0 gate. |
| BLK-10 | 🟠 | POD acceptance criteria ("validate authenticity") | Operations (CoT/AM) | CoT §5 | Open | — | Needed by S4/S8. |
| BLK-RB1 | 🟠 | Confirm 13–15 role list maps to real job functions | Operations / Management | Mgmt/IT §4 + CoT §1.2 | Open | — | Needed for S1 role seed. |
| BLK-RB2 | 🟠 | Designated IT System Admin + break-glass backup | Management / IT | Mgmt/IT §4 | Open | — | S1 governance; risk R14. |
| BLK-RB3 | 🟡 | Multi-role users get union of permissions? (assumed yes) | IT / Dev | Architecture/dev decision | Open | — | Technical default; low risk. |
| BLK-RB4 | 🟡 | "Team/zone" definition for Coordinator (geo / client / org-unit) | Operations | CoT §1 + ops sync | Open | — | Affects RLS TEAM scope. |
| BLK-RB5 | 🟡 | Can Account Managers see each other's files? | Operations / Management | Mgmt/IT §4 + ops sync | Open | — | Visibility tightness. |
| BLK-DB1 | 🟠 | app_user ↔ Supabase Auth 1:1 vs HR/identity sync | IT | Mgmt/IT §4 | Open | — | Identity model; S1. |
| BLK-DB2 | 🟡 | Do clients and partners ever overlap? | Operations / Dev | Ops sync | Open | — | Party modelling. |
| BLK-DB3 | 🟡 | Multi-currency in Phase 1 (XOF + USD/EUR)? | Finance / Management | Mgmt/IT §7 | Open | — | Money columns. |
| BLK-DB4 | 🟡 | Retention policy for archived documents/files (Senegal legal) | Management / Compliance | Mgmt/IT §2 | Open | — | Storage lifecycle. |

**Tally:** 19 total — 🔴 4 (S0-gating) · 🟠 6 (S1-gating) · 🟡 9 (sprint-local). **Closed: 0. Accepted Risk: 0.**

---

## Architecture Gates

### Required Before S0
☐ Hosting decision approved — *(BLK-9)*
☐ Data residency confirmed — *(BLK-9)*
☐ Integration assumptions approved — *(BLK-1)*
☐ File numbering approved — *(BLK-6)*
☐ Document catalog approved — *(BLK-3)*
☐ Expiry rules approved — *(BLK-3)*

**S0 gate status: 0 / 6 — NOT MET.**

### Required Before S1
☐ Admin governance approved — *(BLK-RB2)*
☐ Identity strategy approved — *(BLK-DB1, BLK-AR3)*
☐ Volume estimates approved — *(BLK-2)*
☐ Tenant strategy approved — *(Q32 / Mgmt/IT §6 — default: Multi-Tenant Ready)*

**S1 gate status: 0 / 4 — NOT MET.**

---

## Workshop Status

**Chief of Transit Workshop** — ☐ Complete · ☐ In Progress · ☑ **Not Started** *(sheet authored, ready to run)*
**Management / IT Workshop** — ☐ Complete · ☐ In Progress · ☑ **Not Started** *(sheet authored, ready to run)*
**Decision Register Updated** — ☐ Complete · ☑ **In Progress** *(starter entries seeded; awaiting workshop outcomes)* · ☐ Not Started

---

## Go / No-Go Framework

### S0 Authorization

| Field | Value |
|---|---|
| Approved By | ______ |
| Date | ______ |

**Decision:** ☐ GO · ☑ **CONDITIONAL GO** *(recommended — see Recommendation)* · ☐ NO-GO

**Conditions (must hold for the conditional GO):**
1. Schedule and run **both workshops within ~1 week**; close 🔴 BLK-1, BLK-3, BLK-6, BLK-9 before any schema/customs/expiry work is committed.
2. Limit immediate S0 work to **blocker-independent infrastructure** (see Accepted Risks): Supabase project, repo/CI scaffolding, RLS baseline pattern, auth shell — using documented defaults.
3. **Do not finalize** the document_type catalog, file-numbering, or hosting region until the workshops ratify them.

---

## Accepted Risks

Assumptions in force **if S0 infrastructure work starts before all blockers close**. Each is a documented default from the planning docs; each carries a reversal cost if the workshop overrides it.

| # | Assumption (default) | Source | Reversal cost if wrong | Accepted by | Date |
|---|---|---|---|---|---|
| AR-1 | Hosting = managed cloud (Supabase), nearest compliant region | architecture.md / Mgmt-IT §1 | Medium — redeploy/region migration | ______ | ______ |
| AR-2 | GAINDE/Orbus = manual reference-tracking (no live API) | architecture.md / CoT §7 | Low — additive if API later appears | ______ | ______ |
| AR-3 | Migration = clean start + legacy read-only archive | Mgmt-IT §2 | Low — history stays in legacy | ______ | ______ |
| AR-4 | Channels = email + SMS only in Phase 1 | requirements.md / Mgmt-IT §3 | Low — WhatsApp additive in P2 | ______ | ______ |
| AR-5 | Tenancy = Multi-Tenant Ready (`tenant_id` + RLS), no SaaS control plane | architecture.md / Mgmt-IT §6 | Low — schema discipline only | ______ | ______ |
| AR-6 | Identity = Supabase Auth, MFA for admins/external | Mgmt-IT §4 | Low–Medium — swap to SSO later | ______ | ______ |
| AR-7 | Finance = keep Sage, replace Maya in P2; nothing financial in P1 | audit.md / Mgmt-IT §7 | Low — out of P1 scope | ______ | ______ |

> ⚠️ The **document catalog (BLK-3)**, **file numbering (BLK-6)**, and **hosting region (BLK-9)** are deliberately **NOT** on the accepted-risk list — they are hard S0 gates and must be ratified, not assumed.

---

## Readiness Metrics

| Metric | Value |
|---|---|
| Open Critical Blockers (🔴 S0-gating) | **4** (BLK-1, BLK-3, BLK-6, BLK-9) |
| Open Medium Blockers (🟠 S1-gating) | **6** (BLK-2, BLK-8, BLK-10, BLK-RB1, BLK-RB2, BLK-DB1) |
| Open Minor Blockers (🟡 sprint-local) | **9** |
| Closed Blockers | 0 |
| Accepted Risks (ratified by management) | 0 of 7 proposed |

### Readiness Score: **40 / 100**

Weighted basis:
| Component | Weight | Done | Contribution |
|---|---|---|---|
| Planning documentation authored | 30% | 100% | 30 |
| Workshop sheets prepared | 10% | 100% | 10 |
| Workshops completed (decisions made) | 30% | 0% | 0 |
| 🔴 S0-gating blockers closed | 20% | 0% | 0 |
| 🟠 S1-gating blockers closed | 10% | 0% | 0 |
| **Total** | 100% | | **40** |

Interpretation: **planning phase complete (40%); decision phase not started.** Score reaches **~70%** when both workshops close the 🔴 gates → **Ready For S0**. Reaches **~90%+** when 🟠 gates close → **Ready For S1**.

---

## Recommendation

**Auto-determination:** ☑ **Start S0 (Conditional)** · ☐ Delay S0 · ☐ Escalate Decision

### Rationale
- **Pure S0 (schema/customs/expiry) = NO-GO today:** 4 of 4 S0 architecture gates are unmet (BLK-1, BLK-3, BLK-6, BLK-9 all Open). Committing the document catalog, file-numbering, or hosting region now would mean building on unratified assumptions — exactly the rework the audit warns against.
- **But the critical path need not stall.** A meaningful slice of S0 is **blocker-independent**: standing up the Supabase project, repo/CI, the RLS baseline pattern, and the auth shell does **not** depend on any open blocker and can begin immediately under the Accepted Risks above.
- **The blockers are days away, not weeks.** Both workshop sheets are authored and ready; the 🔴 gates are answerable in two sessions. The correct move is **parallelism, not delay**: run the workshops now while the team does blocker-independent setup.

### Directed next actions
1. **This week:** schedule + run the Chief of Transit and Management/IT workshops. Target: close BLK-1, BLK-3, BLK-6, BLK-9.
2. **In parallel:** begin S0 infrastructure (Supabase, CI, RLS baseline, auth shell) — nothing that hardcodes catalog/numbering/region.
3. **On workshop close:** update [decision-register.md](decision-register.md), flip the architecture gates, recompute this score, and convert CONDITIONAL GO → **GO** for the blocker-dependent S0 work.
4. **Escalate only if** a strategic-client data restriction (BLK-9) forces on-prem/regional hosting — that single answer can change the platform choice and would warrant a focused decision.

**Bottom line:** Do **not** wait idle for the workshops. **Begin blocker-independent S0 now; gate the schema/customs/expiry work on the four 🔴 blockers, which should close within a week.**
