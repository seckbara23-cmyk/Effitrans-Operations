# Effitrans Operations Platform — Database Design (Phase 1)

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

**Engine:** PostgreSQL (via Supabase — see [architecture.md](architecture.md)).
**Tenancy:** every business table carries `tenant_id` from day one; isolation enforced by **Row-Level Security (RLS)**. No SaaS control plane is built — `tenant_id` simply scopes all rows to `organization` row 1 (Effitrans) until/unless commercialization (Phase 3).
**Visibility:** RLS policies enforce both tenant isolation AND role-based file scoping (own/team/client/all) — see [rbac-matrix.md](rbac-matrix.md).

Related: [requirements.md](requirements.md) · [state-machine.md](state-machine.md) · [document-catalog.md](document-catalog.md)

---

## 1. Conventions
- All tables: `id uuid pk`, `tenant_id uuid not null` (FK → organization), `created_at`, `updated_at`.
- Soft-immutability: `audit_log`, `file_state_transition` are append-only (no UPDATE/DELETE policy).
- Money stored as `numeric(18,2)` + `currency` (Phase 1 mostly read-through; full finance is Phase 2).
- Enums implemented as Postgres enum types or `text` + check constraint (config-driven workflow favors `text` + reference table for states).

---

## 2. Entity-relationship overview

```
organization (tenant)
  └─< app_user >── user_role ──> role ──< role_permission ──> permission
  └─< client >── contact
  └─< partner >── contact            (carriers, WCA agents, subcontractors)
  └─< operational_file  ★ THE SPINE
        ├─< file_state_transition        (append-only history)
        ├─< checklist_item
        ├─< document >── document_validity
        │      └─> document_type (catalog)
        ├─1 customs_record
        ├─< transport_leg >── truck / driver / partner
        ├─1 proof_of_delivery >── document
        ├─< task
        ├─< activity_entry
        └─< notification
  └─< audit_log                        (append-only)
  └─ workflow_state / workflow_transition   (config-driven engine definitions)
```

★ = central entity. Everything operational hangs off `operational_file`.

---

## 3. Phase-1 tables

### 3.1 Tenancy & identity
| Table | Key columns | Notes |
|---|---|---|
| `organization` | id, name, country, storage_region | Tenant root. Row 1 = Effitrans |
| `app_user` | id, tenant_id, email, name, status, is_system_admin | Auth identity (Supabase auth linkage) |
| `role` | id, tenant_id, code, label_fr, label_en | 13+ roles (see RBAC) |
| `user_role` | user_id, role_id | M:N; a user may hold several roles |
| `permission` | id, code, module, action, data_scope | C/R/U/D/V × module × scope |
| `role_permission` | role_id, permission_id | M:N |

### 3.2 Parties
| Table | Key columns | Notes |
|---|---|---|
| `client` | id, tenant_id, name, segment, account_manager_id | segment: oil_gas / mining / industrial / other |
| `partner` | id, tenant_id, name, type | carrier / shipping_line / airline / wca_agent / subcontractor |
| `contact` | id, tenant_id, party_type, party_id, name, email, phone | polymorphic to client/partner |

### 3.3 Operational File (spine)
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| tenant_id | uuid | RLS |
| file_number | text unique | e.g. `IMP-2026-00042` (scheme = [BLK-6](requirements.md#7-blocking-questions)) |
| type | text | IMPORT / EXPORT / TRANSPORT / HANDLING |
| client_id | uuid → client | |
| account_manager_id | uuid → app_user | **owner**, enforced until POD |
| coordinator_id | uuid → app_user | nullable |
| transport_mode | text | SEA / AIR / ROAD / MULTIMODAL |
| incoterm | text | |
| origin / destination | text | |
| cargo_type | text | general / project / oil_gas_equipment / … |
| priority | text | normal / high / critical |
| current_state | text → workflow_state.code | drives the state machine |
| quotation_ref | text | nullable (Phase 2 links to quotation entity) |
| opened_at, archived_at | timestamptz | |
| pickup_planned/actual, etd/atd, eta/ata, delivery_planned/actual | timestamptz | planned vs actual |
| archive_locked | bool default false | read-only when true |

### 3.4 Workflow engine (config-driven)
| Table | Key columns | Notes |
|---|---|---|
| `workflow_state` | id, file_type, code, label_fr, label_en, sort_order, owner_role | the state list per file type |
| `workflow_transition` | id, file_type, from_state, to_state, action, allowed_roles[], guards[], side_effects[] | the transition table from [state-machine.md](state-machine.md) |
| `file_state_transition` | id, file_id, from_state, to_state, actor_id, note, occurred_at | **append-only** history |
| `checklist_template` | id, file_type, stage, label_fr, required bool, requires_document_type | defines per-stage items |
| `checklist_item` | id, file_id, template_id, stage, label, required, done bool, done_by, done_at, document_id | per-file instances |

### 3.5 Documents & expiry
| Table | Key columns | Notes |
|---|---|---|
| `document_type` | id, code, label_fr, label_en, category, has_validity, default_validity_days, alert_lead_days, blocks_transition | the catalog ([document-catalog.md](document-catalog.md)) |
| `document` | id, tenant_id, file_id, type_id, storage_key, filename, version, supersedes_id, source, uploaded_by, uploaded_at | source: client/internal/partner; storage_key → object storage |
| `document_validity` | id, document_id, issued_at, expires_at, status | status: VALID/EXPIRING/EXPIRED/RENEWED |

### 3.6 Customs (reference tracking — NOT auto-submission)
| Column (`customs_record`) | Notes |
|---|---|
| id, tenant_id, file_id | 1:1 with file |
| dpi_ref | DPI reference (manual) |
| declaration_ref | GAINDE declaration number (manual; API = [BLK-1](requirements.md#7-blocking-questions)) |
| regime, hs_codes[] | export/import regime, HS codes |
| exoneration_title_refs[] | links to exoneration documents |
| bae_ref, bae_obtained_at | Bon à Enlever |
| orbus_disbursement_ref, disbursement_status | Orbus Infinity payment ref (manual) |
| declarant_id, validated_by_chief_id, validated_at | the Chief validation gate |
| status | drafted / validated / registered / cleared |

### 3.7 Transport & POD
| Table | Key columns | Notes |
|---|---|---|
| `truck` | id, tenant_id, plate, capacity, status | internal fleet |
| `driver` | id, tenant_id, name, license, phone, status | internal |
| `transport_leg` | id, tenant_id, file_id, mode, is_internal, truck_id, driver_id, subcontractor_id, transport_order_ref, pickup_at, delivered_at, sla_target, sla_met | internal vs external |
| `proof_of_delivery` | id, tenant_id, file_id, document_id, consignee_signed_at, validated_by_am bool, validated_at, authenticity_note | 1:1 with file; POD gate source |

### 3.8 Tasks, comms, notifications
| Table | Key columns | Notes |
|---|---|---|
| `task` | id, tenant_id, file_id, title, assignee_id, due_at, status, priority | my-queue source |
| `activity_entry` | id, tenant_id, file_id, user_id, type, body, occurred_at | COMMENT / EVENT / MENTION — replaces WhatsApp |
| `notification` | id, tenant_id, recipient_type, recipient_id, channel, event, file_id, sent_at, status | EMAIL / SMS (WhatsApp Phase 2) |

### 3.9 Audit
| Table | Key columns | Notes |
|---|---|---|
| `audit_log` | id, tenant_id, actor_id, action, entity, entity_id, before jsonb, after jsonb, override_reason, occurred_at | **append-only**; every privileged/state-changing action |

---

## 4. Key integrity constraints
| Constraint | Rule | Where |
|---|---|---|
| POD hard gate | `current_state ∈ {BILLED, ARCHIVED}` ⇒ a `proof_of_delivery` with `validated_by_am = true` exists | transition guard + DB check |
| Archive lock | `archive_locked = true` ⇒ reject all child INSERT/UPDATE/DELETE except logged override | RLS / triggers |
| Owner integrity | `operational_file.account_manager_id` not null for non-DRAFT states | check |
| Chief validation | `customs_record.status = validated` requires `validated_by_chief_id` not null | check |
| Tenant isolation | every query filtered by `tenant_id = current_tenant()` | RLS policy on every table |
| Single document version head | only one `document` per (file, type) with no `supersedes` pointing to it | partial unique / app logic |

---

## 5. RLS policy sketch (Phase 1)
```sql
-- tenant isolation (all tables)
USING (tenant_id = current_setting('app.tenant_id')::uuid)

-- operational_file visibility by role scope
USING (
  tenant_id = current_tenant()
  AND (
    has_role('SYSTEM_ADMIN') OR has_role('CEO') OR has_role('COMPLIANCE')   -- ALL
    OR (has_role('FINANCE') )                                               -- ALL w/ financial relevance
    OR account_manager_id = current_user_id()                              -- OWN
    OR coordinator_id = current_user_id()                                  -- TEAM
    OR client_id IN (assigned_clients(current_user_id()))                  -- CLIENT scope (KAM/CS)
    OR id IN (assigned_files(current_user_id()))                           -- ASSIGNED (declarant/transport)
  )
)
-- client portal users: id IN (files where client_id = current_client())
```

---

## 6. Deferred tables (NOT Phase 1)
| Table | Phase | Reason |
|---|---|---|
| `invoice`, `invoice_line`, `debours` | 2 | Billing replaces Maya in Phase 2 |
| `quotation`, `quotation_line` | 2 | Quotation module Phase 2 |
| `customs_nonconformity`, `customs_dispute` | 3 | Litigation tracking |
| `feedback` (CSAT/NPS) | 3 | Depends on portal maturity |
| `kpi_snapshot`, `budget`, `forecast` | 2/3 | Management control / BI |
| `ledger_*`, `financial_statement_*` | Never | Sage owns accounting |
| `tenant_subscription`, `tenant_onboarding` | 3 | SaaS control plane (only if commercialized) |

---

## 7. Blocking questions
| ID | Question | Blocks |
|---|---|---|
| BLK-6 | File-numbering scheme per type (year/branch/sequence) | `file_number` format |
| BLK-DB1 | Should `app_user` map 1:1 to Supabase Auth users, or is there an existing HR/identity source to sync? | Identity model |
| BLK-DB2 | Do clients and partners ever overlap (a client that's also a subcontractor)? | Party modelling |
| BLK-DB3 | Multi-currency needed in Phase 1 (XOF + USD/EUR for international)? | money columns |
| BLK-DB4 | Retention policy for archived documents/files (legal minimum in Senegal)? | storage lifecycle |
