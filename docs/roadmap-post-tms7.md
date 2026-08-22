# Effitrans — Remaining Roadmap (post-TMS-7 checkpoint)

**Date:** 2026-08-21 · **Documentation only — nothing implemented.**
Supersedes `docs/roadmap.md` (a pre-database UI-maquette relic) as the statement of
remaining work. Evidence: repository at `d727f5e`, the decision register, phase
memories, and the production state verified during TMS-7 (flags, migrations 1–120,
UAT dossiers).

Standing constraints honoured throughout: the ratified **Operations Manager ↔
Account Manager** workflow (designation is an audited act — dossier creation never
makes anyone the Account Manager; proven again in the UAT-11b prerequisite audit);
**Finance/Aging Balance are NEW Effitrans capabilities**, built from Effitrans' own
aging workbook, not MAYA parity.

---

## 1. DONE — complete and production-validated

| Capability | Evidence |
| --- | --- |
| **Digital LOS core** — dossier lifecycle, designation (« Responsable client »), documents with governed verification (verifier seats, maker-checker), required-docs gates | TMS-7 UAT-09/10/15; RQ-15b ratified |
| **Official 26-step process engine** — intake, ownership, blockers, handoffs, queues, journeys; CEO chain incl. post-BAD (P1.9/P1.10) | live in prod (UAT-15 intake); registry 21 ratified |
| **Customs chain** — receivability (QC3), CT validation (PG-1), GAINDE registration, ORBUS/GAINDE attachment, BAE + release, document gates | TMS-7 UAT-15 both interlock branches; MAYA-P0.7/0.8/1.1 |
| **Transport** — department realignment (5B/5C), fleet Parc & Flotte incl. controlled deletion both branches, subcontractors with carrier-identity snapshot, request/create lanes, customs↔pickup interlock, POD-drives-terminal-state | TMS-7 24/24 PASS |
| **Quotation optional (QO-1)** — « Sans devis » explicit | UAT-09 |
| **Shipment geography (TMS-2)** + manual tracking honesty (TMS-3) | UAT-22; TRACKING_ENABLED live |
| **Generated artifacts** — ORDRE DE TRANSPORT / DEMANDE, branch-aware readiness (RQ-18), « Mode de l'expédition » (RQ-18b), frozen issue date, byte-deterministic renderer, immutable versions | migration 120 verified in prod |
| **HR 1–8, 10** — registry, master data, mass registration, leave, performance identity, payroll facts-only, offboarding (production-validated), guide | HR-8 prod-validated; HR-10 closed |
| **Brand Center** | production-validated (149ddb9) |
| **Roles/RBAC** — 24+ roles, granular perms, canonical departments (incl. TRANSPORT), org registry | TMS-5C; UAT-21 read-only proof |
| **Phase-0 ICTD/ICAM/IPAM parity** | frozen `8161333`; packet `d727f5e` |

## 2. UAT REQUIRED — built, flag-ready, never (or partially) production-validated

| # | Capability | State & dependency |
| --- | --- | --- |
| U1 | **Physical invoice deposit / courier custody chain** (`/deposits`, `/courier`) | **Proven NEVER executed in production** (0 deposits, 0 events, 0 POD docs — verified 2026-08-21 during the canonicalization work). Tenant flag ON. Needs: env-flag baseline check + a COURIER demo account (established pattern) |
| U2 | **Expense authorization → visa → voucher chain** (`/finance/autorisations-depenses`) | Built (11.0B–D), hash-chained visas; no accumulated production UAT |
| U3 | **Collections** (`/collections`) | Tenant flag ON; no production UAT |
| U4 | **Aging Balance** (`/finance/aging`) — NEW capability | Engine+schema+workspace built (migrations 72+); flag-gated tile; no production UAT |
| U5 | **Reconciliation** (`/finance/reconciliation`) | Built (WES-5), mutation-tested; no E2E production UAT. ⚠ **Caisse reclassified 2026-08-22:** route/nav/permission live but the page is a declared STUB (« Fonctionnalité à venir », 9.3A foundation only) — moved to BUILD REQUIRED (B6) |
| U6 | **HR-9 Reporting RH** | Code shipped; HR-9D operator UAT pending (migration 114 believed applied with the 115–119 batch — verify at phase start) |
| U7 | **Enterprise Mail** (EMP-1..5H.1) | Built through activation-readiness; needs the operator activation session (mailbox lifecycle, 2 MAIL_ADMIN holders exist) + DNS caveats (six SPF records ⚠) |
| U8 | **Messaging Center / customer portal surfaces** | Long-built; only incidental UAT coverage |
| U9 | **Process-engine transit/finance EXECUTION lanes** | Env-gated (`TRANSIT_EXECUTION`, `FINANCE_EXECUTION`); prod env values unverified; needs flag baseline then E2E walk |

## 3. BUILD REQUIRED — ratified intent, code incomplete

| # | Item | Blocker/dependency |
| --- | --- | --- |
| B1 | **Step-specific verifier seats** via workflow-policy ACTIVATION (RQ-15b target — the current `document:approve` fallback is ratified as compatibility only) | needs Effitrans's seat map per step → then activation tooling exercise; small build |
| B2 | **Driver mobile increments 3.4C-3/4** (delay/incident/photo/POD; dispatcher live console) | 3.4C-1/2 built dark; pilot **blocked on privacy review** (DEC-B28) |
| B3 | **Holiday calendar reference data** (needed by ICTD délais AND any jours-ouvrés SLA) | Decision D3 first; then a small HR reference table |
| B4 | **MAYA historical-data apply path** — staging exists (migration 101) with NO apply path *by construction* | business decision to import + mapping ratification |
| B5 | **Multi-leg road modelling** (pre-carriage + on-carriage same dossier) — `UNIQUE(file_id)` today | recorded debt; needs business need first |
| B7 | **Official steps 18/19 — the two completeness checkpoints** (`coordinator_completeness`, `am_completeness`). Declared in the registry with required evidence, but **nothing writes that evidence and no UI submits the steps**, so `evaluateBillingGate` can never open and the governed billing lane cannot create an invoice. Blocks all of FIN-1 | discovered 2026-08-22 during FIN-1-01 preflight; needs ratification of the two review surfaces before build |
| B6 | **Caisse operations UI** — 9.3A shipped nav + `caisse:manage` + stub page; the cash/cheque/Mobile Money operations themselves are unbuilt | scope on demand; FIN-UAT validates reconciliation independently |

## 4. WAITING ON BUSINESS — no executable work until answered

| # | Item | Who |
| --- | --- | --- |
| W1 | **ICTD/ICAM/IPAM D1–D4** (decision packet `d727f5e`) — DPE, status precedence, holiday calendar, five customs facts' capture circuit | F.T. / Direction |
| W2 | The **6 open business questions** from the CEO-chain closure (P1.9/P1.10) + **conflict ownership** (P1.7/P1.8 tower stopped on it) | Direction |
| W3 | **Verifier-seat map per step** (feeds B1) | Direction/Qualité |
| W4 | **Driver-tracking privacy review** (feeds B2) | Direction/legal |
| W5 | **Sage 100 boundary** — P6 ratified as « accounting = Sage », but the MAYA→Sage mechanism is UNKNOWN (SAGE-0); export design needs Effitrans's accountant input | Finance |
| W6 | **MAYA history import** go/no-go + scope (feeds B4); PCS container remains encrypted (Q125) | Direction |
| W7 | Deposit-proof verifier-seat governance (deferred Decision 2) · deposit legacy-write follow-ups already closed | Direction |

## 5. FUTURE DEBT — recorded, non-blocking

Phase 1.8 document-status fossil (legacy type + dead machine, zero live callers) ·
`UNIQUE(file_id)` multi-leg (=B5) · customs-panel UX niceties beyond the shipped
scoped errors · legacy performance workbook kept as frozen history (never recomputed
silently — Q12) · old `docs/roadmap.md` métiers never digitized (warehousing,
handling, consolidation, ship agency, moving) — **not** MAYA parity, new métiers to
scope only on demand.

## MAYA disposition (asked explicitly)

* **Used by Effitrans & converged:** dossier registry incl. DOSSIERMERE parenthood,
  cargo/refs (migration 100), customs facts — the platform is now the source of
  truth (Digital LOS ratified).
* **Used & still missing:** nothing functional — the two remaining MAYA items are
  **history import** (B4/W6) and the **Sage export boundary** (W5).
* **Superseded, NOT parity:** process engine (MAYA has no workflow engine — Q125
  forensics), document governance, tracking, mail, portal, HR, Finance/Aging —
  all new Effitrans capabilities.

---

## Recommended next executable phase — exactly one

### **FIN-UAT — Finance End-to-End Production UAT** (U1+U2+U3+U4+U5 as one accumulated runbook)

**Why this one:**

1. **It is the largest built-but-never-validated surface left.** The deposit chain
   was *proven* to have zero production executions; expense, collections, caisse
   and aging have likewise never had an accumulated production UAT. Everything else
   on the list is either smaller (U6), operationally gated on external actors
   (U7 DNS/mailboxes), or **waiting on business** (every item in §4).
2. **Zero business decisions required.** Tenant flags are already ON; the only
   prerequisites are the TMS-7-proven setup patterns (env-flag baseline check,
   clearly-marked UAT records, one COURIER demo account).
3. **The regression nets are freshest exactly here.** The deposit canonicalization,
   status-vocabulary normalization and expense-chain pins were all hardened this
   week — production validation now closes the loop while that work is current.
4. **It de-risks W5.** Finance flows validated end-to-end are the precondition for
   any future Sage boundary design; walking them will surface the export
   requirements Effitrans's accountant must answer.
5. **The pattern is proven.** TMS-7's runbook discipline (Category A/B/C, operator
   evidence, defects fixed with mutation coverage before re-run) transfers
   directly; and if history repeats, the UAT will surface reachability defects no
   suite can see.

**Explicitly out of FIN-UAT scope:** ICTD/ICAM/IPAM implementation (ON HOLD per
instruction), Sage export (W5), verifier-seat activation (B1/W3), anything in §4.

*Suggested sequence after FIN-UAT, for planning only:* U6 (HR-9D, one operator
session) → U7 (mail activation) → B1 once W3 answers → then whichever of W-items
has unblocked.
