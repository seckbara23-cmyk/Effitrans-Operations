# Effitrans Operations Platform — Workflow State Machine (Phase 1)

> **Governance Notice**
>
> This document is derived from decisions recorded in [`docs/decision-register.md`](decision-register.md).
>
> The Decision Register is the **authoritative source** for all business, architecture, security, workflow, hosting, integration, and platform decisions.
>
> Contributors must **not** change assumptions or requirements directly in this document without first updating the corresponding decision entry in the Decision Register.
>
> If a decision changes: (1) update or supersede the decision in the Decision Register, (2) record the date and owner, (3) update all affected downstream documents.
>
> **In case of conflict between documents, the Decision Register takes precedence.**

The Operational File is driven by a **config-driven state machine**. Each file type (IMPORT, EXPORT, TRANSPORT, HANDLING) has an ordered set of **states**; movement between states happens only through **transitions**, each of which is gated by an **allowed role**, optionally guarded by **conditions** (checklist complete, document present, POD validated), and may fire **side effects** (notifications, timestamps, locks).

Related: [requirements.md](requirements.md) · [document-catalog.md](document-catalog.md) · [rbac-matrix.md](rbac-matrix.md) · [database-design.md](database-design.md)

---

## 1. Engine model

A transition is the tuple:

```
(from_state) --[action]--> (to_state)
   allowed_roles: [...]          # who may trigger it
   guards: [...]                 # must all be TRUE or transition is rejected
   side_effects: [...]           # run on success (notify, stamp, lock)
```

**Rules enforced by the engine (not by trust):**
1. A transition not defined for the current state is rejected.
2. A user whose role is not in `allowed_roles` is rejected — and the attempt is written to the audit log.
3. If any guard is false, the transition is rejected with the failing guard named.
4. Every successful transition writes a `FileStateTransition` row (from, to, actor, timestamp, note).
5. Terminal state `ARCHIVED` is read-only; further writes require a logged override.

### Guard types (Phase 1)
| Guard | Meaning |
|---|---|
| `CHECKLIST_COMPLETE(stage)` | All `required` checklist items for the stage are done |
| `DOC_PRESENT(type)` | A document of the given catalog type is attached |
| `DOC_NOT_EXPIRED(type)` | The attached document of that type is not expired |
| `CHIEF_VALIDATED` | Chief of Transit has validated the customs declaration |
| `POD_VALIDATED` | An Account-Manager-validated POD exists |
| `NO_BLOCKING_EXPIRY` | No required document for the file is expired |

### Side-effect types (Phase 1)
`NOTIFY(audience, channel)` · `STAMP(date_field)` · `LOCK_FILE` · `OPEN_BILLING` (Phase 2 hook, no-op in Phase 1).

---

## 2. IMPORT file state machine

| # | State | Owner role | Meaning |
|---|---|---|---|
| 1 | `DRAFT` | Account Manager | File being created |
| 2 | `OPENED` | Account Manager | File officially opened, client interface active |
| 3 | `COORDINATION` | Coordinator | Dispatched for internal execution |
| 4 | `TRANSIT_PREP` | Chief of Transit | Declarant assigned, preparing DPI/note de détail |
| 5 | `DECLARATION_DRAFT` | Customs Declarant | Declaration drafted in GAINDE (ref captured) |
| 6 | `DECLARATION_VALIDATED` | Chief of Transit | Customs compliance validated ⛔ gate |
| 7 | `FINANCE_REGISTERED` | Finance Officer | Declaration registered, costs allocated |
| 8 | `CLEARANCE_IN_PROGRESS` | Transit Agent | Customs circuit, disbursements (Orbus ref) |
| 9 | `CLEARED` | Transit Agent | BAE obtained ⛔ gate |
| 10 | `IN_TRANSPORT` | Transport Officer | Pickup/handling/delivery underway |
| 11 | `DELIVERED` | Transport Officer | Goods delivered, POD being collected |
| 12 | `POD_VALIDATED` | Account Manager | POD collected & validated ⛔ HARD gate |
| 13 | `BILLED` | Finance (Phase 2) | Invoice issued & AM-validated *(Phase 1: auto-pass placeholder)* |
| 14 | `ARCHIVED` | System | File locked, read-only |

### Import transitions
| From → To | Action | Allowed roles | Guards | Side effects |
|---|---|---|---|---|
| DRAFT → OPENED | open_file | Account Manager | `CHECKLIST_COMPLETE(opening)` | STAMP(opened_at), NOTIFY(coordinator, email) |
| OPENED → COORDINATION | dispatch | Account Manager, Coordinator | — | NOTIFY(coordinator) |
| COORDINATION → TRANSIT_PREP | assign_declarant | Coordinator, Chief of Transit | — | NOTIFY(declarant) |
| TRANSIT_PREP → DECLARATION_DRAFT | submit_declaration | Customs Declarant | `DOC_PRESENT(commercial_invoice)`, `DOC_PRESENT(packing_list)`, `DOC_NOT_EXPIRED(exoneration_title)` | STAMP(declaration_drafted_at) |
| DECLARATION_DRAFT → DECLARATION_VALIDATED | validate_declaration | **Chief of Transit only** | `CHECKLIST_COMPLETE(customs)`, `NO_BLOCKING_EXPIRY` | NOTIFY(finance) |
| DECLARATION_DRAFT → TRANSIT_PREP | reject_declaration | Chief of Transit | — | NOTIFY(declarant) |
| DECLARATION_VALIDATED → FINANCE_REGISTERED | register_declaration | Finance Officer | — | STAMP(finance_registered_at) |
| FINANCE_REGISTERED → CLEARANCE_IN_PROGRESS | release_to_agents | Coordinator | — | NOTIFY(transit_agent) |
| CLEARANCE_IN_PROGRESS → CLEARED | record_bae | Transit Agent | `DOC_PRESENT(bae)` | STAMP(bae_obtained_at), NOTIFY(account_manager, transport_officer) |
| CLEARED → IN_TRANSPORT | start_transport | Transport Officer, Coordinator | — | STAMP(pickup_actual) |
| IN_TRANSPORT → DELIVERED | mark_delivered | Transport Officer | — | STAMP(delivery_actual) |
| DELIVERED → POD_VALIDATED | validate_pod | **Account Manager only** | `DOC_PRESENT(pod)` | STAMP(pod_validated_at), OPEN_BILLING |
| POD_VALIDATED → BILLED | issue_invoice | Finance (P2) / System (P1 auto) | — | — |
| BILLED → ARCHIVED | archive | Account Manager, System | `POD_VALIDATED` | LOCK_FILE |
| any → ARCHIVED | force_archive (override) | System Admin, CEO | logged override only | LOCK_FILE, audit override |

---

## 3. EXPORT file state machine

Mirrors the Q6 consolidated export model. Differs from import in the booking/transport-orchestration phase up front and the destination-delivery emphasis.

| # | State | Owner | Meaning |
|---|---|---|---|
| 1 | `DRAFT` | Account Manager | File being created |
| 2 | `FILE_CREATED` | Account Manager | Incoterms, mode, priority set |
| 3 | `BOOKING` | Account Manager | Sea: vessel/SI/ETD · Air: space/AWB · + transport strategy |
| 4 | `COORDINATION_READY` | Coordinator | Booking confirmed, transport assigned, docs initiated |
| 5 | `TRANSIT_PREP` | Chief of Transit | HS codes / export regime / feasibility |
| 6 | `DECLARATION_DRAFT` | Customs Declarant | Note de détail + GAINDE export declaration |
| 7 | `DECLARATION_VALIDATED` | Chief of Transit | ⛔ gate |
| 8 | `FINANCE_REGISTERED` | Finance | Cost allocation, billing linkage |
| 9 | `CLEARANCE_IN_PROGRESS` | Transit Agent | Customs circuit |
| 10 | `CLEARED` | Transit Agent | BAE/equivalent ⛔ gate |
| 11 | `MULTIMODAL_EXECUTION` | Transport Officer | Road → port/airport handling → carrier loading |
| 12 | `DEPARTED` | Transport Officer | Vessel/flight departed |
| 13 | `DESTINATION_DELIVERY` | Account Manager | AM extended responsibility to consignee |
| 14 | `POD_VALIDATED` | Account Manager | ⛔ HARD gate |
| 15 | `BILLED` | Finance (P2) | — |
| 16 | `ARCHIVED` | System | Locked |

### Export transitions (deltas vs import)
| From → To | Action | Allowed roles | Guards | Side effects |
|---|---|---|---|---|
| DRAFT → FILE_CREATED | create_file | Account Manager | `CHECKLIST_COMPLETE(opening)` | STAMP(opened_at) |
| FILE_CREATED → BOOKING | start_booking | Account Manager | — | — |
| BOOKING → COORDINATION_READY | confirm_readiness | Account Manager, Coordinator | `CHECKLIST_COMPLETE(booking)` | NOTIFY(coordinator) |
| COORDINATION_READY → TRANSIT_PREP | to_transit | Coordinator, Chief of Transit | — | NOTIFY(chief_of_transit) |
| … (TRANSIT_PREP → … → CLEARED identical pattern to import) … |
| CLEARED → MULTIMODAL_EXECUTION | execute_transport | Transport Officer | — | STAMP(pickup_actual) |
| MULTIMODAL_EXECUTION → DEPARTED | mark_departed | Transport Officer | — | STAMP(actual_departure), NOTIFY(account_manager) |
| DEPARTED → DESTINATION_DELIVERY | track_destination | Account Manager | — | — |
| DESTINATION_DELIVERY → POD_VALIDATED | validate_pod | **Account Manager only** | `DOC_PRESENT(pod)` | STAMP(pod_validated_at), OPEN_BILLING |
| (BILLED, ARCHIVED identical to import) |

---

## 4. TRANSPORT file state machine (standalone road operations)

For pure transport/handling jobs not tied to a customs clearance (e.g. corridor haulage, post-clearance delivery).

| # | State | Owner | Meaning |
|---|---|---|---|
| 1 | `DRAFT` | Account Manager / Coordinator | Job being created |
| 2 | `PLANNED` | Coordinator | Route + resource decided |
| 3 | `ASSIGNED` | Transport Officer | Internal truck+driver OR external subcontractor order issued |
| 4 | `IN_TRANSIT` | Transport Officer | Pickup done, en route |
| 5 | `DELIVERED` | Transport Officer | Delivered, POD collection underway |
| 6 | `POD_VALIDATED` | Account Manager | ⛔ HARD gate |
| 7 | `BILLED` | Finance (P2) | — |
| 8 | `ARCHIVED` | System | Locked |

### Transport transitions
| From → To | Action | Allowed roles | Guards | Side effects |
|---|---|---|---|---|
| DRAFT → PLANNED | plan_job | Coordinator | `CHECKLIST_COMPLETE(opening)` | — |
| PLANNED → ASSIGNED | assign_transport | Transport Officer | `INTERNAL`: truck+driver set · `EXTERNAL`: `DOC_PRESENT(transport_order)` | NOTIFY(driver/partner) |
| ASSIGNED → IN_TRANSIT | start_transit | Transport Officer | — | STAMP(pickup_actual) |
| IN_TRANSIT → DELIVERED | mark_delivered | Transport Officer | — | STAMP(delivery_actual) |
| DELIVERED → POD_VALIDATED | validate_pod | **Account Manager only** | `DOC_PRESENT(pod)` | STAMP(pod_validated_at) |
| POD_VALIDATED → BILLED → ARCHIVED | (as import) |

---

## 5. HANDLING file state machine (minimal, Phase 1)

Handling appears in Effitrans's core four (Q33). Phase 1 keeps it lightweight — a job linked to a parent shipment file or standalone.

| State | Owner | Notes |
|---|---|---|
| `DRAFT` → `ORDERED` → `IN_PROGRESS` → `COMPLETED` → `POD_VALIDATED` → `ARCHIVED` | Coordinator / Transport / AM | Handling order, execution, completion proof, AM validation, lock |

> Handling detail (teams, equipment, empotage/dépotage) is a **Phase 3** module per [roadmap.md](roadmap.md); Phase 1 only tracks the job through the lifecycle and attaches its proof.

---

## 6. Cross-cutting gates (the non-negotiables)

| Gate | States it protects | Rule |
|---|---|---|
| **Chief-of-Transit validation** | `DECLARATION_DRAFT → DECLARATION_VALIDATED` | Only Chief of Transit; declaration cannot reach finance/clearance otherwise |
| **POD hard gate** | `* → BILLED`, `* → ARCHIVED` | Requires `POD_VALIDATED` by the Account Manager — universal across all file types |
| **Checklist gate** | Every stage with required items | `CHECKLIST_COMPLETE(stage)` must hold |
| **Expiry gate** | Customs/clearance transitions | `NO_BLOCKING_EXPIRY` / `DOC_NOT_EXPIRED(type)` |
| **Archive lock** | `ARCHIVED` | Read-only; override logged with reason |

---

## 7. Blocking questions
| ID | Question |
|---|---|
| BLK-SM1 | Confirm the **exact** import & export stage list — is the above the real operational sequence, or are stages merged/added in practice? ([requirements BLK-6](requirements.md#7-blocking-questions)) |
| BLK-SM2 | Which checklist items are **mandatory** (block progression) vs advisory, per stage? |
| BLK-SM3 | POD validation criteria (BLK-10): what does "validate authenticity" require in the system? |
| BLK-SM4 | Are there legitimate **backward** transitions (rework) beyond declaration rejection? e.g. cleared → re-clearance? |
| BLK-SM5 | For HANDLING — is it always a child of a shipment file, or can it be standalone billed work? |
