# OPS-SEC-1 — Hosted Supabase RPC Exposure Audit

**Date:** 2026-08-08 · **Documentation only.** No migration, no privilege change, no function
change, no policy change, no application change was made in this phase.

**Original verdict: NO-GO for silent remediation — GO for an expedited P0 fix on ratification.**
Both ratifications were granted. **OPS-SEC-1 is now CLOSED** — migrations 90–92 applied and
verified; see `ops-sec-1-incident-report.md`, which also records five process failures that
occurred during the remediation. §9 is kept as written for the record.

---

## 0. Disclosure control — read this first

This audit found a **live, unremediated P0** in the production database.

**This repository is public.** The complete inventory — the enumerated function list, the
proof-of-concept request, and the ready-to-run `REVOKE` script — is therefore **deliberately
withheld from this document**. Published here, before the fix, it is a target list.

The withheld material exists in full and is available privately. It contains:

- the 148-row inventory with live ACLs and effective privileges per role;
- the enumerated P0 function list with exact identity signatures;
- the zero-effect probe and its result;
- 47 exact `REVOKE`/`GRANT` statements, ready to become a migration.

**RESOLVED 2026-08-08.** Remediation is deployed and independently verified (migrations 90–92;
CI run `31280066280` #399, 82/0/0 + 10/0/0). The exact signatures now live in those migration
files, so the withheld list is no longer withheld — it describes a **closed** defect.

Exposure window, recorded honestly: commit `01ac1bc` published the exact target list while the
repository was still public **and the hole was still open**. See
`ops-sec-1-incident-report.md` §3. The repository remained public at the time of writing.

What is *not* withheld: the function bodies themselves are **already public** in
`supabase/migrations/`. Anyone can read them and see that they take an actor as a parameter and
check no caller identity. The increment this audit adds — and the reason to withhold — is the
confirmation that the corresponding grants are open in production **right now**.

## 1. Method, and what makes it different from a source review

The brief required five things be kept apart: declared grants, inherited `PUBLIC`, explicit
hosted grants, effective capability, and internal authorization. They were separated as follows.

| Question | Source of truth used |
|---|---|
| Declared / hosted grants | `pg_proc.proacl` via `aclexplode`, per grantee OID |
| Inherited `PUBLIC` | `aclexplode` grantee `0`, **plus** `proacl IS NULL` (implicit grant) |
| Effective capability | `has_function_privilege(role, oid, 'EXECUTE')` |
| Internal authorization | `pg_proc.prosrc` — read, not inferred from naming |
| Reachability | PostgREST routing, confirmed against a real deployment |

Both ACL inspection **and** `has_function_privilege` were used, because neither alone is
sufficient: `has_function_privilege` cannot be asked about `PUBLIC` (it is not a login role), and
the ACL alone does not resolve inheritance. That asymmetry is exactly the trap EMP-3 hit, and it
is why this audit was run against the **hosted** database rather than a local one.

**Live verification was performed** against the linked production project, read-only, via the
Management API. Every statement below is measured, not inferred from migration text.

Behavioural probing during **this audit** was limited to **zero-effect** calls — a call whose
first statement raises before any read, any write and any event emission. Nothing was mutated and
no business record was touched.

Correction, added at closure: a **later** probe run during remediation (not during this audit) hit
`next_quotation_number`, which has no such early guard and does write. It was stopped by a
foreign-key violation on a nonexistent sentinel tenant. No data was modified, but its inertness
came from a different mechanism than the one claimed here. Recorded in
`ops-sec-1-incident-report.md` §7.

## 2. Inventory summary

148 functions in `public` (the only PostgREST-exposed application schema). Classified per the
brief's A–F scheme:

| Class | Count | Meaning |
|---|---|---|
| Trigger functions | 82 | Return `trigger`; **not RPC-reachable** regardless of grants |
| **D — service-role only** | **48** | Called exclusively by server-side service-role code |
| B — RLS helper | 13 | Referenced by RLS policy expressions; **must** stay executable by `authenticated` |
| E — unreferenced | 4 | No caller anywhere in the repository |
| B — browser-called | 1 | `get_user_permissions`, the only RPC the browser calls |
| A — public/anonymous intended | **0** | No function has a stated reason to be anonymous |
| F — unsafe/ambiguous | 0 | Every function's intended caller was determinable |

**71 of the 148 are `SECURITY DEFINER`.** All are owned by `postgres`, and the tables they write
do **not** use `FORCE ROW LEVEL SECURITY` — so within those functions, RLS is bypassed entirely.

**Search-path review: clean.** Every one of the 71 `SECURITY DEFINER` functions sets an explicit
`search_path`. Zero rely on a caller-controlled path. No dynamic SQL was found in the privileged
set. **No change required** — this is the one dimension the platform already gets right.

## 3. The P0 finding

**A large class of privileged RPCs is executable by the anonymous role, and enforces no caller
authorization whatsoever.**

The shape, which is uniform across the class:

- `SECURITY DEFINER`, owner `postgres` — therefore **RLS-bypassing**;
- accepts the acting user **and the tenant** as ordinary parameters (`p_actor`, `p_tenant`);
- resolves **no** identity from session context — no `auth.uid()`, no `auth.jwt()`;
- performs **no** permission check — no `has_permission`, no platform-admin check;
- **mutates** business state, and many **emit `business_event`**;
- carries an explicit `EXECUTE` grant to `anon` **and** `authenticated`.

The only checks these functions perform are **business-rule** checks — status must be in the
right state, a validator must differ from a preparer. Those are integrity rules. **They are not
authorization**, and the brief is explicit that tenant data being touched somewhere does not make
a function safe.

**The caller declares who they are, and the function believes them.**

Two aggravating factors:

1. **Forged evidence is permanent.** The decision-plane ledger is append-only and protected by
   `prevent_mutation()`. That invariant is correct and must not be weakened — but it means events
   inserted by an unauthorized caller **cannot be deleted**. The integrity guarantee that makes
   the ledger trustworthy also makes poisoning irreversible.
2. **Reachability is proven, not assumed.** The application itself calls a `public` RPC from
   browser code, so PostgREST RPC routing over the public key is demonstrably live.

**Mitigating factor, stated honestly:** exploitation requires knowing UUIDs (tenant, and the
subject row). These are 122-bit and not guessable. That raises cost — it is **not** a control.
UUIDs leak through portal URLs, generated PDFs, e-mail bodies and referrer headers, and the
platform's own documents carry them.

**Severity: P0.** Not because it is easy, but because the only thing standing between an
anonymous caller and authenticated-grade mutation of another tenant's records is the secrecy of
an identifier the system distributes on purpose.

## 4. What is NOT vulnerable — findings that cleared

Recording these matters as much as the failures, because they narrow the fix.

- **The four EMP-3 `comm_*` functions are correctly hardened.** `anon` and `authenticated` cannot
  execute them; `service_role` can. They are the **reference pattern** for this remediation.
- **`provision_tenant` and `user_can_read_mailbox` are correctly scoped.** `user_can_read_mailbox`
  shows the right shape for an RLS helper: `anon` denied, `authenticated` allowed.
- **Zero of 172 RLS policies target `anon` or `PUBLIC`.** At table level, `anon` can already read
  nothing. Functions are the *only* hole — which is what makes the fix tractable.
- **`get_user_permissions` is `SECURITY INVOKER`, not `DEFINER`.** It trusts its `p_user`
  argument, but RLS on `user_role` (`tenant_id = auth_tenant_id()`) constrains it to the caller's
  own tenant, and `anon` resolves no tenant at all. Cross-tenant disclosure is blocked. Reading a
  same-tenant colleague's permission codes remains possible — **P2**, not P0.
- **Search path: clean across all 71 `SECURITY DEFINER` functions** (§2).

## 5. Breakage analysis — why this fix is small

Every RPC call site in the repository was mapped to the client it uses.

| Caller client | Modules | Consequence of revoking `anon` + `authenticated` |
|---|---|---|
| Service-role admin client | **23 of 24** | **None.** `service_role` grants are untouched. |
| User session client | 1 (`get_user_permissions`) | Would break — **excluded from the revoke**. |

**23 of 24 RPC-calling modules already use the service-role client.** The privileged surface is
not called by browsers or by session-scoped server code at all. Revoking `anon` and
`authenticated` from it therefore has **no deployed call site to break**.

The one genuine breakage risk runs the other way, and is the reason this needed measuring rather
than assuming: **13 functions are referenced inside RLS policy expressions** and are evaluated
*as the calling role*. `auth_tenant_id` alone backs 135 policies across 130 tables;
`has_permission` backs 123 across 119. Revoking `authenticated` from those would not harden the
platform — it would break every policy that calls them. **They are excluded from the revoke.**

## 6. Item A — confirmation tokens and fingerprints

| Identifier | Binds | Verdict |
|---|---|---|
| Bulk preview fingerprint (`lib/ec/mailboxes/bulk.ts`) | mailbox, capabilities, eligibility filter, decisions | **Adequate.** Actor and tenant are bound *implicitly* — the server recomputes under the session's own gate and tenant, so they cannot be supplied. Recommend folding tenant in explicitly as defence in depth. |
| Send idempotency key (`lib/comms/compose.ts`) | the message row id only | **Adequate for its purpose** (retry must reuse the identity, by ratification). **Open question:** it does not bind message *content*, so if a queued message's body could change between attempts, a retry would reuse the key with different content. Needs confirming that status gating makes that unreachable. |
| Expense content digest (`lib/finance/expense/hash.ts`) | docType, version, canonical snapshot | **P2.** Binds content but **not tenant or document identity**. Two documents in different tenants with identical fields digest identically, so a visa's recorded hash attests to *content*, not to *this document*. The relational FK carries identity today; recommend folding `tenant_id` and the document id into the digest. |

This is the same defect class as the EMP-4A fingerprint fixed in `fccb033`: **an identifier
derived from a projection, where the underlying requested authority can differ.** The general
lesson is recorded there — a test suite that pins outcomes cannot catch an under-specified
identifier, because every outcome it asserts is correct.

## 7. Item B — tenant-scope registry completeness

Measured against the live schema.

| Measure | Count |
|---|---|
| Base tables in `public` carrying `tenant_id` | **140** |
| Entries in `TENANT_SCOPED_TABLES` | 83 |
| Entries that are **not** live tenant tables | 6 |
| **Tenant tables MISSING from the registry** | **63** |

The registry covers roughly **55%** of tenant-owned tables. The service-role tenant-scope guard
only checks tables it knows about, so for the missing 63 it is not failing — it is **silent**.

The omission spans whole modules: the entire HR suite (~35 tables), aging reports, messaging
(`conversation`, `message`, `message_attachment`), commercial (`quotation`, `quotation_line`,
`quotation_request`), legacy import, brand assets and the tenant rollout tables. The seven `ec_*`
tables found during EMP-4A were one slice of a much larger hole.

Six entries point the other way — listed in the registry but carrying no `tenant_id` live
(`organization`, `permission`, `role_permission`, `platform_admin`, `document_type`,
`expense_template`). `scopedFrom()` on any of those would emit a filter on a column that does not
exist. Latent, not currently triggered.

**Smallest durable design that turns omission into a failing test** — recommended, not built:

> A test asserts `TENANT_SCOPED_TABLES` equals the set of tables carrying `tenant_id` **derived
> from the migration DDL**, which is already the registry's declared source of truth. A new
> tenant table then fails CI on the commit that adds it, naming itself, rather than joining a
> silent backlog. The registry stays a hand-maintained file — deliberately, per its own header,
> since generated types are a stopgap that drifts — but it stops being *unverified*. Reviewed
> exceptions move into an explicit keyed map with a stated reason, exactly as
> `KNOWN_UNSCOPED_READS` already does for reads.

Backfilling the 63 will surface unscoped reads. That work is **not** in the P0 path and should be
sequenced separately, module by module, so each batch of findings can be judged on its merits.

## 8. Remediation plan

Grouped by priority. **No migration was written in this phase.**

**P0 — close the anonymous execution path.**
Revoke `EXECUTE` from `PUBLIC`, `anon` and `authenticated` on the privileged, service-role-only
RPC set; grant `EXECUTE` to `service_role` explicitly. This mirrors the EMP-3 pattern exactly,
including revoking from all three (revoking `PUBLIC` alone does **not** remove hosted Supabase's
explicit role grants). Exact identity signatures are prepared and held per §0. No function body
is modified, so no behaviour changes for any legitimate caller.

**P1 — remove caller-supplied authority.**
Revoking the grant closes the door; it does not fix the design. These functions should resolve
the actor from session context, or be documented as service-role-only contracts whose caller has
already authorized the action. This is a larger change touching function bodies and their call
sites, and should be its own phase.

**P2 — hygiene.**
`get_user_permissions` should constrain `p_user` to `auth.uid()` (§4). The expense digest should
bind tenant and document identity (§6). The four unreferenced functions should be confirmed dead
by runtime evidence before removal is proposed — repository absence alone is not proof.

**No change required:** search paths (all 71 clean), the four EMP-3 functions, `provision_tenant`,
`user_can_read_mailbox`, and the 13 RLS helpers' `authenticated` grants.

**Rollback strategy.** A privilege-only migration is reversible by re-granting; no data is
touched and no body is altered. The real risk is over-revoking, which is why the RLS helper set
and `get_user_permissions` were measured rather than assumed. Behavioural assertions should prove,
in CI, that `service_role` retains EXECUTE, that `anon` and `authenticated` lose it, and — the
assertion that would have caught this years ago — that the RLS helpers **keep** it.

## 9. GO / NO-GO

**NO-GO for remediation without ratification.** Two decisions are not mine to make:

1. **RATIFY-OPSSEC-1 — expedited P0 fix.** The P0 is live. The fix is privilege-only, has no
   deployed call site to break (§5), and mirrors a pattern already proven in EMP-3. It should not
   wait for the P1 redesign. **Recommended: approve, and deploy ahead of the usual phase cadence.**
2. **RATIFY-OPSSEC-2 — disclosure handling.** This document is redacted because the repository is
   public and the finding is live (§0). Either make the repository private, or accept that the
   full audit lands once remediation is deployed. **Recommended: remediate first, then publish.**

**GO** for the P0 fix immediately on ratification of (1).

Not begun, per instruction: EMP-4B, EMP-5. No application feature was changed in this phase.
