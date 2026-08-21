# RQ-18b — Transport mode semantics

**AUDIT AND DECISION PROPOSAL ONLY. Nothing implemented; production untouched.**
TMS-7 remains closed at `71c7004`; its closure report and UAT inventory are not
reopened by this document.

---

## 1. Current behaviour

### Where a "mode" exists at all

A schema-wide scan for modal columns returns exactly one relevant field:

| Table | Column | Type | Values |
| --- | --- | --- | --- |
| `shipment` | `transport_mode` | text, **NULLABLE** | CHECK: `SEA` · `AIR` · `ROAD` · **`MULTIMODAL`** |

`transport_record` — the entity that models what Effitrans actually executes —
has **no modal column at all**.

### How `shipment.transport_mode` is consumed

| Consumer | Use | Correct? |
| --- | --- | --- |
| Air intelligence (`lib/air/…`) | Gates every air-tracking surface on `transport_mode = 'AIR'` | ✅ It asks how the goods travel internationally |
| Customs (`requiredCustomsDocCodes`) | `SEA` drops `AIRWAY_BILL`; `AIR` drops `BILL_OF_LADING` | ✅ Which transport document the customs file needs follows the international carriage |
| Copilot prompt | Prints « Mode de transport » as dossier context | ✅ Dossier-level fact |
| **ORDRE DE TRANSPORT** | Printed under CLIENT / DOSSIER on a document that instructs a **road** movement | ❌ **the defect** |

Every consumer except the printed order treats it as the **international /
principal carriage mode**, and does so correctly.

---

## 2. Domain-model finding

**No — one field is NOT currently being asked to represent two business concepts.**
At the data layer the model is already correct and unambiguous. The two concepts
exist and are already separate:

| Concept | Where it lives | Cardinality per dossier |
| --- | --- | --- |
| **Mode de l'expédition** — how the principal shipment moves internationally | `shipment.transport_mode` | 0..1 (nullable) |
| **Segment routier** — the road movement Effitrans executes | `transport_record` | **0..1** (`UNIQUE (file_id)`) |

`transport_record` carries no mode because **it only ever models one**: road.
That is implicit in every field it has —

`driver_name` · `driver_phone` · `vehicle_plate` · `trailer_or_container` ·
`vehicle_id` → the Parc & Flotte truck fleet · `provider_id` → road
subcontractors · `pickup_location` / `delivery_location`

— and in its state machine (PLANNED → DRIVER_ASSIGNED → PICKED_UP → IN_TRANSIT →
DELIVERED → POD_RECEIVED), which describes a truck run and nothing else.

**The ratified roadmap already draws this distinction and already names it.**
`docs/roadmap.md`:

> « **Fret aérien et maritime** | Expéditions — multimodal (maritime / aérien /
> routier) | `/shipments` »
> « **Transport routier** | Transport routier (flotte, tournées, suivi camions) »
> « **Liens** : Expéditions (**segment routier**), Clients, Tâches »

So the road execution is already ratified as a **segment** of the expedition —
not as a competing mode of it.

**The defect is therefore presentational, not structural.** The ORDRE DE TRANSPORT
prints the *expedition's* mode under a bare label « MODE DE TRANSPORT » on a
document whose entire purpose is to instruct a *road* movement. A reader cannot
tell which of the two concepts the value describes.

---

## 3. The five real-world cases

| # | Case | `shipment.transport_mode` | `transport_record` | Model holds? |
| --- | --- | --- | --- | --- |
| 1 | Import maritime + truck pickup, Port de Dakar | `SEA` | on-carriage: Port → client | ✅ data correct; ❌ order prints « SEA » while instructing a truck |
| 2 | Air import + truck delivery from AIBD | `AIR` | on-carriage: AIBD → client | ✅ / ❌ same |
| 3 | Export: truck pickup precedes maritime shipment | `SEA` | **pre**-carriage: client → Port | ✅ handled identically — `pickup_location`/`delivery_location` carry direction; no new concept needed |
| 4 | Pure road, Senegal → Mali | `ROAD` | the road movement itself | ✅ the two coincide; printing « ROAD » is accurate but redundant |
| 5 | Shipment with **no** Effitrans road execution | any mode | **absent** — « Aucun transport » | ✅ **the clincher** |

**Case 5 settles the domain question.** A shipment can have a mode with no road
execution at all; a dossier can equally hold a road execution whose mode differs
from the expedition's. The two concepts have **different cardinality and
independent lifetimes** — one field could not express both even if someone tried.

Case 4 also surfaces an adjacent constraint, noted and **out of scope here**:
`transport_record` has `UNIQUE (file_id)`, so a corridor run with several road
legs cannot be modelled as multiple records today.

---

## 4. Ambiguity and risk

| Risk | Severity |
| --- | --- |
| A subcontracted **road** order printed « MODE DE TRANSPORT : SEA » is handed to a carrier. It misdescribes the movement being ordered | **Real but contained** — an operational document reads oddly; no data is wrong |
| A future reader "fixes" the ambiguity by writing the execution mode INTO `shipment.transport_mode` | **This is the actual danger.** It would corrupt air-tracking gating and customs document requirements, both of which correctly depend on the international mode |
| Someone adds a second modal column to `transport_record` | Redundant today — the entity is road-only by construction — and it would invite disagreement between the column and the entity |

The second row is why this warranted a ratification question rather than a quiet
edit: the cheap "fix" is the harmful one.

---

## 5. Recommended canonical terminology

Adopted from Effitrans's own roadmap, not invented here:

| Concept | Canonical French | Canonical English | Field |
| --- | --- | --- | --- |
| International / principal carriage | **« Mode de l'expédition »** | Shipment mode | `shipment.transport_mode` |
| Road movement Effitrans executes | **« Segment routier »** | Road segment | `transport_record` (implicitly road) |

The word « transport » alone is the ambiguity and should be avoided unqualified
on any surface where both concepts can appear.

---

## 6. Are schema or code changes required?

**Schema: NO.** No migration, no new column, no backfill, no enum change.
The data model already separates the concepts correctly, and `MULTIMODAL`
already exists for a genuinely mixed principal carriage.

**Code: ONE LABEL.** The single incorrect surface is the printed order.

### Recommended change (smallest safe)

In `lib/documents/artifacts/source.ts`, change the ORDRE DE TRANSPORT's label for
`transportMode` from « Mode de transport » to **« Mode de l'expédition »**.

The **value is unchanged** — it remains the shipment's mode, which is genuinely
useful context on a road order (it tells the carrier the goods came off a vessel
and may be in a container). Only the label stops overstating what it describes.

`SOURCE_FIELD_LABELS_FR` is shared between DEMANDE_TRANSPORT and TRANSPORT_ORDER,
so the smallest correct implementation is a **per-artifact label override** for
this one field rather than a global rename — a global rename would also relabel
the DEMANDE, which is a dossier-level document where « Mode de transport » is
already unambiguous.

### Options considered and rejected

| Option | Why rejected |
| --- | --- |
| Omit the field from the order | Loses genuinely useful context (containerised sea freight vs air) |
| Add `execution_mode` to `transport_record` | Redundant — the entity is road-only by construction; a column that can only hold one value invites drift |
| Derive and print "ROUTIER" as the order's mode | Invents a fact the operator never entered, and would be wrong the day a non-road execution exists |

---

## 7. Migration / backfill implications

**None.** No schema change is proposed, therefore no migration, no backfill, and
no ledger entry.

## 8. UI implications

**None outside the generated document.** The dossier and shipment surfaces
already show the expedition mode in a dossier context where it is unambiguous.
The Transport department surfaces show no mode at all, which is correct — they
show a road execution.

## 9. Impact on existing production records

**Zero.** No stored value changes. Six live shipments (4 × `SEA`, 2 × `AIR`) keep
their modes; six transport records are untouched.

Documents already generated keep their bytes and their content hash. The label
change alters rendered output for the SAME snapshot, so it requires a
**`RENDERER_VERSION` bump** (`wes4g-2` → `wes4g-3`) so that identical snapshots
rendered either side of the change remain explainable. Prior versions stay
immutable and downloadable, exactly as UAT-18 proved.

## 10. Smallest safe implementation plan

1. Add a per-artifact label override for `transportMode` on `TRANSPORT_ORDER`
   only → « Mode de l'expédition ».
2. Bump `RENDERER_VERSION` to `wes4g-3`.
3. Regression tests: the order renders the new label; the DEMANDE is unchanged;
   the VALUE still comes from `shipment.transport_mode`; determinism preserved.
4. Mutations: the label reverting; the override leaking to DEMANDE_TRANSPORT;
   the value being replaced by a derived "ROUTIER"; the version not bumped.
5. Full vitest, typecheck, build, CI, confirm the deployed SHA.
6. Operator regenerates the order on `EFT-IMP-2026-00005` as the next version and
   confirms the label, with the previous version still present.

Estimated surface: **one label map, one constant, one test file.** No migration,
no RBAC change, no production data change.

---

## 11. Authority model — unchanged

Nothing here touches the ratified authority model. The Operations Manager
coordinates operations with the Account Manager; operational ownership is
**designated**, never inferred from dossier creation. This proposal changes one
printed label and no authority, no ownership and no assignment.

---

## Decision requested

> **Approve the label-only change (« Mode de l'expédition » on the ORDRE DE
> TRANSPORT), or state a different preferred wording — or decline and leave the
> document as it is.**

No schema change is recommended, and none should be made without a business need
that this audit did not find.

---

# RQ-18b — STATUS: RESOLVED / APPROVED (2026-08-21)

**Decision:** APPROVED as recommended — the artifact-specific label change only.

| | |
| --- | --- |
| ORDRE DE TRANSPORT label | « Mode de transport » → **« Mode de l`expédition »** |
| Scope | **That artifact only**, via a per-artifact override in `render.ts` |
| `RENDERER_VERSION` | `wes4g-2` → **`wes4g-3`** |

## What was implemented

`ARTIFACT_LABEL_OVERRIDES` in `lib/documents/artifacts/render.ts`, consulted ahead of
the shared map: `label: overrides[f] ?? SOURCE_FIELD_LABELS_FR[f] ?? f`. One entry:
`TRANSPORT_ORDER: { transportMode: "Mode de l`expédition" }`.

## What was deliberately NOT done

| Constraint | Held |
| --- | --- |
| `shipment.transport_mode` | **unchanged** — no migration, no backfill, no production data touched |
| SEA / AIR / ROAD / MULTIMODAL vocabulary | **unchanged** |
| `execution_mode` or any new modal column | **not added** |
| Global label rename | **not done** — `SOURCE_FIELD_LABELS_FR.transportMode` is still « Mode de transport », and the DEMANDE DE TRANSPORT still renders it (pinned) |
| The « segment routier » distinction | **preserved** — `transport_record` still carries no mode, because it only ever models one |

## Verification

12 new tests in `tests/rq-18b-shipment-mode-label.test.ts`, plus the existing
composition suite updated for the version bump.

Mutations **M57–M62** all caught:

* **M57** the label regressing to « Mode de transport » (the defect);
* **M58** the override leaking to every artifact — the global rename the decision forbade;
* **M59** the override silently not consulted;
* **M60** renaming the SHARED map instead, which would relabel the DEMANDE;
* **M61** the renderer version not bumped;
* **M62** the value replaced by an invented « ROUTIER » execution mode.

M60 and M62 are the two wrong fixes the audit warned about, and both fail the suite.

Full vitest **7185 passed** (+12; the one failure is the standing Windows
line-ending pin, green in CI). Typecheck and production build clean.

## Retained as future modelling debt — NOT expanded here

`transport_record` has **`UNIQUE (file_id)`**, so a dossier can hold at most ONE road
execution. A corridor run with several road legs — or a pre-carriage AND an
on-carriage on the same dossier — cannot be modelled as separate records today.
Observed during the RQ-18b audit, recorded, **scope not expanded**.
