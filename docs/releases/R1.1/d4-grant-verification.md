# R1.1 · D4 — Finance Aging grant verification

**Date prepared:** 2026-08-01 · **Step:** D4 of the ratified activation checklist
([`../R1.0/smoke-uat-checklist.md`](../R1.0/smoke-uat-checklist.md) §D) · **Read-only.**

## What D4 proves

Before the flag flip (D5), the effective production grants for `finance:aging:*` must
match the ratified least-privilege matrix — above all, that **SYSTEM_ADMIN holds no
approval-class permission**. The D-11 doctrine, as written into migration 72's grant
block: *"SYSTEM_ADMIN administers the platform; it does NOT approve imports, validate,
finalize, or share. Administering a system is not financial signoff authority."*

**Authoritative expected matrix:** the grant INSERTs of
`supabase/migrations/20260729000002_aging_balance_foundation.sql` (lines 748–795) — the
statements that created production's grants. The script encodes that matrix as literal
VALUES and compares the live `role_permission` state against it, both directions.

| Permission | Ratified holders |
|---|---|
| `read` · `export` · `print` | FINANCE_OFFICER · ACCOUNTANT · TREASURER · DAF · DGA · CEO · SYSTEM_ADMIN |
| `draft_create` · `draft_update` | FINANCE_OFFICER · ACCOUNTANT · DAF · SYSTEM_ADMIN |
| `import_stage` | ACCOUNTANT · DAF · SYSTEM_ADMIN |
| `import_approve` · `validate` · `finalize` · `share` | **DAF · DGA only** |
| `template_manage` | **DAF only** |

**Approval class** (SYSTEM_ADMIN must hold none): `validate` · `finalize` ·
`import_approve` · `share` · `template_manage`.

## How to run

Paste [`d4-grant-verification.sql`](d4-grant-verification.sql) into the Supabase SQL
editor (production). It emits **two result sets**:

1. **The checks** — 16 rows (1 control + 1 catalog + 2 SYSTEM_ADMIN + 11 per-permission
   matrix rows + 2 catch-alls), each with a `passed` boolean and a `detail` column that
   names any deviation verbatim.
2. **The evidence listing** — every `(permission, role)` pair currently granted, with the
   number of tenants carrying that grant. Informational; attach it to the D4 record.

Grants were backfilled tenant-unfiltered, so the checks compare **distinct role codes
across all tenants** — a deviation in any tenant fails its row.

## Determination rule

- **All 16 rows `passed = true` → D4 PASS.** Record it in the §D checklist and proceed
  to D5 (after D1/D2 close).
- **Any row false → D4 FAIL.** The `detail` column names the deviation
  (`role → permission`, extra or missing). **Do not grant or revoke anything to make it
  pass** — a deviation means either an unratified change happened in production (find its
  audit trail) or the ratified matrix itself changed without this document following.
  Either way: stop, investigate, and re-ratify before D5.

A special case the script surfaces explicitly: if SYSTEM_ADMIN holds *nothing*, the
second `2-sysadmin` row fails with « SYSTEM_ADMIN holds NOTHING — investigate » — that
would suggest the grants were tampered with since the R1.0-R verification (which counted
all 11 permission rows live).
