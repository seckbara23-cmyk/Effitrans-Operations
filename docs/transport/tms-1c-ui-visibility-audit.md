# TMS-1C — production UI visibility audit (EFT-IMP-2026-00001)

**Date:** 2026-09-03 · **READ-ONLY AUDIT.** No implementation, no migration, no
deployment, no production mutation. `EFT-IMP-2026-00001` and
`EFT-IMP-2026-00009` were both left untouched.

---

## 1. Executive verdict

**The TMS-1C component is deployed, wired, and renders on
EFT-IMP-2026-00001 — but NOT inside the Transport card.** It is a sibling
section two panels further down the page. The observation "the complete
visible Transport card contains no tracking section" is accurate and the
conclusion drawn from it is understandable; nothing is broken.

**However, that placement is a legitimate finding against the brief's own
words**, and I am not going to file it as purely observer error. TMS-1C §6
said *"On active mission / transport panel, add: « Suivre la mission en
direct »"*. I rendered it as its own card rather than within the transport
panel. A reviewer who inspects the transport panel and does not find it is
reading the brief correctly.

## 2. Primary classification

**5 — INTENTIONAL BEHAVIOUR / UAT MISUNDERSTANDING** (the component is present
and reachable; the neutral state is rendering), **with a secondary UX
PLACEMENT defect** against brief §6.

It is explicitly **NOT**: deployment mismatch (§4), render/wiring defect (§5),
RBAC/rendering defect (§7), or server data-retrieval defect (§8) — each
disproved below rather than assumed.

## 3. Root cause with file/line evidence

`app/files/[id]/page.tsx` renders, in this order:

| line | section | condition |
|---|---|---|
| 545 | `<TransportPanel>` — **the "Transport card"** | `canReadTransport` |
| 562 | `<QC5Panel>` | always |
| 563 | `<DriverAssign>` | `canReadTransport && transportRecord` |
| **577** | **`<MissionTracking>`** (`id="mission-tracking"`) | **`canReadTransport && transportRecord`** |
| 586 | `<TrackingTimeline>` | `trackingOn && canReadTracking` |

`MissionTracking` is its own `<section className="surface">`
(`components/transport/mission-tracking.tsx`), **not** a child of
`TransportPanel`. On 00001 it renders below the QC5 panel and the driver panel
— off the region the screenshot framed.

## 4. Deployment — NOT a mismatch (question A)

| | |
|---|---|
| production deployment | `dpl_EozgqVxxSa5dHSCP2JxRUt9nfKTv`, **READY**, target `production` |
| built from | **`fc684a7603f4`** (branch `main`) — the TMS-1C fixture fix, a **descendant of `362fe06`** |
| deployed at | **2026-09-02 23:37:53 UTC** — before the UAT |
| local `HEAD` | `fc684a7`, **working tree clean** — so the files audited here are byte-identical to the deployed tree |
| `components/transport/mission-tracking.tsx` at `fc684a7` | present, **203 lines** (`git show`) |
| `app/files/[id]/page.tsx` at `fc684a7` | imports `MissionTracking` (L46), imports `getMissionTracking` (L47), resolves it (L267), renders it (L579) |
| page caching | `export const dynamic = "force-dynamic"` (L73) — no stale page cache |

The three previous production deployments (`362fe06`, `c730fbb`, `669da27`)
are all superseded. **A build predating the TMS-1C UI integration is not being
served.**

## 5. Component render path — the neutral state IS reachable (question B)

```
app/files/[id]/page.tsx
  L223  canReadTransport = hasPermission(permissions, "transport:read")
  L224  transportRecord  = canReadTransport ? await getTransportRecord(file.id) : null
  L267  missionTracking  = transportRecord ? await getMissionTracking(transportRecord.id) : null
  L577  {canReadTransport && transportRecord && ( <MissionTracking … reference={missionTracking} /> )}
```

**The render condition does not mention the reference.** There is no
`if (!trackingReference) return null`, no
`transport && trackingReference && <MissionTracking>`, and no such guard inside
the component either — it branches on `canFollowLive(reference)` and otherwise
prints `TRACKING_STATE_LABEL_FR[state]`, whose `NOT_CONFIGURED` value is
« Suivi en direct non configuré pour cette mission. »

An existing mission with **no** reference therefore renders the neutral
section. That is exactly the case 00001 is in, and it is covered by test
*"no reference is NOT_CONFIGURED, and the neutral sentence says so"*.

## 6. Eligibility condition (question C)

**There is no mission-state eligibility rule, and none was invented.** The only
conditions are `transport:read` and the existence of a non-deleted
`transport_record`. Status `DRIVER_ASSIGNED` (« Chauffeur affecté ») is
eligible, as is every other status: no code, test or migration keys tracking to
transport status, driver presence, vehicle presence, or dossier lifecycle.

**Read-only facts for EFT-IMP-2026-00001** (question C / deliverable 9):

| fact | value |
|---|---|
| `operational_file.id` | `26103044-9327-4a74-968a-b49b5aa8a42f` |
| dossier status | **DELIVERED** |
| tenant | `…0001` |
| `transport_record.id` | **`fd443223-23a3-4f1f-bf34-9a573d66a862`** |
| transport status | **DRIVER_ASSIGNED** |
| `deleted_at` | null |
| vehicle | **AA460MV** |
| `driver_user_id` | **null** (the assigned driver is free-text, not a platform identity) |
| `transport_tracking_reference` rows | **0** |

So `transportRecord` is non-null and the reference is absent — the neutral
state, precisely.

## 7. RBAC behaviour (question D)

- `transport:read` → sees the section (neutral or link). Gate at L577 and in
  `getMissionTracking`.
- `transport:assign` → additionally sees management controls
  (`canManage={canAssignDriver}`, L582 ← L262).
- **Without `transport:assign` the section still renders**, management block
  omitted (`{canManage && (…)}`) — the specified contract.
- **Without `transport:read` the whole section is absent** — correct: the same
  gate hides the Transport card, so a user in that state sees neither.
- The observer sees the Transport card *and* driver information, so their
  account holds `transport:read`; and management controls would appear iff they
  hold `transport:assign`.

**D6 — could RLS suppress the lookup while `transport_record` stays visible?**
No, and it could not hide the section even if it did: `getMissionTracking` uses
the **admin client** with an app-side `transport:read` gate (EC-3C idiom) and
returns `null` on refusal — and `null` is the neutral state, which still
renders.

## 8. Zero-row behaviour (question E)

`lib/transport/tracking-service.ts` uses **`.maybeSingle<Row>()`**, then
`if (!data) return null;`. **No `.single()` anywhere** — no zero-row exception
is possible. `assertPermission` is wrapped in try/catch returning `null`. The
page never throws on a missing reference, so the component always mounts when
its two conditions hold.

## 9. Other conditions checked (question F)

No lifecycle restriction exists. Tracking is **not** hidden for cancelled,
closed, delivered, driver-less, vehicle-less, not-started or legacy transports —
verified by reading the render condition and by the absence of any status
reference in `mission-tracking.tsx`, `tracking-service.ts` and the page block.
00001 being **DELIVERED** does not suppress it.

## 10. UI location and dead-code check (questions G, H)

Intended and actual location is `/files/[id]` — confirmed in the deployed tree,
not assumed from the report. The component is **imported, reachable, bundled
and rendered**: it is referenced by a server component that the build compiles
(`✓ Compiled successfully`), under a condition satisfied by 00001. It is not
dead code.

## 11. Smallest safe corrective slice (UX only — NOT implemented)

The functional behaviour needs no correction. To honour brief §6 and make the
section findable where a Transport reviewer looks:

**Option 1 (recommended, smallest):** move the `<MissionTracking>` block from
L577 to immediately after the `<TransportPanel>` block (L560), so it sits
directly beneath the Transport card instead of below QC5 and DriverAssign. One
block moved in one file. No props, no logic, no data change.

**Option 2:** render `MissionTracking` *inside* `TransportPanel`. Truer to
§6's wording, but it pushes a server-resolved prop through the panel's
interface and enlarges a component this slice has no other reason to touch.
Larger blast radius for the same visible outcome.

**Recommendation: Option 1**, with an anchor already present
(`id="mission-tracking"`) so it can be linked from the transport section.

Every ratified invariant is untouched by either option: no portal access, no
driver access, `transport:read` to view, `transport:assign` to manage, tenant
isolation, https-only, host-only audit/display, no workflow/status/POD/closure
authority, no provider hard-coding. **Migration 135 remains valid and
unchanged** (deliverable 14) — this is a JSX ordering question only.

## 12. Tests for the proposed fix (deliverable 12)

The existing 42 focused tests and the SQL/RLS suite are retained unchanged. The
placement change needs one added assertion, plus the brief's list is already
largely covered — stated honestly, with the gaps named:

| # | requirement | today |
|---|---|---|
| 1 | mission + no reference → neutral renders | **covered** (`NOT_CONFIGURED` + neutral sentence) |
| 2 | `transport:read` only → neutral visible, controls hidden | **partially** — `{canManage && (…)}` is pinned; add an explicit "renders without canManage" assertion |
| 3 | + `transport:assign` → association control visible | **covered** |
| 4 | existing reference + read → link visible | **covered** |
| 5 | no mission → UI absent | **covered** (render condition pinned) |
| 6 | portal user → unavailable | **covered** (portal-tree walk + no portal policy + SQL suite) |
| 7 | driver → unavailable | **covered** (SQL suite: driver holds `tracking:read`, not `transport:read`, sees 0) |
| 8 | cross-tenant → unavailable | **covered** (SQL suite) |
| 9 | missing reference = normal zero row, not an exception | **add**: pin `.maybeSingle()` and the absence of `.single()` in `tracking-service.ts` |
| 10 | rendering mutates nothing | **covered** (no status/step/POD/closure writes asserted) |
| — | **placement** | **add**: `MissionTracking` block appears after the `id="transport"` block and before `QC5Panel`/`DriverAssign` |

## 13. Regression risks

Very low. Moving one JSX block changes vertical order only — no data flow, no
conditions, no props. The risks worth naming: the page's section order is
asserted nowhere else (so nothing else breaks, but nothing else guards it
either), and any anchor/deep-link to `#mission-tracking` keeps working since
the id moves with the block.

## 14. Final verdict

**TMS-1C PASS (functional)** — deployed, wired, reachable, correct, and
currently rendering the neutral state on EFT-IMP-2026-00001.

**Plus: TMS-1C UX PLACEMENT FIX RECOMMENDED** — one block moved, to put the
section where brief §6 said it belongs and where the reviewer looked for it.

Nothing was implemented, pushed, deployed or mutated.
