# OPS-SEC-2 — Privileged Function Trust-Boundary Architecture Audit

**Date:** 2026-08-08 · **AUDIT AND DESIGN ONLY.** No migration, no function body, no grant, no
policy, no application code, no role template and no production state was changed by this phase.

Measured live and read-only against the hosted database in its **post-OPS-SEC-1 state**
(migrations 90–92 applied). Every count below is from `pg_catalog`, not from migration text.

---

## 1. Executive verdict

**The platform already has a trusted identity model. The privileged RPC layer does not use it.**

`auth_tenant_id()`, `has_permission()` and `auth_portal_client_id()` all resolve identity from
`auth.uid()`, and 172 RLS policies depend on them. That model is sound and is not the problem.

The problem is that the privileged RPC layer sits *beside* it rather than on top of it. Of the
**50** non-trigger functions that accept an actor, tenant, user or organization identifier:

| In-database verification | Count |
|---|---|
| Reference `auth.uid()` | **0** |
| Call `has_permission()` | **0** |
| Validate the actor against `app_user` | **3** |
| Validate the tenant against `organization` | **0** |
| Call `get_user_permissions()` on the nominated actor | **1** |

**Not one of them verifies that the nominated actor holds the authority the operation requires.**
The database accepts the application's word about who is acting and for which tenant.

OPS-SEC-1 removed the *browser* from that trust relationship, which was the urgent half. What
remains is that the trust relationship itself is unverified — it is now merely unreachable from
outside. That is a materially better position and not a finished one.

**Verdict: NO-GO for implementation without ratification.** The design below is small and
mechanical, but it changes 48 function bodies and the failure mode of a wrong decision is a
production outage of exactly the kind OPS-SEC-1 already produced. §20 lists what needs deciding.

## 2. Architecture discovered

**148 functions in `public`**, all owned by `postgres`, all with a pinned `search_path`, **zero**
using dynamic SQL. Two populations that behave completely differently:

| Population | Count | Reachable over PostgREST? |
|---|---|---|
| Trigger functions (`returns trigger`) | **82** | **No** — not routable regardless of grants |
| Non-trigger functions | **66** | Yes, subject to EXECUTE |

Post-OPS-SEC-1 exposure of the **66** routable functions:

| | anon | authenticated |
|---|---|---|
| Reachable | **15** | **17** |
| …of which SECURITY DEFINER | **7** | **9** |

All 82 trigger functions still carry `anon` EXECUTE. That is **inert** — PostgREST will not route
a `trigger` return type, and calling one outside a trigger context has no `NEW`/`OLD` to act on.
It is hygiene, not exposure, and is called out here so a future audit does not re-raise it as P0.

**Two lanes exist, and only one is trusted:**

```
SESSION LANE  (browser)          SERVICE LANE  (server actions)
auth.uid()                       service_role key
  → auth_tenant_id()               → no session, auth.uid() IS NULL
  → has_permission()               → identity passed as p_actor / p_tenant
  → 172 RLS policies               → 48 privileged RPCs
  TRUSTED, derived                 UNVERIFIED, declared
```

## 3. Function classification counts

| Class | Count |
|---|---|
| Total functions in `public` | 148 |
| SECURITY DEFINER | 71 |
| SECURITY INVOKER | 77 |
| Trigger functions | 82 |
| Non-trigger (routable class) | 66 |
| Referenced directly by an RLS policy | 13 |
| In the full RLS dependency closure | **15** |
| Accepting caller-declared identity (non-trigger) | 50 |
| Referencing `business_event` | 34 |
| With a TypeScript caller | 49 |
| Called from a **client** component | **1** (`get_user_permissions`) |
| No TS caller, no DB caller, not in RLS closure | 3 |
| Missing `search_path` | **0** |
| Using dynamic SQL | **0** |
| Owned by anything other than `postgres` | **0** |

## 4. Call-graph findings — direct and transitive

**47 function-to-function edges.** Trust propagation classified per edge by the caller's security
mode, because that is what decides whose grants the inner call consults.

**INVOKER trust breaks (authenticated): 0.** The OPS-SEC-1 outage class is currently clean —
migration 92 closed the only instance. This audit's first job was to confirm that, and it does.

**INVOKER trust break (anon): 1** — `can_read_file → user_readable_file_ids`.
`can_read_file` is SECURITY INVOKER and `anon`-executable; `user_readable_file_ids` is not
`anon`-executable. An anonymous call to `can_read_file` therefore raises `42501` from inside
rather than returning `false`. **No policy path reaches it** (0 of 172 policies target `anon`), so
this is latent, not live — but it is the exact mirror of the outage and should be resolved by
revoking `anon` from `can_read_file`, not by granting anything. **P2.**

**RLS dependency closure: 13 direct → 15 transitive.** The two functions reachable only
transitively are precisely the interesting ones:

| Function | Depth | Note |
|---|---|---|
| `user_readable_file_ids(uuid,uuid)` | 1 | **The OPS-SEC-1 outage.** Invisible to a direct-reference audit. |
| `get_user_permissions(uuid)` | 1 | Reached via `has_permission()`, which 123 policies call. |

**This closure is machine-derivable in nine lines of SQL.** That it was not being computed is the
whole reason the outage happened, and it is the single highest-value CI check proposed in §15.

**DEFINER "privilege-laundering" edges: 13.** All 13 are trigger emitters calling
`emit_business_event`; one also calls `review_document`. Each is SECURITY DEFINER, so the inner
call executes as `postgres` and succeeds regardless of the caller's grants. **This is correct and
must not be "fixed"** — it is what keeps the WES-9A rule (a mandatory event aborts the domain
write) working. It is listed because a naive future sweep would read these as bypasses and break
event emission platform-wide.

## 5. Caller-declared actor findings

**39 non-trigger functions accept `p_actor`; 2 accept `p_user`.** Classified per the brief's
A/B/C/D scheme:

| Category | Count | Meaning |
|---|---|---|
| **A** — trusted context derived from session | **0** | No function derives its actor |
| **B** — an object being acted upon | — | (see §6; `p_user` in bulk membership is category B) |
| **C** — service-role supplied context | **48** | Legitimate lane, **unverified** |
| **D** — browser-reachable + caller-declared | **2** | `get_user_permissions(uuid)`, `user_readable_file_ids(uuid,uuid)` |

**Category D detail.** Neither is a privilege-escalation path today, and both should be recorded
as understood rather than alarming:

- `get_user_permissions(uuid)` — SECURITY **INVOKER**, so RLS on `user_role`
  (`tenant_id = auth_tenant_id()`) confines it to the caller's own tenant, and `anon` resolves no
  tenant at all. Residual: a user may read a same-tenant colleague's permission codes. **P2.**
- `user_readable_file_ids(uuid,uuid)` — SECURITY DEFINER and therefore RLS-bypassing, and it
  takes both the user and the tenant as arguments. `authenticated` holds EXECUTE **because
  migration 92 had to restore it** to keep `can_read_file` working. An authenticated user can
  therefore ask "which files can *this other* user read". **P1** — and the reason the OPS-SEC-2
  design should make `can_read_file` SECURITY DEFINER so this grant can be withdrawn again.

**Category C is the architectural finding.** 48 functions where the actor is whatever the caller
says. The application does gate correctly — `assertPermission()` runs in TypeScript before these
calls — but the database has no way to confirm it happened, and no way to tell a legitimate
service-role call from a forged one if the key ever leaks or a new call site simply forgets.

## 6. Caller-declared tenant findings

**41 non-trigger functions accept `p_tenant`.** How they use it is the distinction that matters:

| Use of the tenant argument | Count | Security value |
|---|---|---|
| Filters a target row (`tenant_id = p_tenant`) | **33** | **Containment.** Wrong tenant ⇒ row not found ⇒ operation fails. |
| Written as a value, never filtered | **8** | **None.** Wrong tenant ⇒ silently *recorded* as fact. |

The 8 in the second group are the six `next_*_number(p_tenant)` counters plus
`finalize_official_invoice` and **`emit_business_event`**. For counters the tenant is legitimately
the key being written. For `emit_business_event` it is the tenant attribution of an append-only
evidence row.

**Containment is not authority.** A function that filters by `p_tenant` cannot cross tenants, which
is genuinely valuable — but it still cannot tell whether the caller was entitled to act for that
tenant at all. `organization` is validated by **zero** functions.

## 7. SECURITY DEFINER findings

71 functions. Assessed against the brief's five questions:

- **Is DEFINER necessary?** For the 82 trigger emitters and the privileged RPCs, yes — they must
  bypass RLS to write evidence and cross-table state. Mechanical conversion is **not** recommended
  and would break the WES-9A abort semantics (§4).
- **Would INVOKER work?** Only for pure predicates. The notable inversion is `can_read_file`,
  which is INVOKER and **should become DEFINER** — that is the clean fix for the transitive
  dependency, and it lets `user_readable_file_ids` lose its `authenticated` grant (§5).
- **Is browser execution required?** For the privileged set, no — OPS-SEC-1 established that 23 of
  24 RPC-calling modules use the service-role client. Only `get_user_permissions` needs the
  browser.
- **Is the owner appropriate?** All 71 are owned by `postgres`, consistently. No mixed ownership.
- **Is `search_path` pinned?** **All 71.** Zero rely on a caller-controlled path, zero use dynamic
  SQL. This dimension is clean and needs no work.

## 8. SECURITY INVOKER findings

77 functions. The class is safe by default — RLS applies — but carries one sharp edge, which is
the OPS-SEC-1 outage in general form:

> **An INVOKER function is only as callable as everything it calls.**
> Its dependencies must be executable by every role that can reach it, transitively.

Currently violated once, for `anon` only, latently (§4). The rule belongs in CI (§15) rather than
in reviewers' heads, because it is invisible to direct-reference analysis and was already missed
once by a careful audit.

## 9. RLS helper findings

**7 SECURITY DEFINER policy helpers remain `anon`-executable.** All are non-mutating predicates;
all were probed as `anon` during OPS-SEC-1 closure and **all returned `false`**.

| Helper | Policy refs | Resolves identity via |
|---|---|---|
| `portal_can_read_file(uuid)` | 8 | `auth.uid()` |
| `portal_can_read_shipment(uuid)` | 6 | `auth.uid()` |
| `messaging_staff_can_access_conversation(uuid)` | 4 | `auth.uid()` + `has_permission` |
| `messaging_portal_can_access_conversation(uuid)` | 3 | portal identity (JWT-derived) |
| `portal_can_read_invoice(uuid)` | 3 | portal identity (JWT-derived) |
| `is_assigned_driver(uuid)` | 2 | `auth.uid()` |
| `can_read_task(uuid)` | 1 | `auth.uid()` |

**Assessment: `anon` EXECUTE is not required by any of them.** 0 of 172 policies target `anon`, so
no policy evaluation ever runs as `anon`. They are inert rather than needed, and the grant is a
leftover from preserving the helper set wholesale during a P0.

**Recommendation: revoke `anon`, preserve `authenticated`** — a strict narrowing, no new
permission. **P2, and explicitly not done in this phase.**

## 10. business_event trust analysis

`business_event` is append-only under `prevent_mutation()`. **A forged event cannot be deleted.**
Preventing false attribution therefore matters more than any repair path, which is why this
section is separated from the rest.

- **34 functions** reference `business_event` — 13 trigger, 21 non-trigger.
- **32 in-database callers** of `emit_business_event`. **All 32 are SECURITY DEFINER** — zero are
  INVOKER. That is the correct shape and worth pinning in CI before it drifts.
- **21 emitters accept `p_actor`; 15 accept `p_tenant`.**
- `emit_business_event` itself **writes** the tenant it is handed and never filters by it (§6).

**Every attributable field of an evidence row — actor, tenant, source, event type, subject — is
supplied by the caller and validated by nothing.** The envelope check inside `emit_business_event`
is a *structural* one (NOT NULL on type/domain/source/subject) and correctly aborts the domain
write on a malformed envelope; it makes no claim about truthfulness.

Today this is contained: reaching the emitter requires `service_role`. The exposure is that the
integrity of the entire Decision Plane rests on application discipline, and the ledger's own
immutability guarantees that a mistake is permanent.

**Design consequence:** the actor/tenant pair written into `business_event` must be *verified* at
the point of emission, not merely *passed*. §13 proposes exactly that.

## 11. Existing safe patterns worth standardizing

These already exist, work, and should become the house standard rather than being reinvented:

1. **The session-derived identity trio** — `auth.uid()` → `auth_tenant_id()` → `has_permission()`.
   Backs 172 policies. This *is* the platform's actor model.
2. **`assertPermission(code)` in TypeScript** — the server-side gate every action already uses.
3. **The EMP-3 `comm_*` privilege shape** — `service_role` only, `PUBLIC`/`anon`/`authenticated`
   revoked on the exact identity signature. Already the reference pattern, applied by 90–92.
4. **Tenant-as-filter (`tenant_id = p_tenant`)** — used by 33 functions. Real containment; keep it
   and add authority on top rather than replacing it.
5. **DEFINER emitters called from triggers** — preserves WES-9A abort semantics. Do not disturb.
6. **The persona test convention** — `set_config('role', …)` + `request.jwt.claims`, already used
   by **70 of 75** SQL suites. The behavioural harness in §14 extends this rather than replacing it.
7. **Pinned `search_path` on every DEFINER function** — 71/71. Already correct.

## 12. Unsafe patterns that must be retired

1. **Actor as an ordinary argument with no verification** — 48 functions. The database cannot
   distinguish a legitimate nomination from a forged one.
2. **Tenant written rather than checked** — 8 functions, including the evidence emitter.
3. **Authority asserted only in TypeScript** — correct today, unprovable in the database, and
   silently lost the moment a new call site forgets.
4. **INVOKER helpers with privileged dependencies** — one instance left (`can_read_file`), and the
   pattern that caused the outage.
5. **A SECURITY DEFINER function taking the user as an argument and bypassing RLS to answer for
   them** — `user_readable_file_ids`. Currently required by migration 92; §13 removes the need.
6. **Grants preserved wholesale during an emergency** — the 7 `anon` helper grants. Correct under
   P0 time pressure, wrong as a permanent state.

## 13. Proposed canonical privileged-operation architecture

**One identity model, two lanes, verified at the boundary.** Design only.

The insight is that the service lane exists for a real reason: with a `service_role` key there is
no JWT, so `auth.uid()` is NULL and `has_permission()` cannot work. Nomination is therefore
*necessary*. It does not follow that nomination must be *unverified*.

**Proposed primitive — `public.assert_actor(p_actor uuid, p_tenant uuid, p_permission text)`:**

| Condition | Behaviour |
|---|---|
| `auth.uid() IS NOT NULL` (session lane) | Require `p_actor = auth.uid()` **and** `p_tenant = auth_tenant_id()` **and** `has_permission(p_permission)`. A browser caller can never nominate anyone but itself. |
| `auth.uid() IS NULL` (service lane) | Verify `p_actor` exists in `app_user` with `tenant_id = p_tenant` and an active status, **and** holds `p_permission` via `get_user_permissions(p_actor)`. A forged actor/tenant pair fails. |
| System action (no human actor) | `p_actor IS NULL` permitted **only** with an explicit system source marker. Never a silent default — an unattributed event must be unattributed *on purpose*. |

This is **not a second identity architecture**. It is the same `auth.uid()` / `app_user` /
`get_user_permissions` model, made usable in the lane that currently has no access to it. It works
inside a DEFINER function because the owner (`postgres`) bypasses RLS and can therefore resolve
any nominated actor's permissions.

**Application to each population:**

- **48 Category-C RPCs** — begin with `perform public.assert_actor(p_actor, p_tenant, '<perm>');`.
  Converts trusted nomination into verified nomination. Tenant-as-filter stays as defence in depth.
- **`emit_business_event`** — the evidence boundary. Its `(p_tenant_id, p_actor_user_id)` pair must
  be verified as a real pair before insertion, so forged attribution becomes impossible rather than
  merely unreachable. Because 32 DEFINER callers already assert at their own entry point, the
  emitter's check can be the cheaper "is this a real (user, tenant) pair" rather than a full
  permission assertion — decided at ratification.
- **`can_read_file`** — convert to SECURITY DEFINER. Its inner call then runs as owner, the
  transitive dependency disappears, and `user_readable_file_ids` can have its `authenticated`
  grant withdrawn — retiring both §12.4 and §12.5 with one change.
- **The 7 `anon` helpers** — revoke `anon`, preserve `authenticated`.
- **`can_read_file` `anon` grant** — revoke, resolving the last INVOKER trust break.

## 14. Proposed persona-based behavioural test architecture

Extends the existing convention (70 of 75 suites already use it); it does not introduce a second
harness.

**Personas** — a shared SQL fixture establishing each, so no suite hand-rolls them:

| Persona | Established by |
|---|---|
| `anon` | `set_config('role','anon')`, no claims |
| authenticated **without** the permission | role + `request.jwt.claims.sub` |
| authenticated **with** the permission | role + claims |
| **cross-tenant** authenticated | role + claims for tenant B |
| `MAIL_ADMIN` / operational roles / `SYSTEM_ADMIN` | role + claims |
| `service_role` | `set_config('role','service_role')` |
| owner / internal trigger execution | default `postgres` |

**Tests must assert outcomes, never `has_function_privilege` alone.** That function was green
throughout the OPS-SEC-1 outage — every metadata assertion passed while production was broken.

**Detection matrix the harness must cover:**

| Must detect | Assertion shape |
|---|---|
| Direct unauthorized RPC execution | persona calls RPC → expect `42501` **before** body effects |
| **Transitive INVOKER dependency failure** | persona *evaluates a policy* → expect rows, not `42501` |
| SECURITY DEFINER privilege bypass | non-privileged persona → expect 0 rows changed |
| Caller-forged actor | service lane, actor lacking the permission → expect refusal |
| Caller-forged tenant | actor of tenant A nominating tenant B → expect refusal |
| Cross-tenant mutation | expect 0 rows changed **and** 0 events emitted |
| False `business_event` attribution | expect no row with the forged `(actor, tenant)` |
| Privilege regression after a migration | the catalog invariants of §15 |

Every probe must be **zero-effect by construction or transaction-scoped**, and the reason must be
stated in the test — the OPS-SEC-1 incident recorded a probe whose inertness came from a foreign
key rather than from design.

## 15. Proposed CI enforcement architecture

**Derive from `pg_catalog`; hand-maintain only what cannot be derived.** The existing tenant-table
registry is the cautionary tale: hand-maintained, and silent on 63 of 140 tables.

**Four invariants, all computable, none requiring a hand-written list:**

1. **RLS closure executability.** Compute policy → helper → transitive dependencies, assert every
   member is executable by `authenticated`. *Would have caught the OPS-SEC-1 outage before deploy.*
2. **No INVOKER trust break.** For every role R: no SECURITY INVOKER function executable by R may
   call a function not executable by R. *Already live as migration 92's assertion 3; promote it to
   a standing suite covering `anon` too.*
3. **No unclassified privileged function.** Every non-trigger SECURITY DEFINER function must appear
   in the classification registry, which stores **only** the non-derivable decision — intended
   caller class. Everything else (secdef, grants, search_path, mutation, emission) is read from the
   catalog. A new function fails CI *on the commit that adds it*, naming itself.
4. **No unguarded caller-declared identity.** A function accepting `p_actor`/`p_tenant`/`p_user`
   must call `assert_actor`, or be listed with a stated reason. This is the invariant that stops
   the architecture regressing one merge at a time.

Plus a **browser-exposure guard**: no non-trigger SECURITY DEFINER function may gain `anon` or
`authenticated` EXECUTE without an entry explaining why — the P0 in permanent form.

## 16. Remediation, categorized

**P0 — none.** OPS-SEC-1 closed the exploitable path; nothing here is reachable without
`service_role`. This is a hardening phase, not an incident.

**P1 — unverified nomination (the architecture).**
- 48 Category-C RPCs: adopt `assert_actor`.
- `emit_business_event`: verify the `(actor, tenant)` pair at the evidence boundary.
- `can_read_file` → SECURITY DEFINER; then revoke `authenticated` from `user_readable_file_ids`.

**P2 — narrowing and hygiene.**
- Revoke `anon` from the 7 policy helpers (§9).
- Revoke `anon` from `can_read_file`, closing the last INVOKER trust break (§4).
- `get_user_permissions`: constrain `p_user` to `auth.uid()` (same-tenant colleague disclosure).
- 82 trigger functions carry `anon` EXECUTE — inert, but removable.
- 3 functions with no caller of any kind (`auth_is_platform_admin`, `has_role`,
  `supersede_document`): confirm dead by runtime evidence before proposing removal. Repository
  absence is not proof.

## 17. Compatibility and breakage analysis

The honest risk is that this phase's fix breaks production the way the last one did.

| Change | Breakage risk | Why |
|---|---|---|
| `assert_actor` on 48 RPCs | **Highest.** Any call site whose TS gate uses a *different* permission than the DB assertion starts failing. | The two gates were never required to agree; some certainly do not. |
| System/background actions | High | Any path with no human actor breaks unless the NULL-actor case is settled **first**. |
| `can_read_file` → DEFINER | Low | Removes a dependency rather than adding one; behaviour identical for legitimate callers. |
| Revoking `anon` from helpers | Low | 0 of 172 policies target `anon`; all 7 return `false` today. |
| `emit_business_event` verification | **Medium-high** | It is on the write path of 32 callers, and WES-9A means a failure **aborts the domain write**. A false rejection is an outage. |
| Revoking `anon` from triggers | Very low | Not routable. |

**Two structural constraints, both already recorded:**
- **CI cannot reach data-dependent migration paths** — its `organization` table is empty when
  migrations run, so any `assert_actor` logic needing real rows is unprovable there and must be
  covered by the persona suites instead.
- **Ledger repair is the last step**, after physical verification — not part of applying.

## 18. Migration strategy — design only

Expand → activate → contract, one module at a time. Never platform-wide in a single migration.

1. **Expand.** Add `assert_actor` alone. Additive, called by nothing, no behaviour change.
2. **Prove.** Persona suites (§14) for the primitive itself, including the service lane, the
   session lane, the cross-tenant refusal and the NULL-actor system case.
3. **Activate, per module** (quotation, HR, documents, customs, finance, EC…). Each batch: adopt
   `assert_actor`, add persona tests for that module, land, verify CI green with **zero skipped**,
   deploy, verify physically. A batch that breaks is one module, not the platform.
4. **Contract.** Once the session lane is proven, remove `p_actor` where `auth.uid()` can supply
   it. This is where signatures change, so it comes last and never mixes with activation.
5. **Enforce.** Turn on the §15 invariants as each becomes satisfiable, so the architecture cannot
   regress behind the work.

`emit_business_event` should be **last**, not first, despite being the most valuable: it is on 32
write paths and a false rejection aborts real domain writes.

## 19. Rollback strategy — design only

- **Privilege-only changes** (P2 revokes) roll back by re-granting. No data, no bodies. Proven
  twice already.
- **Body changes** (P1) are forward-only: rollback is a new migration restoring the prior
  definition. The prior body must therefore be recoverable — from git, and named in the migration
  header, so a rollback does not require archaeology under pressure.
- **`can_read_file` → DEFINER** rolls back by restoring INVOKER **and** re-granting
  `user_readable_file_ids` to `authenticated`. **Both, or the outage returns** — this is exactly
  the coupling that caused it, and it must be written down beside the change rather than
  rediscovered.
- **Per-module activation** keeps each rollback scoped to one module.

## 20. Ratifications required before implementation

1. **RATIFY-OPSSEC2-1 — adopt `assert_actor`** as the canonical guard, with the §13 semantics
   (session lane forbids nomination; service lane verifies it).
2. **RATIFY-OPSSEC2-2 — system-actor representation.** NULL actor plus an explicit source marker,
   or a reserved system principal? This blocks everything else: every background path depends on
   it, and guessing it wrong breaks them all.
3. **RATIFY-OPSSEC2-3 — the evidence boundary.** Does `emit_business_event` perform a full
   permission assertion, or the cheaper "is this a real (user, tenant) pair", given that its 32
   callers will already have asserted?
4. **RATIFY-OPSSEC2-4 — `can_read_file` → SECURITY DEFINER**, and the subsequent withdrawal of
   `authenticated` from `user_readable_file_ids`.
5. **RATIFY-OPSSEC2-5 — P2 narrowing:** revoke `anon` from the 7 policy helpers and from
   `can_read_file`.
6. **RATIFY-OPSSEC2-6 — CI enforcement scope:** which of the four invariants become blocking, and
   the registry's shape (derived-by-default, hand-written only for intended caller class).
7. **RATIFY-OPSSEC2-7 — sequencing against OPS-TENANT-1.** They overlap: both concern
   tenant-authority provenance, and 63 tenant tables are currently invisible to the scope guard.
   Deciding which leads avoids doing the tenant model twice.

**Disclosure note.** Nothing in this document is externally exploitable: every function discussed
is `service_role`-only or an inert predicate returning `false`, and the P0 was closed by
migrations 90–92 and verified. The enumerated material OPS-SEC-1 withheld is therefore no longer
sensitive, and this audit is published in full rather than redacted.
