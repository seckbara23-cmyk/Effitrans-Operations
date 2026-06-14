# BLK-3 — Documents Governance Decision Sheet (Phase 1.8 prep)

> **Governance Notice**
>
> This sheet drives **BLK-3 / DEC-B03** in [`docs/decision-register.md`](../decision-register.md)
> from `Open` → `Approved`. The Decision Register is the authoritative source; once
> the **Decisions to confirm** table below is signed off, record the outcomes there
> (new dated rows / status change), then propagate to [`document-catalog.md`](../document-catalog.md)
> and build the module.
>
> **Planning only — no code, no migration.** Reuses the live Phase 1.7 visibility
> model and the established RLS + append-only-audit discipline. Customs / Finance /
> Transport / client portal are **out of scope**.

**Owners:** Chief of Transit (catalog + validity + approval authority) · Management/IT (storage, retention, permissions).
**Inputs:** [document-catalog.md](../document-catalog.md) (richer target catalog) · [rbac-matrix.md](../rbac-matrix.md) · Phase 1.7 visibility (`can_read_file`).
**Status:** DRAFT for confirmation.

---

## 0. Scope reconciliation (read first)

The existing [document-catalog.md](../document-catalog.md) already defines a **fuller** catalog (APE, DPI, exonération titles, sommiers, CMR, booking, etc.) — the long-term target and the heart of the expiry engine. **This sheet scopes the Documents MVP module** to a smaller, editable starter set and explicitly defers the customs-specific expiry-bearing types to the Customs module. The `document_type` table ships **editable**, so the catalog grows without code changes as BLK-3 confirms values.

---

## 1. Recommended MVP catalog

Stable `code`s reuse existing catalog keys where they already exist (✓) so the two stay consistent.

| `code` | Label (FR) | Category | Exists in catalog | `has_validity` (default) |
|---|---|---|---|---|
| `BILL_OF_LADING` | Connaissement (BL) | transport | ✓ | No |
| `AIRWAY_BILL` | Lettre de transport aérien (LTA/AWB) | transport | ✓ | No |
| `COMMERCIAL_INVOICE` | Facture commerciale | commercial | new | No |
| `PACKING_LIST` | Liste de colisage | transport | ✓ | No |
| `CERTIFICATE_OF_ORIGIN` | Certificat d'origine | compliance | new | **Yes** (date on doc) |
| `CUSTOMS_DECLARATION` | Déclaration en douane | customs | new (generic) | No |
| `DELIVERY_NOTE` | Bon de livraison / POD | operational | ✓ | No |
| `TRANSPORT_ORDER` | Ordre de transport | transport | ✓ | No |
| `PAYMENT_RECEIPT` | Reçu de paiement | financial | new | No |
| `OTHER` | Autre document | operational | new | No |

**Recommendation:** ship these 10 as the seed of an **editable** `document_type` table (`code`, `label_fr`, `label_en`, `category`, `has_validity`, `default_validity_days`, `renewable`, `active`). The catalog is data, not code — additions (incl. the deferred customs/expiry types) are table rows, not migrations.

---

## 2. Required-documents matrix by dossier type

**R** = required · **C** = conditional · **O** = optional · **—** = n/a. "Required" in MVP = **warn-only flag** on the dossier (does *not* block transitions) — see Decision D3.

| Document | IMP | EXP | TRP | HND |
|---|:--:|:--:|:--:|:--:|
| Bill of Lading (BL) | C¹ | C¹ | C² | — |
| Air Waybill (AWB) | C¹ | C¹ | — | — |
| Commercial Invoice | R | R | O | — |
| Packing List | R | R | O | R |
| Certificate of Origin | C³ | C³ | — | — |
| Customs Declaration | R | R | — | — |
| Delivery Note / POD | R⁴ | O | R | R |
| Transport Order | O | O | R | O |
| Payment Receipt | O | O | O | O |

¹ BL **or** AWB depending on `shipment.transport_mode` (SEA→BL, AIR→AWB). · ² for the linked-shipment leg. · ³ when origin rules / trade agreement apply. · ⁴ at delivery stage.

**Recommendation:** store `required_for` on the `document_type` row (array of dossier types) + a `conditional` note; the dossier "missing documents" indicator is **derived** at read-time (like Phase 1.6 overdue) — no scheduler. Final R/C/O cells are **Decision D2** (Chief of Transit).

---

## 3. Document status workflow

```
UPLOADED ──submit──▶ PENDING_REVIEW ──approve──▶ APPROVED
   ▲                      │                          │
   │                      └──reject──▶ REJECTED      │ (validity date passes)
   └──re-upload (new version)──┘                     ▼
                                                  EXPIRED ──renew (new version)──▶ UPLOADED
```

- States: `UPLOADED`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`, `EXPIRED`.
- Implemented as a **pure TS state machine** (unit-tested), mirroring the task/file pattern.
- **EXPIRED is DERIVED for the MVP** (computed when `expiry_date < today` on an APPROVED doc) — consistent with Phase 1.6 derived "overdue", **no scheduler**. A stored EXPIRED flip + `document.expired` audit + reminders arrive with the deferred scheduler.
- Re-upload after REJECTED/EXPIRED creates a **new version row** (supersedes; history kept) — see Decision D5.

---

## 4. Expiry rules

Per `document_type`:

| Mode | Meaning | MVP behavior |
|---|---|---|
| **no_expiry** | `has_validity = false` | no expiry field shown |
| **expiry_required** | date captured per document instance | `expiry_date` mandatory on upload |
| **expires_after_days** | `default_validity_days` from the type | `expiry_date` defaulted = upload + N (editable) |
| **renewable** | `renewable = true` flag | informational in MVP; renewal = new version |

MVP captures a single optional/required `expiry_date` per document (driven by the type's `has_validity`). Validity **values** (which types, default days, block-vs-warn) are **Decision D2** — placeholders only until Chief of Transit confirms.

---

## 5. Upload / view / approve / delete rules

All gated by **dossier visibility first** (Phase 1.7 `can_read_file` on the document's `file_id`) **then** the document permission. You can only touch documents on dossiers you can already see.

| Action | Permission | Roles (recommended) |
|---|---|---|
| Upload | `document:create` | SYSTEM_ADMIN, ACCOUNT_MANAGER, OPS_SUPERVISOR, COORDINATOR, DOCUMENTATION_OFFICER, + execution roles (on their visible dossiers) |
| View / download | `document:read` | everyone who can read the dossier + holds `document:read` |
| Approve / reject | `document:approve` | SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER, **CHIEF_OF_TRANSIT** (documentation authority), COMPLIANCE_HSSE |
| Edit metadata | `document:update` | uploader + the approve roles |
| Delete (soft) | `document:delete` | SYSTEM_ADMIN, OPS_SUPERVISOR |
| **Client portal upload/view** | (deferred) | CLIENT_USER — **DEFERRED**, not in MVP |

Visibility tier: documents follow the dossier — **no separate `document:read:all`**; reuse `can_read_file`. Managers' tenant-wide dossier visibility automatically extends to documents.

---

## 6. Supabase Storage recommendation

- **Private bucket** `documents` (not public). **No public URLs, ever.**
- **Path pattern:** `{tenant_id}/{file_id}/{document_id}.{ext}` — uses immutable UUIDs (not `file_number`, which is display text) for stable, collision-free, tenant-partitioned paths.
- **Access is server-mediated, never direct:**
  - **Upload** → server action checks `document:create` + `can_read_file(file_id)`, then writes via the service-role client.
  - **Download** → server action checks `document:read` + `can_read_file(file_id)`, then returns a **short-TTL signed URL** (e.g. 60 s) via service role.
- **Storage RLS = deny-by-default** for `authenticated` on `storage.objects` (no direct client read/write). The server action + service role is the only path → the app's permission + visibility checks are the single boundary, consistent with the existing admin-client read pattern.
- **No `document.url` column** — only the storage path is stored; URLs are minted on demand and expire.
- Constraints to confirm: **max file size**, **allowed MIME types** (Decision D7).

---

## 7. Permissions (catalog additions)

New permission rows (data + role_permission mappings, mirrored in `seed.sql`), following the established module pattern:

| Code | Action |
|---|---|
| `document:create` | Upload documents |
| `document:read` | View / download documents |
| `document:update` | Edit document metadata |
| `document:approve` | Approve / reject documents |
| `document:delete` | Soft-delete documents |

No `:all` variant — document visibility inherits dossier visibility (Phase 1.7).

---

## 8. Audit events

Append-only `audit_log` (reuse `writeAudit`), entity `document`:

| Event | When |
|---|---|
| `document.uploaded` | new document (or new version) stored |
| `document.updated` | metadata edited |
| `document.approved` | approve action |
| `document.rejected` | reject action |
| `document.deleted` | soft-delete |
| `document.expired` | **reserved** — emitted only when the deferred scheduler flips status (MVP expiry is derived, so not audited) |

---

## 9. MVP scope (what 1.8 builds, after approval)

- Upload a document to a dossier (type from catalog, optional/required expiry date).
- List documents on the dossier (status + expiry badge; derived "expired"/"expiring" indicator).
- Approve / reject (with optional reason) — `document:approve`.
- Basic single `expiry_date` per document; derived expiry state.
- Private download via short-TTL signed URL.
- Dossier "missing required documents" derived indicator.
- RLS + audit + Phase 1.7 visibility preserved; pure status state machine unit-tested; `rls_document_test.sql` in CI.

## 10. Explicitly deferred

Client portal upload/view · OCR / data extraction · automated expiry **reminders + email** (needs the scheduler from the Phase 1.6 deferral) · external customs integrations (GAINDE/Orbus) · document **templates** · stored-EXPIRED flip + `document.expired` audit · the full customs expiry catalog (APE/DPI/exonération/sommiers) → Customs module.

---

## Decisions to confirm (sign-off gates BLK-3)

| ID | Decision | Recommendation | Owner |
|---|---|---|---|
| **D1** | MVP catalog (the 10 types) sufficient to start? | Yes — ship as editable table; grow later | Chief of Transit |
| **D2** | Per-type validity (which expire, default days) **and block-vs-warn** | Only `CERTIFICATE_OF_ORIGIN` expires in MVP; **warn-only** (no transition block) until confirmed | Chief of Transit |
| **D3** | Does "required document" **block** dossier progression or just **flag**? | **Flag/warn only** in MVP | Chief of Transit + Ops |
| **D4** | Approval authority = `document:approve` role set | SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER, CHIEF_OF_TRANSIT, COMPLIANCE_HSSE | Management |
| **D5** | Re-upload = **new version** (history kept) or replace? | New version row, supersedes | Chief of Transit |
| **D6** | Delete = **soft-delete only** (retention)? Ties to **DEC-B19** | Soft-delete; hard-delete deferred pending retention policy | Management/Compliance |
| **D7** | Max file size + allowed MIME types | e.g. ≤ 25 MB; pdf/jpg/png/docx/xlsx | Management/IT |
| **D8** | Storage = private bucket + server-mediated signed URLs, no public URLs | Approve as recommended (§6) | Management/IT |

---

## Implementation plan (only after the above are approved)

1. **Decision Register:** record D1–D8 (finalize DEC-B03; add a storage DEC + an approval-authority DEC); update [document-catalog.md](../document-catalog.md).
2. **Migration** (`..._create_documents.sql`): `document_type` (editable catalog, seeded) + `document` (tenant_id, file_id→cascade, type_code, status, expiry_date, version, storage_path, uploaded_by, reviewed_by, review_note, timestamps) + indexes + tenant-match trigger + **RLS** (`tenant + document:read + can_read_file(file_id)`; deny-by-default writes) + permission catalog/grants (mirror in `seed.sql`). Private `documents` storage bucket + deny-by-default `storage.objects` policy.
3. **Pure modules:** `lib/documents/status.ts` (state machine) + `expiry.ts` (derived state) + `validate.ts` — unit-tested.
4. **Service + actions:** upload/list/get/approve/reject/update/delete (service-role, `assertPermission` + `can_read_file`, audit, signed-URL minting).
5. **UI:** documents panel on `/files/[id]` (upload form, list with status/expiry badges, approve/reject); dossier "missing docs" indicator; optional `/documents` index deferred.
6. **Audit events** (§8) + i18n.
7. **Tests:** unit (status/expiry/validate) + `rls_document_test.sql` (visibility-inherited isolation) wired into CI + README.
8. **Verify gates** (tsc/test/build/boundary/secrets) → commit/push → report (migration name, files, validation, commit, prod instructions).
