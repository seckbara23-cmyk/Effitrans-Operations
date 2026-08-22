# « Dépôts physiques » from the Finance hub — Navigation Audit

**Audit only — nothing implemented, no flag enabled, no RBAC/RLS change.**
Requested before FIN-1 continues. Repository at `357e182`; FIN-1 stays paused.

## 0. STEP 0bis result, recorded

« Dépôts physiques » absent from the complete SYSTEM_ADMIN navigation (including
the Administration section) ⇒ **`EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED` is
empirically OFF in production.** Tenant flag is true; the env leg is the dark one.
**Not a deposit-workflow defect.** All prior STEP 0 findings preserved.

## 1. Who can currently OPEN `/deposits`

The page ([app/deposits/page.tsx:32-40](../../app/deposits/page.tsx)) gates, in order:

1. `globalKillSwitch().enabled` — else 404;
2. tenant-resolved `flags.physicalDeposit` (kill × env × tenant) — else 404;
3. **`admin_service:manage` OR `collections:manage`** — else 404.

| Permission | Roles (live production map) |
| --- | --- |
| `admin_service:manage` | ADMINISTRATIVE_OFFICER, OPS_SUPERVISOR, SYSTEM_ADMIN |
| `collections:manage` | COLLECTIONS_OFFICER, **FINANCE_OFFICER**, OPS_SUPERVISOR, SYSTEM_ADMIN |

**Answer to the central question: Finance ALREADY has legitimate read access by
design.** FINANCE_OFFICER and COLLECTIONS_OFFICER open `/deposits` today (flag
permitting). The read service ([lib/deposit/service.ts:88-91](../../lib/deposit/service.ts))
honours the same OR for tenant-wide listing, and returns `[]` when the flag is off
— so no oversight grant is needed, and none is proposed.

## 2. View vs mutate — the authority matrix (unchanged by any navigation)

| Act | Server guard (re-asserted per action in `lib/deposit/actions.ts`) | Roles |
| --- | --- | --- |
| **View** the workspace / custody timelines | page gate above; rows render read-only unless `canAdmin` | AO, OPS_SUP, SA + COLLECTIONS_OFFICER, FINANCE_OFFICER |
| Hand issued invoice to Administration | `finance:issue` | AM, BILLING, FINANCE_OFFICER, OPS_SUP, SA |
| Prepare package · accept/reject proof · hand to collections | `admin_service:manage` | AO, OPS_SUP, SA |
| Assign courier | `courier:assign` | AO, OPS_SUP, SA |
| Accept/decline/start/deposit/upload/submit proof | `courier:deposit` | COURIER, SA |
| Maker-checker | module-internal `self_review_forbidden` (courier ≠ reviewer) — **current ratified model; Decision 2 untouched** | — |

The UI passes `canAdmin` only to mutation controls (`DepositRow canAdmin=`);
`collections:manage` holders get a **read-only** view. The server re-asserts every
mutation regardless of UI — proven guard-by-guard in the FIN-UAT baseline.

## 3. Can the Finance-hub card be navigation-only? **Yes — and the hub already documents how**

`/departments/finance` builds workspace tiles from a `financeLinks` list
(`{label, href, permission, available?, desc}`), filtered by
`hasPermission AND available !== false`. Its own comment block records the exact
defect this idiom exists to prevent (**WES-3A.6**): the Recouvrement tile was once
gated on the permission alone while the target route also required flags — and
shipped as **a link that 404s**. The rule the file itself states: *a tile must be
gated on EXACTLY what its target route enforces.*

Therefore the card is expressible entirely in the existing idiom, reusing the
existing `/deposits` authorization unchanged.

## 4. Recommended smallest safe implementation (NOT implemented)

One availability constant + one list entry in `app/departments/finance/page.tsx`:

* `depositsAvailable = globalKillSwitch().enabled && flags.physicalDeposit` —
  **reusing the `getTenantProcessFlags` result already fetched** for
  `collectionsAvailable` (zero extra queries);
* insert **after Facturation, before Recouvrement** (the operator's ratified
  journey order: Facturation → Dépôts physiques → Recouvrement → Rapprochement →
  Balance âgée):
  `{ label: "Dépôts physiques", href: "/deposits", permission: "collections:manage", available: depositsAvailable, desc: "Remise des factures papier et chaîne de garde." }`

Why `permission: "collections:manage"` and not the OR: the tile model takes one
permission, and on the **Finance** hub the Finance-side reader permission is the
correct audience gate — it admits FINANCE_OFFICER, COLLECTIONS_OFFICER, OPS_SUP,
SA. ADMINISTRATIVE_OFFICER (who holds only `admin_service:manage`) is not a
Finance-hub audience and **keeps the existing sidebar Administration panel
unchanged** — same workflow, two discovery contexts, authority centralized.

Tests to ship with it: hub-tile gating in `finance-hub.test.ts` (tile present for
`collections:manage`+flag; absent without either) and the WES-3A.6 mutation — the
`available:` term dropped must FAIL (the 404-link regression).

## 5. Invariant confirmation (all hold — navigation cannot touch them)

| Invariant | Held because |
| --- | --- |
| `admin_service:manage` unchanged | no permission row, template or guard touched |
| No mutation-authority broadening | card grants reach, not rights; server re-asserts per action |
| COURIER authority & `/courier` landing untouched | `/courier` is identity-landing (`staff-identity.ts` narrowing), not navigation; unaffected by hub tiles |
| Maker-checker / verifier rules unchanged | module-internal; **Decision 2 stays open, behaviour documented as-is** |
| Statuses / canonical vocabulary unchanged | none referenced |
| RLS / audit / custody chain unchanged | no schema, no policy, no action change |
| No duplicate workflow | the card links to the ONE existing `/deposits`; nothing re-implemented |
| **Flag remains the single activation gate — the card CANNOT bypass it** | double gate: the tile hides via `available:` reading the same resolved flag, AND the page itself `notFound()`s without it, AND the service returns `[]`. Exposing the card while the env flag is off changes nothing visible |

## 6. Sequencing (for the operator's decision — nothing executed)

1. Approve → I implement the one-tile change + tests, CI, deploy (flag still OFF —
   the tile stays hidden; zero user-visible change).
2. Operator enables `EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED` in Vercel +
   redeploy — the tile and the Administration panel both appear.
3. FIN-1 resumes at FIN-1-01, with STEP 0ter (tile visible on the Finance hub,
   panel visible in Administration nav) as its reachability precondition.
   B-2 staffing (courier/administration demo accounts) still queued.
