# Phase 1.19 — Pilot Launch Dry Run (Role-by-Role Walkthrough)

**Date:** 2026-06-16
**Method:** Simulated a complete dossier lifecycle across the five pilot personas by tracing the actual RBAC grants (`supabase/seed.sql` + module migrations), every server action's permission gate + audit + state machine, the navigation gating, the communications triggers, and the portal RLS. All findings are evidence-backed (file:line). **No code was changed** — this is a readiness assessment.

**Pilot persona → seeded role:**
CEO → `CEO` · Operations Coordinator → `COORDINATOR` · Customs Agent → `CUSTOMS_DECLARANT` · Finance Agent → `FINANCE_OFFICER` · Client Portal User → `CLIENT_USER`.

---

## 1. Executive summary

The lifecycle is **mechanically sound** — every mutating action is permission-gated and audited, state machines have no orphan states, and tenant/RLS isolation holds. But run as the five **named pilot roles**, two of them hit hard walls that stop the happy path, and the platform sends **no client notifications** for the milestones clients care about most. The headline issue is a role-capability/UI mismatch, not a security hole.

**Verdict by persona (can they complete their stage solo?):**

| Persona | Role | Can complete their stage alone? |
|---|---|---|
| CEO | `CEO` | ✅ Yes — read-only oversight works everywhere |
| Operations Coordinator | `COORDINATOR` | ⚠️ Partial — drives ops, but can't approve docs or release customs (needs hand-off) |
| Customs Agent | `CUSTOMS_DECLARANT` | ❌ No — can declare/update customs but **cannot release** it |
| Finance Agent | `FINANCE_OFFICER` | ❌ No — has every `finance:*` permission but **no UI to author invoices/payments** |
| Client Portal User | `CLIENT_USER` | ✅ Yes — sees files/docs/invoices; online pay is dark by default |

---

## 2. Lifecycle walkthrough — who can do each step

| Stage | Action (file:line) | Permission | Audited | Roles that hold it |
|---|---|---|---|---|
| Client create | `createClient` (clients/actions.ts:51) | `client:create` | CLIENT_CREATED ✅ | SYSTEM_ADMIN, ACCOUNT_MANAGER |
| Dossier create | `createFile` (files/actions.ts:39) | `file:create` | FILE_CREATED ✅ | SYSTEM_ADMIN, ACCOUNT_MANAGER |
| Dossier advance | `transitionFile` (files/actions.ts:140) | `file:update` | FILE_TRANSITION ✅ | SYSTEM_ADMIN, ACCOUNT_MANAGER, COORDINATOR |
| Dossier **close** | `transitionFile`→CLOSED | `file:update` **+ customs RELEASED/CANCELLED gate** (customs/gates.ts:40) | ✅ | needs customs release first |
| Document upload | `uploadDocument` (documents/actions.ts:41) | `document:create` | DOCUMENT_UPLOADED ✅ | Coordinator, Customs, Transport, Doc officer… |
| Document **approve** | `approveDocument` (documents/actions.ts:121) | `document:approve` | DOCUMENT_APPROVED ✅ | SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER, CHIEF_OF_TRANSIT, COMPLIANCE_HSSE |
| Document share | `setDocumentShared` (documents/actions.ts:241) | `document:approve` | DOCUMENT_UPDATED ✅ | (same as approve) |
| Customs declare/advance | `changeCustomsStatus` (customs/actions.ts:165) | `customs:update` | CUSTOMS_* ✅ | Coordinator, **Customs Declarant**, Chief of Transit… |
| Customs **release** | `releaseCustoms` (customs/actions.ts:220) | `customs:release` | CUSTOMS_RELEASED ✅ | **SYSTEM_ADMIN, OPS_SUPERVISOR, CHIEF_OF_TRANSIT only** (seed:267) |
| Transport advance | `changeTransportStatus` (transport/actions.ts:203) | `transport:update` | TRANSPORT_* ✅ | Coordinator, Transport officer… |
| Transport pickup / **POD** | `changeTransportStatus` | `transport:complete` | ✅ | SYSTEM_ADMIN, OPS_SUPERVISOR, TRANSPORT_OFFICER |
| Charge / invoice build | `createCharge`/`addInvoiceLine` (finance/actions.ts:83/320) | `finance:create`/`finance:update` | CHARGE_*/INVOICE_* ✅ | SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER, FINANCE_OFFICER |
| Invoice issue | `issueInvoice` (finance/actions.ts:256) | `finance:issue` | INVOICE_ISSUED ✅ | + FINANCE_OFFICER |
| Payment record | `recordPayment` (finance/actions.ts:381) | `finance:payment` | PAYMENT_RECORDED ✅ | SYSTEM_ADMIN, OPS_SUPERVISOR, FINANCE_OFFICER |
| Payment verify/reject | `verifyPayment`/`rejectPayment` (finance/actions.ts:435/470) | `finance:void` | PAYMENT_VERIFIED/REJECTED ✅ | SYSTEM_ADMIN, OPS_SUPERVISOR, FINANCE_OFFICER |
| Notify client | `emailInvoiceIssued`/`emailDocumentShared`/`emailPortalInvite` | `communication:send` | COMMUNICATION_QUEUED/SENT ✅ | SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER, FINANCE_OFFICER |

> **Key coupling:** invoice/charge/payment UI lives **only** on the file detail page `/files/[id]`, which gates on `file:read` (files/[id]/page.tsx:42). The `/finance` queue is a **read-only** list that just links into those file pages (finance/page.tsx:93).

---

## 3. Role-by-role narrative

### CEO (`CEO`) — ✅ works
Read-only across the board: `client:read`, `file:read:all`, `task:read:all`, `customs/transport/finance:read`, `analytics:read`, `audit:read:all`, `communication:read`. Sees every sidebar item and every dashboard/analytics/audit view. Holds **no** write/approve/issue/send permission — correct for governance. No blockers. (Minor: the Communications nav shows but send buttons are hidden — expected.)

### Operations Coordinator (`COORDINATOR`) — ⚠️ partial
Drives the operational core: `file:read/update`, `task:*`, `document:create/update`, `customs:create/update`, `transport:create/update/assign`. Can open and advance a dossier, upload docs, prepare/advance customs, plan transport.
**Walls:**
- No `document:approve` → uploaded docs sit at `UPLOADED`/`PENDING_REVIEW`; the Coordinator cannot approve or share them.
- No `customs:release` → can take customs to `DECLARED`/`DUTIES_ASSESSED` but not `RELEASED`.
- No `transport:complete` → can't mark `PICKED_UP`/`POD_RECEIVED`.
- Therefore **cannot close an IMP/EXP dossier** (close gate needs customs RELEASED).
- No `finance:*` → no invoices (correct separation of duties).
This is by-design SoD, but it means a pilot **must also staff** a document approver + customs releaser (CHIEF_OF_TRANSIT or OPS_SUPERVISOR), or the dossier stalls.

### Customs Agent (`CUSTOMS_DECLARANT`) — ❌ blocked at release
Holds `customs:create/update`, `document:create/update`, `file:read` (scoped), `task:read/update`. Can prepare the declaration and walk customs through `DECLARED → UNDER_REVIEW → DUTIES_ASSESSED`.
**Wall:** `releaseCustoms` requires `customs:release`, granted only to SYSTEM_ADMIN/OPS_SUPERVISOR/CHIEF_OF_TRANSIT (seed:267). The role literally named *Déclarant en douane* **cannot release a shipment** — it must hand off to a Chief of Transit. Also cannot approve the customs prerequisite documents (no `document:approve`).

### Finance Agent (`FINANCE_OFFICER`) — ❌ blocked from authoring (headline finding)
Holds the full finance set: `finance:create/read/update/issue/payment/void/delete`, plus `analytics:read`, `communication:read/send`. **But it holds no `file:read`.**
- The only UI to create charges, build/issue an invoice, and record a payment is the **FinancePanel embedded in `/files/[id]`** (files/[id]/page.tsx:18). That page returns a "forbidden" notice without `file:read` (line 42).
- The `/finance` queue they *can* see is read-only and every row links to `/files/[id]` (finance/page.tsx:93) → a dead link for them.
- Net effect: the Finance Agent **cannot create or issue invoices or record payments** despite holding all the permissions. They *can* verify/reject/reverse payments on `/finance/reconciliation` (gated by `finance:read`, actions need `finance:void` which they hold), but there's nothing to verify because they can't record payments in the first place.
- In practice, invoice authoring today requires a role with **both** `file:read` and `finance:create` — i.e. OPS_SUPERVISOR, ACCOUNT_MANAGER, or SYSTEM_ADMIN — **not** the Finance Agent persona.

### Client Portal User (`CLIENT_USER`) — ✅ works (notifications aside)
No staff permissions; access is identity-based via `client_user` + additive RLS. After activation: sees own dossiers + status, **APPROVED + shared** documents (with short-TTL signed download), and ISSUED/PARTIALLY_PAID/PAID invoices with full detail. Online payment button is **disabled ("Coming soon")** unless `PAYMENTS_ENABLED` + a provider is configured. Invoice views and document downloads are audited. No dead ends — but the client only ever learns about updates if staff **manually** email them (see §4 communication gaps).

---

## 4. Findings by category

Severity: **Blocker** (stops the pilot happy path) · **High** · **Medium** · **Low**.

### A. Missing permissions / role-capability mismatch
| # | Finding | Severity | Recommended fix |
|---|---|---|---|
| A1 | **FINANCE_OFFICER has no `file:read`**, so it cannot reach the finance authoring UI (charges/issue/record payment live only on `/files/[id]`). The named Finance Agent cannot do finance. | **Blocker** | Grant `FINANCE_OFFICER` `file:read` (or `file:read:all` for a finance overview) so the file finance panel is reachable; or surface invoice authoring on a finance-only screen. One-line seed/migration grant. |
| A2 | **CUSTOMS_DECLARANT lacks `customs:release`** — the Customs Agent can't complete a release. | High | Decide policy: if declarants release in real life, grant `customs:release`; otherwise **staff a CHIEF_OF_TRANSIT** in the pilot and document the hand-off. |
| A3 | COORDINATOR lacks `document:approve` and `customs:release`, so it can't approve docs or close an IMP/EXP dossier alone. | Medium | Intentional SoD — ensure an approver/releaser role is staffed; document the hand-off in the launch checklist. |

### B. Broken navigation / dead links
| # | Finding | Severity | Fix |
|---|---|---|---|
| B1 | Finance Agent's `/finance` queue links every row to `/files/[id]`, which renders "forbidden" for them (no `file:read`). | High | Resolved by A1. Until then, the finance queue is a dead end for finance-only users. |
| B2 | Portal-user management and invoice authoring have no top-level nav entry (they live on `/clients/[id]` and `/files/[id]`); discoverable only by drilling in. | Low | Acceptable; note in operator training. |

### C. Workflow dead ends
| # | Finding | Severity | Notes |
|---|---|---|---|
| C1 | Dossier `CLOSED` requires customs `RELEASED`/`CANCELLED` for IMP/EXP (customs/gates.ts:40); release is restricted (A2). With no releaser staffed, dossiers stall at `DELIVERED`. | High | Role-staffing dead end, not a code one. The state machines themselves have no orphan states. |
| C2 | Documents stall at `PENDING_REVIEW` if no `document:approve` holder is staffed. | Medium | Same root: staff an approver. |
| C3 | `CLOSED`, `RELEASED`, `POD_RECEIVED`, `PAID`, `VOID` are terminal by design (no reopen). | Low | Confirm this matches ops expectations; reopening needs DB intervention. |

### D. Communication gaps (client-facing)
Only **three** triggers are implemented — `emailInvoiceIssued`, `emailDocumentShared`, `emailPortalInvite` (comms/actions.ts:121/171/218) — plus the staff welcome. All are **manual** (a staff click); there are **no automatic** notifications anywhere.

| Lifecycle event | Template exists? | Trigger action? | Result |
|---|---|---|---|
| Invoice issued | ✅ | ✅ manual | OK (staff must remember to click) |
| Document shared | ✅ | ✅ manual | OK (3 steps: approve → share → notify) |
| Portal invite | ✅ | ✅ manual | OK (2 steps: invite → send) |
| **Customs released** | ✅ `customs_released` | ❌ **none** | **client not notified** |
| **Transport delivered** | ✅ `transport_delivered` | ❌ **none** | **client not notified** |
| **POD received** | ✅ `pod_received` | ❌ **none** | **client not notified** |
| **Payment recorded** | ✅ `payment_recorded` | ❌ **none** | **client gets no receipt** |
| Task assigned | ✅ `task_assigned` | ❌ none | internal only |
| Payment link | ✅ `payment_link` | ❌ none | online-pay feature incomplete |

**Severity: High.** The milestones clients most expect to hear about (customs cleared, goods delivered, payment received) have ready-made templates but no way to send them. Recommended: add manual trigger buttons on the customs/transport/finance panels (mirrors the existing `emailInvoiceIssued` pattern — low risk), and tell pilots notifications are manual until then.

### E. Confusing UX
| # | Finding | Severity |
|---|---|---|
| E1 | Multi-step manual send (approve→share→**notify**; issue→**email**; invite→**send**) is easy to forget; no reminder that the client wasn't notified. | Medium |
| E2 | `NEXT_PUBLIC_SITE_URL` must be set or portal links in emails are relative/broken. | Medium (covered in launch checklist) |
| E3 | Portal "Pay online" shows a disabled "Coming soon" with no explanation when payments are dark. | Low |
| E4 | An `INVITED` (not yet activated) portal user hitting `/portal/login` gets no status hint. | Low |
| E5 | No admin UI to inspect a role's permissions (role→permission is seed/DB only). | Low |

### F. Audit gaps
Audit coverage is **strong** — every mutating action across clients, files, documents, customs, transport, and finance writes an audit entry (verified; none missing in customs/transport/finance). Minor refinements only:
| # | Finding | Severity |
|---|---|---|
| F1 | `setDocumentShared` records `after` but not `before` (share vs re-share indistinguishable). | Low |
| F2 | `updateClient` replaces contacts and `updateFile` upserts shipment data without a sub-entity audit line (only the parent is audited). | Low |
| F3 | Portal **file/shipment status views** are not audited (invoice views + document downloads are). | Low |

---

## 5. Pilot blockers vs. conditions

**Blockers (fix or explicitly mitigate before onboarding):**
- **A1 / B1** — Finance Agent cannot author invoices or record payments (no `file:read`). *Fix:* grant `FINANCE_OFFICER` `file:read`, **or** run finance through OPS_SUPERVISOR/ACCOUNT_MANAGER for the pilot and re-label the persona.

**High (resolve or staff around):**
- **A2 / C1** — Customs release restricted: staff a CHIEF_OF_TRANSIT (or grant `customs:release` to declarants), else dossiers can't close.
- **D** — No client notifications for customs release / delivery / POD / payment: add the missing manual triggers, or set pilot expectations that these are communicated out-of-band.

**Conditions / polish:** C2/C3 (staff an approver; confirm terminal states), E1–E5 (operator training + `NEXT_PUBLIC_SITE_URL`), F1–F3 (audit refinements).

---

## 6. Recommendation

> **Ready for a controlled pilot with conditions.** The engine (permissions, state machines, audit, RLS, portal isolation) is solid. Before onboarding, resolve the **Finance Agent authoring blocker (A1)** — a one-line `file:read` grant is the cleanest fix — and ensure the pilot **staffs a customs releaser and a document approver** (A2/C2/C1). Plan the **missing client notifications (D)** as a fast follow (the trigger pattern already exists). With those addressed, all five personas can complete the Client → Dossier → Documents → Customs → Transport → Invoice → Payment → Communications → Portal lifecycle end-to-end.
