# EC-3C — Commercial Workspace: Implementation Brief

**Status: BRIEF ONLY — implementation is NOT authorised.** Nothing in this document has
been built. It exists so that when authorisation comes, the first commit is already
governed.

**Predecessor:** EC-3B **CLOSED** 2026-08-06 — migration 82 applied, ledger 82/82,
production dark ([ec-3b-deployment-record.md](ec-3b-deployment-record.md)).
**Governing decision:** **DEC-C32** (RATIFY-EC3-1, answered 2026-08-06).
**Freeze still binding:** [ec-3a-governance-freeze.md](ec-3a-governance-freeze.md).

---

## 1. The ratified authority model (DEC-C32)

Effitrans has **several quotation agents**. Internal approval belongs to the **Operations
Manager / Supervisor**.

| Role | Permissions | Meaning |
|---|---|---|
| **QUOTATION_MANAGER** *(the designated quotation-agent role)* | `quotation:create` · `quotation:send` · `quotation:approve` | prepares, sends, and records the customer's acceptance |
| **OPS_SUPERVISOR** | `quotation:validate` **only** | internal managerial validation before sending |
| **SYSTEM_ADMIN** | **none** | an administrator never manufactures a commercial authority |

**Semantics — confirmed against the shipped catalog, unchanged:**

* `quotation:validate` — *« Valider une cotation en interne avant envoi (autorité distincte
  de la préparation) »* — internal managerial validation.
* `quotation:approve` — *« Enregistrer l'acceptation du client (preuve), jamais une
  validation interne »* — records the **customer's** acceptance. **Not renamed, not
  reinterpreted.** The shipped code already means exactly this.

**Workflow:** agent prepares → submits for validation → supervisor validates or rejects →
agent sends the validated quotation → agent records customer acceptance with supported
evidence.

**Maker-checker preserved.** `constraint quotation_validator_differs check (validated_by
<> prepared_by)` stands, and under this model it is satisfied twice over: the validating
role holds no `quotation:create`, so a supervisor cannot prepare the quotation they
validate — the separation is now structural *and* role-level.

## 2. Pre-migration audit (required by DEC-C32, performed 2026-08-06)

Five surfaces were audited before any grant was designed. **One real gap was found.**

| # | Surface | Current state | Verdict |
|---|---|---|---|
| 1 | **Quotation RLS SELECT policies** | `quotation_request_select`, `quotation_select`, `quotation_line_select` each gate on `tenant_id = auth_tenant_id() AND has_permission('quotation:create')` | ❌ **GAP — must be corrected.** A supervisor holding only `quotation:validate` would see **nothing**, so they could not review what they are required to validate |
| 2 | **Service-level read gates** | every read in `lib/commercial/service.ts` uses `getAdminSupabaseClient()`, which **bypasses RLS**, and performs **no permission check**; nothing calls these functions yet | ⚠️ **must be added by EC-3C.** The RLS policy is a defence-in-depth boundary for direct PostgREST access, **not** the app's effective read gate — the app's gate is whatever the route/action layer enforces, and today that layer does not exist |
| 3 | **Route gates** | `app/commercial` does not exist; **no consumer of `lib/commercial` anywhere** | ✅ nothing to correct; EC-3C creates them |
| 4 | **Navigation visibility** | no quotation entry in `lib/nav.ts` | ✅ nothing to correct. `permissionsAnyOf` already exists and is the correct mechanism |
| 5 | **Assignment / queue visibility** | no quotation queue exists. `lib/process/effitrans-process.ts` step 1 declares `["quotation:create","quotation:send","quotation:approve"]` | ⚠️ the registry *declares* required authorities and does not grant; it should gain `quotation:validate`, since internal validation is now a real act in step 1 |

**Write-side gates already match the ratified model exactly — no action-layer change is
needed.** `validateQuotation` → `quotation:validate` · `sendQuotation` →
`quotation:send` · `recordCustomerDecision` and `recordConversion` → `quotation:approve` ·
prepare / lines / submit / revise / cancel → `quotation:create`. This was verified
function by function in `lib/commercial/actions.ts`.

### 2.1 The read-composition verdict

DEC-C32 asked whether the existing family can express safe visibility, and forbade
inventing `quotation:read` unless it cannot.

**It can.** The correction is to widen the three SELECT policies to:

```sql
using (tenant_id = public.auth_tenant_id()
       and (public.has_permission('quotation:create')
            or public.has_permission('quotation:validate')))
```

This admits exactly the quotation agents and the validating supervisors, and **nobody
else**. It satisfies the explicit instruction *not* to grant `quotation:create` to
OPS_SUPERVISOR merely to make quotations readable.

`quotation:send` and `quotation:approve` were **considered and deliberately excluded** from
the read predicate: under DEC-C32 no role holds either without also holding
`quotation:create`, so adding them would widen the read surface without admitting a single
additional legitimate reader. If a future decision splits those authorities onto a
separate seat, this predicate must be revisited — which is why the test below pins the
readers as an exact set rather than a floor.

**Contrast with DEC-C31**, where `finance:expense:read` *had* to be granted to signers who
"could not otherwise see what they sign": the expense family had no member that implied
visibility. The quotation family does. No new permission is created.

## 3. The smallest additive correction plan — migration 83

**Not authorised. Do not write this migration until explicitly told to.**

1. **Grants** — `quotation:create`, `quotation:send`, `quotation:approve` → QUOTATION_MANAGER;
   `quotation:validate` → OPS_SUPERVISOR. Nothing else, for nobody else.
2. **Read composition** — drop and recreate the three SELECT policies with the
   `create OR validate` predicate of §2.1. No other policy changes; INSERT/UPDATE/DELETE
   remain absent (all writes go through the SECURITY DEFINER RPCs).
3. **SYSTEM_ADMIN** — untouched, and pinned at **zero** quotation permissions by test.
4. **Mirror the grant at all three sources.** `supabase/seed.sql` **and**
   `lib/platform/role-templates.ts` must carry the same matrix as the migration. This is
   not optional bookkeeping: EC-3B proved that a grant present in only some of the three
   sources produces a database that disagrees with itself — the migration's revocation was
   cosmetic until all three matched, and CI caught it only because the RLS suite read the
   live grant count.
5. **Process registry** — add `quotation:validate` to step 1's declared permissions.

### 3.1 Tests that must change with it — and how

* **`tests/ec-3b-commercial.test.ts` — "the revocation holds at EVERY source" must become
  a MATRIX assertion, not an absence assertion.** Today it asserts that no quotation grant
  exists in the seed or the templates. Migration 83 makes some grants legitimate, so the
  contract must change to: *these exact roles hold exactly these permissions, and
  SYSTEM_ADMIN holds none.* Left as an absence check it would either fail correctly and be
  weakened under pressure, or be deleted — and deleting it would remove the only guard on
  the three-source rule. **This is the same lesson as the `information_schema` absence
  assertion:** an absence claim is a claim about every future phase; an exact-matrix claim
  is a claim about the ratified decision, and it survives.
* **`supabase/tests/rls_commercial_quotation_test.sql`** — the `legacy_grants` expectation
  changes from `0` to the ratified matrix, and **`admin_sees` must remain `0`**. Add the
  case the whole audit exists for: a **validate-only supervisor CAN read a quotation
  awaiting validation**, and a role holding neither `create` nor `validate` still sees
  nothing.

## 4. EC-3C scope (for authorisation, not for building now)

The workspace that makes the module reachable: a commercial route under a nested layout
(each frozen-sidebar workspace needs its own — Phase 7.2C), a request/quotation list, the
drafting studio, a **validation queue** for supervisors, send and acceptance capture, and
the navigation entry gated with `permissionsAnyOf: ["quotation:create", "quotation:validate"]`.

**Digital-LOS question, answered in advance:** EC-3C emits no new event type. Migration 82
already registered all ten `commercial` events, each emitted from inside its RPC;
EC-3C is a surface over acts that already emit. `QUOTATION_CONVERTED_TO_DOSSIER` remains
the keystone, carrying the dossier as subject.

## 5. Boundaries — unchanged from the freeze

No pricing rule · no tax rule · no Senegal regulation · integer minor units only · no
second PDF, numbering or communication engine · Commercial creates no dossier · no
duplicated Finance logic · no `quotation:read` · **no permission to SYSTEM_ADMIN**.

## 6. Still open (management, not operator)

**MD-Q3** — is validation required for *every* quotation or only above a threshold, and
who validates in a single-seat Operations department? DEC-C32 names **who** validates but
sets no threshold, and `validated_by <> prepared_by` means a lone seat cannot self-validate.
**MD-Q10** tax rates · **MD-Q11** numbering format confirmation · **MD-Q13** quoting a
prospect who is not yet a `client` · **MD-Q4/Q5/Q6/Q8/Q14/Q15** EC-3C/EC-3D scope detail.
