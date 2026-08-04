# UT-3A — Missing Emitters & Observation Coverage: Governance Audit

**Date:** 2026-08-10 · **Status: DOCUMENTATION ONLY.** No implementation, no SQL, no
migration, no permission, no UI. **UT-3B has not begun.**
**Predecessors:** UT-0 · UT-1A (DEC-B88) · UT-1 · UT-2 — all closed. Ledger 85/85.

Every claim below was verified in the repository, not inferred. The registry was parsed
**per entry block** (an earlier cross-entry regex mis-flagged emitted types as reserved —
worth recording, because a governance doc built on that error would have scheduled
emitters for events that already emit).

---

## 1–2. Repository and registry audit

64 registered types · 12 domains · **32 rpc · 23 trigger · 9 reserved**. The nine reserved
types are exactly those below — no other event is missing an emitter, and **no unregistered
event is proposed**: sounding useful is not a criterion; only registered types are in scope.

## 3. Missing-emitter matrix

| Registered event | Current emitter | Owning context | The ACT that would emit it (verified) | Correct transaction boundary | Expected subject | Expected visibility |
|---|---|---|---|---|---|---|
| `CORRESPONDENCE_RECEIVED` | none | Enterprise Communications | `lib/ec/inbound/capture.ts` inserts `ec_inbound_message` | same transaction as the insert **that first attributes a tenant** (§5) | `ec_inbound_message` | EC authorities (UT-1 policy branch exists) |
| `HANDOFF_SENT` | none | Operations (process engine) | `sendHandoff()` — `lib/process/engine/actions.ts:543` | same transaction as the handoff row | the handoff, `dossier_id` set | dossier readers |
| `HANDOFF_RECEIVED` | none | receiving department | `receiveHandoff()` — `actions.ts:603` | same transaction as the acknowledgement | the handoff, `dossier_id` set | dossier readers |
| `DOCUMENT_SHARED_WITH_CLIENT` | none | Documents | the sharing action in `lib/documents/actions.ts` | same transaction as the share record | the document, `dossier_id` set | dossier readers; **`clientSafe: true`** (already flagged) |
| `EXPENSE_AUTHORIZED` | none | Finance | chain completion (`decision === "APPROVED" && chainComplete`) — `lib/finance/expense/actions.ts:594` | same transaction as the APPROVED terminal transition | the authorization; `dossier_id` **nullable** — see the visibility gap (§9/R3) | finance staff — **gap for dossier-less expenses** |
| `DOSSIER_POLICY_PINNED` | none | Platform (workflow policy) | pinning in `lib/workflow/policy/actions.ts` (WES-7) | same transaction as the pin | the dossier | dossier readers |
| `HISTORICAL_EVENTS_NOT_BACKFILLED` | none | Ledger | **administrative**: a one-time per-tenant statement at UT-3 activation | its own transaction | tenant scope, `dossier_id` NULL | `admin:config:manage` (existing branch) |
| `ADMIN_OVERRIDE_EXECUTED` | none | Operations | **NO SUCH ACT EXISTS** — the only trace is `audit_log.override_reason`, which no code path writes as a workflow override | — | — | — |
| `WORKFLOW_REVERSED` | none | Operations | **NO SUCH ACT EXISTS** | — | — | — |

**The finding that reshapes UT-3:** the last two reserved types describe capabilities the
platform does not have. An emitter without an act **fabricates history** — the exact thing
this program exists to prevent. They must **remain reserved** until an override/reversal
capability is actually built, and that phase must emit them in its own transaction.
**UT-3B therefore implements 7 emitters, not 9.**

## 4. Ownership matrix

| Context | Produces (after UT-3B) | Consumes | Never |
|---|---|---|---|
| Enterprise Communications | +`CORRESPONDENCE_RECEIVED` (8 total) | — | interprets business meaning |
| Operations / process engine | +`HANDOFF_SENT` | dossier timeline | emits another department's receipt |
| Receiving department | +`HANDOFF_RECEIVED` | — | acknowledges what it did not receive |
| Documents | +`DOCUMENT_SHARED_WITH_CLIENT` | — | embeds content |
| Finance | +`EXPENSE_AUTHORIZED` | — | puts an amount in the payload |
| Platform | +`DOSSIER_POLICY_PINNED`, +`HISTORICAL_EVENTS_NOT_BACKFILLED` | — | — |
| Tracking | **nothing, still** | both planes | — |

## 5. Correspondence recommendation — one answer

The four candidate timings, and why three die:

* **on capture, unconditionally** — impossible: quarantined mail is captured with
  `tenant_id = NULL`, and `business_event.tenant_id` is NOT NULL. Emitting would require
  inventing a tenant.
* **after routing** — for routed mail this *is* capture (one transaction), so it is not a
  distinct option; naming it separately only creates two rules.
* **after triage** — far too late: the entire point of the event is that an email's
  *arrival* is visible before any human acts on it. UT-0 recorded exactly this gap (D2).

**The surviving answer: `CORRESPONDENCE_RECEIVED` emits at the moment the message is first
attributed to a tenant.** One rule, two natural sites: the capture transaction for
normally-routed mail (the overwhelming case), and the quarantine-release/tenant-assignment
transaction for quarantined mail — because until that moment the message exists in no
tenant's history, which is the truth. Quarantine semantics are untouched; a message that is
never attributed never enters any ledger, which is also the truth.

## 6. Handoff recommendation

Genuine **ownership transfers** — not status changes, not assignments:

| Transfer | Already evented? | Verdict |
|---|---|---|
| department → department via `sendHandoff`/`receiveHandoff` (Operations→Transit, Transit→Finance, …) | **no** | **`HANDOFF_SENT` / `HANDOFF_RECEIVED` — the two emitters UT-3B builds.** Two events, deliberately: sending and acknowledging are different facts by different actors, possibly far apart in time |
| Commercial → Operations (conversion) | `QUOTATION_CONVERTED_TO_DOSSIER` | already covered; no second event |
| Triage → Commercial (quotation handoff) | `CORRESPONDENCE_QUOTATION_HANDOFF` | already covered |
| task/owner (re)assignment | WES-3 `assignment_event` + task events | **not an ownership transfer between contexts** — a person changed, not the owning department. No new event |
| status transitions | `DOSSIER_STATUS_CHANGED` etc. | state, not ownership. No new event |

## 7. UT3-ROAD recommendation — Option C

`public.tracking_event` vs the frozen Plane B contract, verified:

| Dimension | Road store | Plane B contract |
|---|---|---|
| Dossier linkage | `file_id NOT NULL` — **better** than ocean/air (direct, no shipment hop) | via shipment |
| Timestamps | `occurred_at` only (+`created_at`) | bitemporal |
| Confidence | **no column** | CONFIRMED/INFERRED/MANUAL/ESTIMATED |
| Source vocabulary | `manual · driver_mobile · vehicle_gps · carrier_api · vessel_api · flight_api` | CARRIER/AIS/PORT/… |
| Client-safety | its own (`customer_visible` + `customer_message`); `internal_note` staff-only | registry allow-list |
| Ownership | Phase-3.4 road telematics module | — |

* **Option A (add confidence column)** — a migration, retrofitting a judgement the writers
  never made; the backfilled value would be invented. **Rejected.**
* **Option B (derived confidence)** — mapping `driver_mobile → CONFIRMED` etc. *fabricates a
  grade*, which UT-2's own tests pin as forbidden ("unknown confidence remains unknown").
  **Rejected.**
* **Option D (remain excluded)** — leaves the road leg of a multimodal shipment invisible
  forever, for no structural reason: the store is append-only, milestone-shaped and
  dossier-attributed. **Rejected.**
* **Option C (separate observation adapter)** — **RECOMMENDED.** A third adapter beside
  ocean/air, mapping the source vocabulary onto the frozen origin axis (`manual`/
  `driver_mobile` → human · `vehicle_gps` → system · `*_api` → external) and carrying
  **`confidence: null`**, which `UnifiedEntry` already supports and already means "the
  source did not state one". No migration, no fabrication, no schema change, and the
  UT-2 doctrine is applied rather than bent. `internal_note` and `customer_message` never
  enter the projection (free text); geofence proximity noise is excluded by allow-list (§8).

## 8. Milestone doctrine

Accepted into the timeline: **irreversible business milestones** —
`PICKUP_CONFIRMED · DEPARTED · BORDER_REACHED · WAREHOUSE_REACHED · CUSTOMS_STOP ·
DELIVERY_ATTEMPTED · DELIVERED` (road), the ocean/air milestone sets already admitted by
UT-2, and the seven emitters of §3.

Rejected, with the reason:

| Rejected | Why |
|---|---|
| `ARRIVED_NEAR_*` (geofence) | proximity telemetry — the road analogue of `POSITION_UPDATE` |
| `TRACKING_STARTED` / `TRACKING_STOPPED` | session plumbing, not shipment history |
| `CHECKPOINT_REACHED` | repeatable, high-frequency; noise unless ratified otherwise |
| `DELAY_REPORTED` / `INCIDENT_REPORTED` | carry free-text payloads; admitting them means admitting prose — needs its own ratification, not a default |
| duplicate state (e.g. a handoff ALSO emitting a status change) | one fact, one event |
| UI-convenience events | the registry is not a rendering aid |

## 9. Provenance review & risks

All seven emitters fit the frozen two-axis model with **no schema change**: RPC/action
emissions with an actor → `human`; the capture path → `system`; road adapter per §7.

| Ref | Risk |
|---|---|
| R1 | Emitting `EXPENSE_AUTHORIZED` for a **dossier-less** expense (DEC-C15 allows one) produces an event **no policy branch admits** — invisible even to Finance. UT-3B must either scope it to dossier-linked expenses or widen the SELECT policy with a finance-prologue branch — **which is a migration and needs approval first** (RATIFY-UT3-3) |
| R2 | `DOCUMENT_SHARED_WITH_CLIENT` is `clientSafe: true` — the first *new* customer-visible type since the freeze; each such addition is a ratified decision (UT-0 R7) |
| R3 | Double-emission at the handoff sites (RPC + trigger — the WES-4 trap); UT-3B must pick ONE emission mode per type |
| R4 | The road adapter silently admitting free text; pinned by the same test pattern UT-2 used |
| R5 | Backfilling `CORRESPONDENCE_RECEIVED` for historical mail — **never**; the honesty marker exists instead |

## 10–11. ADRs and ratification questions

| Ref | Decision to freeze |
|---|---|
| **ADR-UT3-1** | Reserved types whose act does not exist stay reserved; building the act and the emitter is one phase, never two |
| **ADR-UT3-2** | `CORRESPONDENCE_RECEIVED` = first tenant attribution (§5) |
| **ADR-UT3-3** | Road joins Plane B via Option C with honest `confidence: null` |
| **ADR-UT3-4** | Milestone doctrine of §8 |

| Ref | Question for management |
|---|---|
| **RATIFY-UT3-1** | Confirm Option C for road (no migration) over Option A (schema change) |
| **RATIFY-UT3-2** | `EXPENSE_AUTHORIZED` scope: dossier-linked only (no migration), or all expenses (requires a finance-prologue policy branch = migration)? |
| **RATIFY-UT3-3** | Confirm `DOCUMENT_SHARED_WITH_CLIENT` as customer-visible (`clientSafe: true` stands) |
| **RATIFY-UT3-4** | May `DELAY_REPORTED` / `INCIDENT_REPORTED` ever enter the timeline (they carry prose)? Default: no |

## 12. Roadmap

**UT-3B** — the 7 emitters, in dependency order: correspondence (closes the oldest gap) →
handoffs → document sharing → expense (per RATIFY-UT3-2) → policy pin → the per-tenant
honesty marker last, emitted only once the others are live so it states something true.
**UT-3C** — the road observation adapter (Option C).
Both consume UT-1/UT-2 unchanged; **no reader changes needed** — an emitted event appears
in the merged timeline automatically.

## 13. GO / NO-GO

# ✅ GO for UT-3B

— scoped to **7 emitters, not 9** (ADR-UT3-1), with RATIFY-UT3-2 answered before the
expense emitter is written (it alone decides whether a migration exists), and UT-3C
authorised separately once RATIFY-UT3-1 is confirmed.

---

**Confirmed: no implementation, no migration, no SQL, no permission, no UI. UT-3B has not
begun.**
