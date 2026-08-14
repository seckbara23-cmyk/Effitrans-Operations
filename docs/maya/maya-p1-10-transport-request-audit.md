# MAYA-P1.10 — `transport:request`: audit

**Date:** 2026-08-14 · **Baseline:** `6e24cc5` (P1.9) · **Ledger:** 105/105 · **No migration.**

**Primary classification: F — stale / unanchored permission.** Secondary **E**
(whether a distinct request act should exist is a business question).

**Nothing built, and nothing deleted.** This is not the `customs:register`
pattern, and the difference is precise enough to state.

---

## 1. Why it looked like `customs:register` — and why it is not

P1.1 fixed a permission that was catalogued, granted, and unconsumed. So is this
one. The difference is what the act was **anchored to**:

| | `customs:register` (P1.1) | `transport:request` (here) |
|---|---|---|
| Declared by a registry step | ✅ step 9, `permissions: ["customs:register"]` | ❌ **no step declares it** |
| Named owner | ✅ `CUSTOMS_FINANCE_OFFICER` | ❌ none |
| Required evidence | ✅ reference, date, registered_by | ❌ none |
| Workflow blocked without it | ✅ Finance could not act at all | ❌ **nothing is blocked** |

`customs:register` named an act the registry assigned to a role with evidence it
spelled out. `transport:request` names an act **no step assigns to anyone**.

## 2. What the AM actually does at step 3 — both sources agree

Registry step 3 `am_dossier_opening`:

* `role: ACCOUNT_MANAGER`
* `permissions: ["file:create", "file:update", "document:create"]` — **not** `transport:request`
* `requiredDocuments: ["TRANSPORT_REQUEST", "BORDEREAU_LIVRAISON", "VENDOR_INVOICE", "SPENDING_AUTHORIZATION"]`

`effitrans-business-workflow.md` §2 step 3:

> Open and prepare the dossier: **collect transport request**, delivery slip,
> vendor invoice, spending authorization

and §Account Manager: *"**Documents received:** transport request, vendor
invoice, spending authorization, delivery slip."*

**The transport request at step 3 is an inbound document the AM COLLECTS**, under
`document:create` — which the Account Manager holds. The duty is met and the
workflow functions. Nothing is blocked.

## 3. The permission census

| Probe | Result |
|---|---|
| Defined | `20260713000001_process_engine.sql:352` — *"Raise a transport request for a dossier"* |
| Granted (3 sources) | SYSTEM_ADMIN, **ACCOUNT_MANAGER**, TRANSPORT_OFFICER, OPS_SUPERVISOR |
| Declared by a registry step | **none** |
| Server action / RPC / service | **none** |
| UI check | **none** |
| Handoff / queue / Control Tower | **none** |
| Only textual hit | `lib/process/roles.ts` `MISSING_PERMISSIONS` — **another frozen 5.0A snapshot**, still listing permissions that have since shipped |

**Zero consumers, confirmed structurally.**

## 4. Request vs assign — the distinction is real in the artifacts

The platform generates two transport artifacts, and their own field lists
separate them cleanly:

| | `DEMANDE_TRANSPORT` | `TRANSPORT_ORDER` |
|---|---|---|
| Title | DEMANDE DE TRANSPORT | ORDRE DE TRANSPORT |
| Ends with | **`requestedBy`, `requestedAt`** | `driverName`, `vehiclePlate`, `transportCompany` |
| Mandatory | dossier, client, locations, planned pickup | …**plus driver and plate** — *"An order without a driver and a vehicle is not an order"* |

So *request* precedes any vehicle; *order* cannot exist without one. That is a
genuine distinction — **but both are produced by `generateArtifact`, gated on
`transport:manage`**, whose holders are SYSTEM_ADMIN, COORDINATOR,
TRANSPORT_OFFICER, OPS_SUPERVISOR — **the people who assign**.

WES-4G chose that gate deliberately and said why: *"The narrowest EXISTING
authority that fits is `transport:manage`: both artifacts describe the transport
leg and are produced by whoever plans it."*

**Consequence, recorded but not acted on:** the Account Manager — who holds the
permission literally named *"Raise a transport request"* — cannot produce a
Demande de transport, and cannot upload one either (generatable artifacts refuse
manual upload). Whether that is wrong depends entirely on §6's question.

## 5. Two active document types share one French label

Production carries three transport types, **two identically labelled**:

| Code | Label FR | Kind | Documents ever |
|---|---|---|---|
| `TRANSPORT_REQUEST` | **Demande de transport** | uploadable (5.0D) | **0** |
| `DEMANDE_TRANSPORT` | **Demande de transport** | generated (WES-4G) | 1 |
| `TRANSPORT_ORDER` | Ordre de transport | generated | 1 |

WES-4G's rationale states *"`DEMANDE_TRANSPORT` is NEW. The audit found no
document type, no request record and no code path for it anywhere"* — but
`TRANSPORT_REQUEST` had existed since `20260714000001`, a fortnight earlier.

`TRANSPORT_REQUEST` is a **required document of step 3** and has never been used
once, while an identically-named generated type has. An operator cannot tell them
apart by label. **Reported, not fixed** — `document_type` is the global
cross-tenant catalog (P0.8-C), and renaming or retiring a type is its own
decision.

## 6. The question that would unblock this

**Does Effitrans want a distinct « demande de transport » act raised by the
Account Manager — or is « coordinate with Transport » simply coordination, with
the request arriving as a client document the AM files?**

* If **coordination only** → `transport:request` is dead vocabulary. Deprecate it
  deliberately, and consider retiring the unused `TRANSPORT_REQUEST` type.
* If **a real act** → the smallest fix is per-artifact authority in
  `generateArtifact`: `DEMANDE_TRANSPORT` under `transport:request`,
  `TRANSPORT_ORDER` under `transport:manage`. No migration, no new object, no new
  UI beyond the existing artifact panel. That is a **class B** slice, ready to
  build the moment the answer is yes.

## 7. Not removed

§O is explicit and correct: an unused permission is not casually deleted. It is
granted in three sources, referenced by a historical audit list, and removal is a
deprecation decision with its own blast radius. **Classified stale; left in
place.**

## 8. Recommendation

Build nothing. Put §6 to Effitrans alongside the five questions already
outstanding (rattachement, « sortie du port », signed-BL evidence, vehicle
conformity, conflict ownership).

With P1.10 the CEO chain has been reconciled end to end. **Every remaining item
in the programme is a business question, not an engineering gap.**
