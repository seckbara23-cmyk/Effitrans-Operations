# Workshop — Management & IT Decision Sheet
## Atelier de décision — Direction & SI

> **Governance Notice**
>
> This workshop **produces** decisions that must be recorded in [`docs/decision-register.md`](../decision-register.md) — the **authoritative source** for all business, architecture, security, workflow, hosting, integration, and platform decisions.
>
> After the workshop, transfer every confirmed answer into the Decision Register before it is treated as binding: (1) add or supersede the decision, (2) record the date and owner, (3) update all affected downstream documents, then close the matching `BLK-*` items.
>
> **In case of conflict between documents, the Decision Register takes precedence.**

**Purpose / Objet :** Resolve every **non-operational** blocker before development begins — hosting, data residency, migration, communication channels, identity governance, capacity, commercialization, financial-system strategy, budget, and risk acceptance. Every answer here must be **documented and approved by management**.

**Companion sheet:** [chief-of-transit-workshop.md](chief-of-transit-workshop.md) resolves the customs/operational rules. This sheet resolves everything else.

**How to use:** For each question, tick the option or fill the blank (`______`). Record the final decision in the [Executive Decision Log](#executive-decision-log--journal-des-décisions-direction). Anything unresolved goes to [Open Issues](#open-issues--problèmes-ouverts). Sign off at the end.

**Validates / unblocks:** [architecture.md](../architecture.md) · [requirements.md](../requirements.md) · [phase-1-roadmap.md](../phase-1-roadmap.md) · [audit.md](../audit.md) risk register.

| Field | Value |
|---|---|
| Date of workshop | ______ |
| Project sponsor (management) | ______ |
| IT lead | ______ |
| Other attendees | ______ |
| Version | 1.0 (draft for completion) |

> **Rule for this workshop: do not assume. Each decision must be explicitly approved by management.** Where a decision is not made, the documented **default** applies and is flagged as a risk.

---

# 1. Hosting & Data Residency / Hébergement & résidence des données

**Unblocks:** BLK-9, BLK-AR1, BLK-AR2 · risk R15

| Question | Answer |
|---|---|
| Is **cloud hosting** acceptable in principle? | ☐ Yes ☐ No ☐ With conditions: ______ |
| Is **Supabase** (managed Postgres/Auth/Storage) acceptable? | ☐ Yes ☐ No ☐ Need review: ______ |
| Are there **contractual data restrictions** from strategic clients (BP, Woodside, Kosmos, Petrosen, others)? | ☐ Yes ☐ No ☐ Unknown → who confirms: ______ |
| → If yes, which client(s) and what exact restriction? | ______ |
| Must data **remain physically in Senegal**? | ☐ Yes ☐ No ☐ Some data only: ______ |
| Is **EU hosting** acceptable (if Senegal region unavailable)? | ☐ Yes ☐ No |
| Is **on-premise** deployment required or preferred? | ☐ Required ☐ Acceptable ☐ Not wanted |
| Any existing Effitrans hosting / data-center / cloud contract to reuse? | ______ |
| Encryption / backup / retention requirements imposed by clients? | ______ |

### Decision — Deployment model
☐ **Cloud** (managed, e.g. Supabase) — region: ______
☐ **Hybrid** (cloud app + restricted data on-prem/regional) — split: ______
☐ **On-Prem** (self-hosted Postgres + storage) — who operates it: ______

**Default if undecided:** Cloud, nearest compliant region, pending written confirmation of client restrictions. *(Flag as risk until confirmed.)*

---

# 2. Historical Data Migration / Migration des données historiques

**Unblocks:** BLK-8 · risk R12

| Question | Answer |
|---|---|
| Approximately how many **historical files** exist? | ______ |
| How many **years** of history must be available in the platform? | ______ |
| Which systems hold historical data? (tick + estimate volume) | ☐ Excel: ___ ☐ Maya: ___ ☐ Shared drives: ___ ☐ Paper archives: ___ ☐ Other: ___ |
| Is historical data **structured** (consistent columns) or ad-hoc? | ______ |
| Is there a **legal minimum retention** period (Senegal/customs)? | ______ |
| Who can provide/extract the historical data? | ______ |

### Options
☐ **A. Clean start** — go live with new files only; legacy kept **read-only** in current systems/drives (lowest risk, recommended default)
☐ **B. Import recent years** — migrate last ___ year(s) of files; older stays archived
☐ **C. Full migration** — migrate all history (highest cost/risk; requires structured source data)

### Decision log
| Decision | Scope (years/systems) | Approved by | Date |
|---|---|---|---|
| ______ | ______ | ______ | ______ |

**Default if undecided:** Option A (clean start + legacy read-only archive).

---

# 3. Communication Channels / Canaux de communication

**Unblocks:** BLK-5 · REQ-N03/N04 · risk R8

| Question | Answer |
|---|---|
| **Email** provider for transactional notifications? | ______ |
| Existing corporate email domain to send from? | ______ |
| **SMS** provider / gateway (Senegal-capable)? | ______ |
| Is **WhatsApp Business API** budget approved (BSP + approved templates, recurring cost)? | ☐ Yes, budget: ______ ☐ No ☐ Later |
| Are **mobile push notifications** (native app) required? | ☐ Yes ☐ No ☐ Phase 2+ |
| Preferred default channel per audience (internal vs client)? | ______ |

### Decision — Channels by phase
| Channel | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Email | ☐ | ☐ | ☐ |
| SMS | ☐ | ☐ | ☐ |
| WhatsApp Business API | ☐ | ☐ | ☐ |
| Mobile push | ☐ | ☐ | ☐ |

**Default if undecided:** Email + SMS in Phase 1; WhatsApp deferred to Phase 2.

---

# 4. User & Identity Governance / Gouvernance des identités

**Unblocks:** BLK-RB2, BLK-AR3, BLK-DB1 · risk R14

| Question | Answer |
|---|---|
| Designated **System Administrator** (single, named)? | ______ |
| **Backup / break-glass Administrator**? | ______ |
| **Password policy** (length, complexity, rotation)? | ______ |
| Is **MFA** required? For which roles (all / admins / external)? | ☐ All ☐ Admins only ☐ External only ☐ None — detail: ______ |
| Is **SSO** required (existing identity provider)? | ☐ Yes — provider: ______ ☐ No (standalone Supabase Auth) |
| Existing **HR/identity source** to sync users from? | ______ |
| Account lifecycle: who approves joiners/movers/leavers? | ______ |
| External (client/partner) account approval process? | ______ |

### Decision log
| Topic | Decision | Approved by | Date |
|---|---|---|---|
| System Admin | ______ | ______ | ______ |
| Backup Admin | ______ | ______ | ______ |
| MFA | ______ | ______ | ______ |
| SSO | ______ | ______ | ______ |

**Default if undecided:** standalone Supabase Auth, MFA for admins + external users, one named admin + one break-glass backup.

---

# 5. Volume & Capacity Planning / Volumétrie & capacité

**Unblocks:** BLK-2 · risk R6 · NFR-05/08

| Question | Answer |
|---|---|
| **Files per month** (avg / peak)? | avg: ______ / peak: ______ |
| **Documents per file** (avg)? | ______ |
| Average **document size** (scans vs PDFs)? | ______ |
| Expected **annual growth** (%)? | ______ |
| Number of **internal users** (confirmed 65)? | ______ |
| Number of **external clients** using the portal (Phase 2)? | ______ |
| Peak **concurrent users**? | ______ |
| Seasonal peaks (project cargo, campaigns)? | ______ |

### Output — Sizing assumptions (derived after the above)
| Metric | Assumption |
|---|---|
| Files/year | ______ |
| Documents/year | ______ |
| Storage/year (GB) | ______ |
| 3-year storage projection | ______ |
| DB sizing tier | ______ |
| Storage tier / lifecycle policy | ______ |

**Default if undecided:** size for 65 internal users + moderate file volume; revisit storage tier once real numbers arrive. *(Under-sizing flagged as risk.)*

---

# 6. Commercialization Strategy / Stratégie de commercialisation

**Unblocks:** Q32 · architecture multi-tenancy decision · risk R11

| Question | Answer |
|---|---|
| Is this **internal-only**, or intended for future **SaaS** sale? | ☐ Internal only ☐ Future SaaS ☐ Undecided |
| If SaaS: rough **timeline**? | ______ |
| Would it be a **separate business unit** / product company? | ☐ Yes ☐ No ☐ TBD |
| Any target customers/segments already in mind? | ______ |
| Appetite to fund the SaaS control plane (onboarding, billing, tenant admin) now vs later? | ______ |

### Decision — Architecture posture
☐ **Single Tenant** — internal only; minimal tenant scaffolding
☐ **Multi-Tenant Ready** *(recommended)* — `tenant_id` + RLS from day one, **no SaaS control plane built**; commercialization optional later
☐ **Full SaaS** — build onboarding/tenant-admin/subscription now (only if funded + customer validated)

**Default if undecided:** Multi-Tenant Ready (the [architecture.md](../architecture.md) recommendation) — preserves optionality cheaply, defers all SaaS machinery to Phase 3.

---

# 7. Financial System Strategy / Stratégie des systèmes financiers

**Unblocks:** Maya/Sage scope · risk R1/R3

| Question | Answer |
|---|---|
| **Keep Sage** for accounting (vs rebuild)? | ☐ Keep ☐ Rebuild *(strongly discouraged)* |
| **Integrate Sage** with the platform, and when? | ☐ Phase 2 ☐ Phase 3 ☐ No integration — detail: ______ |
| What should flow **platform → Sage** (billed files, cost data)? In what format (CSV/API)? | ______ |
| **Replace Maya** (invoicing) with native billing? | ☐ Yes ☐ No |
| Maya replacement **timeline**? | ☐ Phase 2 ☐ Phase 3 |
| Anything we must **read from Maya** in the interim? | ______ |
| Who owns the finance-integration decision/approval? | ______ |

### Decision log
| Topic | Decision | Approved by | Date |
|---|---|---|---|
| Sage | ☐ Keep ☐ Integrate (Phase __) | ______ | ______ |
| Maya | ☐ Replace (Phase __) ☐ Keep | ______ | ______ |

**Default (per audit):** Keep + integrate Sage in Phase 2; replace Maya with native billing in Phase 2; **never rebuild accounting**. Phase 1 leaves both untouched (reference-tracking only).

---

# 8. Budget & Timeline Approval / Budget & calendrier

| Question | Answer |
|---|---|
| Target **go-live date** for Phase 1? | ______ |
| Is the ~6-month / 13-sprint plan ([phase-1-roadmap.md](../phase-1-roadmap.md)) acceptable? | ☐ Yes ☐ Adjust: ______ |
| **Phase 1 budget** (development + infra + licenses)? | ______ |
| Recurring infra/licensing budget (hosting, SMS, email)? | ______ |
| Internal **project sponsor** (accountable executive)? | ______ |
| **Acceptance authority** (who signs Phase 1 as done)? | ______ |
| Pilot group / department for first rollout? | ______ |
| Training & change-management owner? | ______ |

### Decision log
| Item | Decision | Approved by | Date |
|---|---|---|---|
| Go-live target | ______ | ______ | ______ |
| Phase 1 budget | ______ | ______ | ______ |
| Sponsor | ______ | ______ | ______ |
| Acceptance authority | ______ | ______ | ______ |

---

# 9. Risk Acceptance / Acceptation des risques

Management explicitly acknowledges and accepts the following Phase 1 posture. Tick to accept; note conditions otherwise.

| Risk area | What is being accepted | Accept | Condition / mitigation required |
|---|---|---|---|
| **Cloud risks** | Data hosted on managed cloud (per Section 1 decision) | ☐ | ______ |
| **Integration assumptions** | GAINDE / Orbus / Maya / Sage are **reference-tracked manually** in Phase 1 (no live API) | ☐ | ______ |
| **Deferred features** | No billing, accounting, BI, per-employee KPIs, or financial portal in Phase 1 | ☐ | ______ |
| **Phase boundaries** | Phase 1 = operational digitalization only; everything else is Phase 2/3 | ☐ | ______ |
| **Data migration** | Clean start (or chosen option) — historical files stay in legacy systems | ☐ | ______ |
| **Single-admin** | Key-person risk on the IT admin (mitigated by break-glass backup) | ☐ | ______ |
| **Adoption** | Success depends on the 65 users adopting the tool; change management funded | ☐ | ______ |

---

# Executive Decision Log / Journal des décisions (direction)

The authoritative record. Development docs are updated to match this log.

| # | Section | Decision (final) | Approved by | Date | Updates which doc | Closes BLK |
|---|---|---|---|---|---|---|
| 1 | Hosting | ______ | ______ | ______ | architecture.md | BLK-9/AR1 |
| 2 | Migration | ______ | ______ | ______ | phase-1-roadmap.md | BLK-8 |
| 3 | Channels | ______ | ______ | ______ | requirements.md | BLK-5 |
| 4 | Identity | ______ | ______ | ______ | rbac-matrix.md | BLK-RB2/AR3 |
| 5 | Capacity | ______ | ______ | ______ | architecture.md | BLK-2 |
| 6 | Commercialization | ______ | ______ | ______ | architecture.md | Q32 |
| 7 | Finance strategy | ______ | ______ | ______ | requirements.md | R1/R3 |
| 8 | Budget/timeline | ______ | ______ | ______ | phase-1-roadmap.md | — |

---

# Architecture Decisions (ADR) / Décisions d'architecture

Capture each binding technical decision in one line (lightweight ADR). These become the constraints development must follow.

| ADR # | Decision | Rationale | Status |
|---|---|---|---|
| ADR-1 | Deployment model = ______ | ______ | ☐ Accepted |
| ADR-2 | Identity = ______ (SSO/MFA) | ______ | ☐ Accepted |
| ADR-3 | Tenancy = ______ | ______ | ☐ Accepted |
| ADR-4 | Integration = reference-tracking until APIs confirmed | derisk GAINDE/Orbus | ☐ Accepted |
| ADR-5 | Finance = keep Sage / replace Maya in Phase 2 | avoid rebuilding accounting | ☐ Accepted |
| ADR-6 | Notification channels = ______ | ______ | ☐ Accepted |

---

# Open Issues / Problèmes ouverts

Each must get an owner and due date before the affected sprint starts (S0 unless noted).

| # | Open issue | Affects (doc / sprint) | Owner | Due date | Status |
|---|---|---|---|---|---|
| 1 | Client (BP/Woodside/Kosmos/Petrosen) data restrictions — written confirmation | hosting / S0 | ______ | ______ | ☐ Open |
| 2 | ______ | ______ | ______ | ______ | ☐ Open |
| 3 | ______ | ______ | ______ | ______ | ☐ Open |
| 4 | ______ | ______ | ______ | ______ | ☐ Open |
| 5 | ______ | ______ | ______ | ______ | ☐ Open |

---

# Final Sign-Off / Validation finale

The parties confirm the decisions recorded above are approved and binding for Phase 1. Changes after sign-off go through the Executive Decision Log with a new dated entry.

| Role | Name | Signature | Date |
|---|---|---|---|
| Project Sponsor (Management) | ______ | ______ | ______ |
| CEO / Direction Générale | ______ | ______ | ______ |
| IT / Development Lead | ______ | ______ | ______ |
| Finance representative | ______ | ______ | ______ |

**Post-workshop action:** the facilitator updates [architecture.md](../architecture.md), [requirements.md](../requirements.md), and [phase-1-roadmap.md](../phase-1-roadmap.md) to match this signed log, records the ADRs, and closes the corresponding `BLK-*` items so Sprint S0 can begin.
