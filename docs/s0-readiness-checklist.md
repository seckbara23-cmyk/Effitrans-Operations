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

**Overall Readiness:** ☐ Not Started · ☐ In Progress · ☐ Ready For S0 · ☑ **S0 COMPLETE — S2 gated only on BLK-1/3/6/9**

| Field | Value |
|---|---|
| Last Updated | 2026-06-13 |
| Owner | Project facilitator (Bara Seck) |
| Phase | **S0 Foundation Sprint COMPLETE.** Security review passed. S2 awaits the four 🔴 business blockers. |
| Headline | **S0 FOUNDATION COMPLETE (2026-06-13).** All 18 tasks done; Waves 0–4 shipped & validated. RLS-1 (`0/1/1/0`) + RLS-2 (`1/0`) validated on the linked DB; security review PASSED ([s0-security-review.md](s0-security-review.md)). S2 business work is **cleared to begin once BLK-1, BLK-3, BLK-6, BLK-9 are Approved**. |

**One-line status:** *Foundation done and security-reviewed. The platform has a proven multi-tenant, RBAC, append-only-audit base. S2 (Operational File + business modules) may begin the moment the four 🔴 workshop blockers close — no further foundation work is required.*

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
| BLK-6 | 🔴 | File-numbering scheme per type (year/branch/sequence) | Operations | Ops sync | **Closed / Approved** | 2026-06-14 | `EFT-{TYPE}-{YEAR}-{SEQUENCE}`, 5-digit seq per tenant×type×year (DEC-B06). Unblocks Phase 1.2 Operational File. |
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

**✅ Recently closed (not in the 19 above):** **BLK-AR1** — *Is Supabase acceptable to Effitrans IT?* → **CLOSED / Approved 2026-06-13.** Management confirmed Supabase for Phase 1 foundation work. Recorded as [DEC-A06](decision-register.md). This was the sole start-gate on S0 execution; the four 🔴 blockers gate **S2**, not S0.

---

## Architecture Gates

**Platform gate (start-gate for S0 execution):**
☑ **Supabase platform approved — *(BLK-AR1 — DEC-A06, 2026-06-13)*** ✅

### Required Before **S2** (business schema/customs/catalog — NOT foundation S0)
> Per the [S0 backlog guardrail](s0-backlog.md#scope-guardrail-read-first), the foundation sprint is independent of these. They gate the **business-domain** work in S2+, not the 18 foundation tasks.

☐ Hosting **region** confirmed — *(BLK-9)*
☐ Data residency confirmed — *(BLK-9)*
☐ Integration assumptions approved — *(BLK-1)*
☑ File numbering approved — *(BLK-6 — DEC-B06, 2026-06-14)*
☐ Document catalog approved — *(BLK-3)*
☐ Expiry rules approved — *(BLK-3)*

**S2 gate status: 0 / 6 — NOT MET** (foundation S0 does not require these).

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
| Approved By | Effitrans Management (BLK-AR1) |
| Date | 2026-06-13 |

**Decision:** ☑ **GO — S0 foundation (18 allowed tasks)** · ☐ CONDITIONAL GO · ☐ NO-GO for S2

**Standing conditions (now that the platform gate is met):**
1. Execute **only the 18 allowed foundation tasks** (INF-1..4, DB-1..4, AUTH-1..3, AUTHZ-2, RLS-1..2, AUD-1..2, UI-1..2). AUTHZ-1/AUTHZ-3 build on provisional defaults only.
2. **Do not** implement Operational File, Workflow Engine, Document Catalog, Customs Tracking, File Numbering, or Expiry Engine — these remain **NO-GO** until 🔴 BLK-1/3/6/9 are Approved.
3. Run **both workshops within ~1 week** to close the four 🔴 blockers and unlock S2.
4. Supabase **region** is provisional (BLK-9); keep teardown/recreate cheap (S0-INF-1) until residency is confirmed.

---

## Accepted Risks

Assumptions in force **if S0 infrastructure work starts before all blockers close**. Each is a documented default from the planning docs; each carries a reversal cost if the workshop overrides it.

| # | Assumption (default) | Source | Reversal cost if wrong | Accepted by | Date |
|---|---|---|---|---|---|
| AR-1 | ~~Hosting = managed cloud (Supabase)~~ → **platform RATIFIED** (BLK-AR1, DEC-A06). Only the **region** stays provisional pending BLK-9. | architecture.md / Mgmt-IT §1 | Low — region only; data has no value yet | **Management** | **2026-06-13** |
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
| **S0 Foundation Sprint** | ✅ **COMPLETE & validated** (18/18 tasks; security review passed) |
| Open 🔴 **S2-gating** blockers | **3** (BLK-1, BLK-3, BLK-9) — BLK-6 closed 2026-06-14 (DEC-B06); business-side; do NOT block S0 |
| Open 🟠 blockers | **6** (BLK-2, BLK-8, BLK-10, BLK-RB1, BLK-RB2, BLK-DB1) |
| Open 🟡 blockers | **9** |
| Closed Blockers | **1** (BLK-AR1) + RLS-1/RLS-2 validated |
| Accepted Risks (ratified) | **1 of 7** (AR-1 platform; region pending BLK-9) |

### Readiness Score: **60 / 100** (readiness to ENTER S2)

Weighted basis:
| Component | Weight | Done | Contribution |
|---|---|---|---|
| Planning documentation authored | 20% | 100% | 20 |
| Workshop sheets prepared | 5% | 100% | 5 |
| **S0 foundation built & validated** (Waves 0–4 + security review) | 35% | 100% | 35 |
| Workshops close 🔴 BLK-1/3/6/9 | 30% | 0% | 0 |
| 🟠 blockers closed | 10% | 0% | 0 |
| **Total** | 100% | | **60** |

Interpretation: **S0 is 100% done; the remaining 40 points are business-side decisions, not engineering.** The score reaches **~90%** once the two workshops close the four 🔴 blockers → **S2 may begin**. The 🟠 items finalize provisional RBAC (BLK-RB1/RB2) and tune scope. **No further foundation work is required to reach S2.**

---

## Recommendation

**Auto-determination:** ☑ **GO — Start S0 foundation now** · ☐ Conditional · ☐ Delay · ☐ Escalate

### Rationale
- **BLK-AR1 is closed.** Supabase is approved (DEC-A06), which was the **only** real gate on starting S0 execution. The 18 allowed foundation tasks no longer wait on anything.
- **The four 🔴 blockers gate S2, not S0.** Per the [S0 backlog guardrail](s0-backlog.md#scope-guardrail-read-first), the foundation sprint touches no business schema, workflow, catalog, customs, numbering, or expiry — so BLK-1/3/6/9 do not block any of the 18 tasks.
- **Two tasks build provisionally:** AUTHZ-1 (role seed) and AUTHZ-3 (named admin) proceed on documented defaults and reconcile when BLK-RB1/RB2 close — they are **not** blocked.

### Directed next actions
1. **Now:** begin S0 foundation execution (see [Execution Order](#s0-execution-order) — added below).
2. **This week, in parallel:** run the Chief of Transit and Management/IT workshops to close 🔴 BLK-1/3/6/9 and unlock S2.
3. **Keep the region provisional** (BLK-9): cheap teardown/recreate until residency confirmed.
4. **Escalate only if** a strategic-client restriction (BLK-9) forces on-prem/regional hosting — that would revisit DEC-A06's region, not the platform.

**Bottom line:** **S0 foundation is GO — start the 18 allowed tasks now.** S2 (Operational File, Workflow, Document Catalog, Customs, File Numbering, Expiry Engine) stays **NO-GO** until the four 🔴 blockers are Approved.

---

## S0 Execution Order & Progress

The 18 allowed foundation tasks. ✅ = done · 🟡 = ready/next · ⚠️ = built on a provisional default. **Waves 0–3 complete (2026-06-13); RLS-1 validated.**

**Wave 0 — ✅ COMPLETE** (commit 51080cf)
- ✅ **S0-INF-1** Provision Supabase (provisional region)
- ✅ **S0-DB-1** tenant_id strategy & convention
- ✅ **S0-UI-1** existing-UI reuse/throwaway assessment

**Wave 1 — ✅ COMPLETE** (commit 332bcda)
- ✅ **S0-INF-2** env-var strategy
- ✅ **S0-DB-4** migration tooling (DEC-A12)
- ✅ **S0-INF-4** local dev setup

**Wave 2 — ✅ COMPLETE** (commit 7ce6f3e)
- ✅ **S0-DB-2** organization table
- ✅ **S0-DB-3** audit_log table (append-only)
- ✅ **S0-AUTH-1** Supabase Auth (clients)
- ✅ **S0-AUTH-2** app_user profile
- ✅ **S0-INF-3** CI/CD

**Wave 3 — ✅ COMPLETE** (commit 8e17d0f)
- ✅ ⚠️ **S0-AUTHZ-2** user_role + union resolution *(provisional seed, pending BLK-RB1)*
- ✅ **S0-AUTH-3** session handling & route protection
- ✅ **S0-AUD-1** append-only audit write path
- ✅ **S0-RLS-1** tenant-isolation baseline — **VALIDATED 2026-06-13** (manual SQL-Editor test: `0 / 1 / 1 / 0`)

**Wave 4 — ✅ COMPLETE & VALIDATED** (commit 15a810b)
- ✅ **S0-RLS-2** role-scope policy hooks — **VALIDATED 2026-06-13** (role-scope test `admin=1 / plain=0`; RLS-1 regression re-check `0/1/1/0` PASS)
- ✅ **S0-AUD-2** actor/override tracking + read-only audit view (user-context client)
- ✅ **S0-UI-2** auth/session shell + permission-filtered nav + minimal `/login`

> **S0→S2 security review: ✅ PASSED** — see [s0-security-review.md](s0-security-review.md). All 18 foundation tasks complete and validated. **No further foundation work required.** S2 (business-domain) remains gated only by 🔴 BLK-1/3/6/9.

> **Note on AUTHZ-1:** the role/permission **seed** (a prerequisite for AUTHZ-2) is in the allowed scope but runs on the **provisional** rbac-matrix defaults (BLK-RB1) — marked ⚠️. It is data, re-runnable, and reconciled when BLK-RB1 closes. AUTHZ-3 (named admin, BLK-RB2) is likewise provisional and is the only allowed task deferred to after AUTHZ-2/AUD-1.

### Critical path
```
INF-1 → DB-4 → DB-2 → DB-3 → AUD-1 ┐
                 └→ AUTH-1 → AUTH-2 → AUTHZ-2 → AUTH-3 → RLS-1 → RLS-2 ┘ → security review → (S2 gate)
```
Longest chain ≈ **INF-1 → AUTH-1 → AUTH-2 → AUTHZ-2 → AUTH-3 → RLS-1 → RLS-2 → security review.** RLS-1/RLS-2 + the security review are the true critical path — they are the boundary that must be proven before S2 is authorized.

### Remaining blockers before S2
| Blocker | Closes via | Gates |
|---|---|---|
| 🔴 BLK-1 | CoT §7 + Mgmt/IT §1 | Customs tracking (S7) |
| 🔴 BLK-3 | CoT §2 + §3 | Document catalog + expiry engine (S5/S6) |
| ✅ BLK-6 | **Closed 2026-06-14** | File numbering `EFT-{TYPE}-{YEAR}-{SEQUENCE}` → Operational File unblocked (DEC-B06) |
| 🔴 BLK-9 (region) | Mgmt/IT §1 | Hosting region finalization (platform already approved) |
| 🟠 BLK-RB1 / BLK-RB2 | Mgmt/IT §4 | Finalize AUTHZ-1/AUTHZ-3 (provisional now) |

**S2 cannot start until all four 🔴 are Approved** in the [decision register](decision-register.md). The 🟠 items only finalize the two provisional foundation tasks; they do not block S0.
