# EC-1 + EC-2 — Deployment Record

**Date:** 2026-08-05 · **Production:** `xtpppzhkiagdpmnghdlc` · **Ledger: 81/81**
**Migrations:** 80 `20260804000001_ec_inbound_foundation.sql` ·
81 `20260805000001_ec_triage_outcomes.sql` · **Verdict: PASS**

---

## 1. CI gate — satisfied before application

Run **`30758769202`**, commit **`91ad948`**:

| Job | Conclusion | Steps | Skipped | Failed |
|---|---|---|---|---|
| `build` | **success** | 10 | **0** | 0 |
| `rls-tests` | **success** | **74** | **0** | 0 |

Both suites confirmed **by name**: `Run EC-1 inbound email isolation test` — success ·
`Run EC-2 triage outcomes isolation test` — success. Zero skipped was asserted per step,
not inferred from the job summary.

**One red run preceded it, and the failure was a cross-suite fixture regression, not a
schema defect.** On `fc88633`, migration 81's new `ec_triage_outcome_guard` — which
applies to *every* writer of `ec_triage_item`, not only EC-2's RPCs — rejected a bare
`update … set status = 'RESOLVED'` in **EC-1's** suite (`EC611`), aborting it and
**skipping EC-2's suite behind it**. Fixed by recording an outcome in EC-1's fixture
rather than relaxing the rule: `RESOLVED` must carry a decision, and EC-1's own subject
(the trigger-level status machine and its terminal states) is unchanged.

*Note on the reported line number:* the operator saw `rls_ec_inbound_test.sql:244`, which
is the `end $$;` of the DO block — psql reports an unhandled exception at the block
terminator, not at the failing statement (line 164).

**Migration content never changed:** `git diff --name-only fc88633 91ad948 --
supabase/migrations/` returns **0 files**. What CI validated is byte-identical to what
was deployed.

**Regression class closed:** the EC-2 vitest now reads every `.sql` suite and fails on
any `ec_triage_item` resolution recording no outcome, with `EXPECT-FAIL` markers
distinguishing deliberate negatives. It caught its own author's negative test on the
first run.

## 2. Independent production verification

Performed read-only against the linked project. **Project ref confirmed
`xtpppzhkiagdpmnghdlc` before any command** (INC-HR3-01 discipline).

### 2.1 Migration ledger — PASS

`supabase migration list --linked`, parsed:

| Check | Result |
|---|---|
| Total rows | **81** |
| Local / Remote | 81 / 81 |
| Mismatched (local xor remote) | **none** |
| Last four remote | `20260803000001`, `20260803000002`, **`20260804000001`**, **`20260805000001`** |

Both EC migrations are recorded. **Migrations 80 and 81 are reconciled at 81/81.**

### 2.2 Tables — PASS (6/6)

All EC tables present: `ec_mailbox` · `ec_webhook_event` · `ec_inbound_message` ·
`ec_inbound_attachment` · `ec_triage_item` · `tenant_ec_inbound_rollout`.
Control group (`employee`, `operational_file`, `business_event`, `client`) all present —
the probe is proven before its result is trusted.

### 2.3 Indexes — PASS (11/11)

**Migration 80 (9/9):** `uq_ec_mailbox_address` (the global-uniqueness invariant that
makes routing explicit) · `idx_ec_mailbox_tenant` · `idx_ec_inbound_tenant` ·
`idx_ec_inbound_mailbox` · `idx_ec_inbound_quarantine` · `idx_ec_inbound_thread` ·
`idx_ec_attachment_message` · `idx_ec_attachment_hash` · `idx_ec_triage_tenant_status`.

**Migration 81 (2/2):** `idx_ec_triage_outcome` · `idx_ec_triage_outcome_file` — both
created *after* the outcome columns in the migration body, so their presence evidences
that the file executed past its DDL rather than partially.

### 2.4 Residual checks — belt-and-braces

The CLI here exposes stats, not catalogue queries (no Docker for `db dump`, no production
keys for a PostgREST probe). Not verified by direct observation: the six outcome columns,
the four functions, the widened `business_event_event_domain_check`, and the **zero
grants** on both permissions.

Each migration runs in a transaction and neither file contains an explicit `COMMIT`, so a
partial application is not a reachable state; the indexes above sit at the end of each
file's DDL, and CI executed the same statements on a clean 1→81 chain and asserted their
effects — including `perm_grants = 0` in both suites. The honest statement is therefore:
**tables and indexes directly observed; columns, functions, CHECK and grant-state
established by transactional atomicity plus CI, not by direct observation.** The SQL for
direct observation is in [ec-2-completion-report.md](ec-2-completion-report.md) §11 and
costs nothing to run.

## 3. Verdict

**EC-1 + EC-2 deployment: PASS.** Ledger 81/81 zero-mismatched · 6/6 tables · 11/11
indexes · CI green with zero skipped and both EC suites executed by name.

**No sequencing deviation.** Unlike DEV-HR6-01, application followed a green run —
the reinforced control (green run **and** a per-step zero-skipped check) was satisfied
before deployment.

## 4. Post-deployment state — DARK, as designed

| Gate | State |
|---|---|
| `communication:inbound:read` | catalogued, **granted to nobody** |
| `communication:triage` | catalogued, **granted to nobody** |
| `EFFITRANS_EC_INBOUND_ENABLED` | unset → webhook returns 503 |
| `tenant_ec_inbound_rollout` | empty → fail-closed for every tenant |
| `ec_mailbox` | empty → nothing could route even if the flag were set |
| `/communications/triage` | 404 for every user |

Applying these migrations changed nothing observable, which was the intent.

## 5. Operator work remaining: NONE

No migration, repair, replay, grant or configuration remains for EC-1 or EC-2. What
remains is **management ratification and activation decisions**, not operator action:

| Ref | Decision | Owner |
|---|---|---|
| **RATIFY-EC1-1 / EC2-1** | grant both permissions to ACCOUNT_MANAGER + OPS_SUPERVISOR — **until then nobody can open the workspace, so it cannot reach UAT** | management |
| **Q-EC2-2** | create `operations@effitrans.com` and insert its `ec_mailbox` row | operator, *after* the decision |
| **DEC-EC-D2** | inbound provider + DPA (RESEND stays `not_configured`) | management |
| **EDGE-EC1-1** | edge rate limiting before the endpoint is publicly reachable | platform/ops |
