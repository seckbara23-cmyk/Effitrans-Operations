# Backup & Recovery Runbook (Phase 1.18 — C4)

**Audience:** the designated IT System Admin + the break-glass backup admin (DEC-B12 / BLK-RB2).
**Scope:** Effitrans production on **Supabase** (Postgres + Storage + Auth) deployed on **Vercel**.
**Status:** baseline runbook for the controlled pilot. Items marked **⚠ CONFIRM** require a one-time check in the Supabase dashboard and must be ticked off in the [pilot launch checklist](pilot-launch-checklist.md) before go-live.

---

## 1. What we rely on

| Layer | Mechanism | Owner |
|---|---|---|
| Postgres data | Supabase automated daily backups; **Point-in-Time Recovery (PITR)** on paid plans | Supabase (managed) |
| Storage (documents) | Supabase Storage objects, replicated by the platform | Supabase (managed) |
| Auth users | Stored in Supabase `auth` schema → covered by the same DB backup | Supabase (managed) |
| Schema / migrations | Versioned in `supabase/migrations/*` in Git | Effitrans repo |
| App config | Vercel env vars (see `.env.example`) | IT admin |

> The application performs **soft-deletes only** (`deleted_at`) for clients, files, documents, and charges — hard deletes are deferred (workshop D6 / DEC-B19). This means most "accidental deletion" incidents are recoverable **in-app** without a database restore.

---

## 2. Backup posture — ⚠ CONFIRM at setup

These depend on the Supabase **plan/tier** and must be verified once in the dashboard
(*Project → Database → Backups*):

- [ ] **Daily backups** enabled (Pro plan and above).
- [ ] **PITR** enabled, and the retention window noted here: `____ days` (target: ≥ 7 days for pilot).
- [ ] **Backup region** confirmed and aligned with data-residency requirement **BLK-9** (`____`).
- [ ] **Retention** policy recorded: daily backups kept `____ days`.
- [ ] At least **two admins** have Supabase dashboard access (no single point of failure — risk R14).

If the project is on a plan **without** PITR/daily backups, that is a **go-live blocker** for storing real customer data — upgrade before onboarding pilots.

---

## 3. Database restore (Postgres)

**RPO (data loss tolerance):** ≤ 24h with daily backups; ≤ a few minutes with PITR.
**RTO (time to restore):** typically 15–60 min depending on DB size + Supabase queue.

### 3a. Recover a small mistake (preferred — no downtime)
1. Most deletes are **soft** — restore the row in-app (un-archive a client, restore a charge) or via SQL `UPDATE ... SET deleted_at = NULL`.
2. For a bad data edit, consult `audit_log` (every mutation is recorded) to identify the prior value and correct it directly.

### 3b. Point-in-Time Recovery (PITR)
1. Supabase dashboard → *Database → Backups → Point in Time*.
2. Choose the timestamp **just before** the incident.
3. Supabase provisions a restored instance. **Confirm the new connection string.**
4. Update Vercel env (`DATABASE_URL` if used by tooling; the runtime uses the project URL/keys — confirm they still point at the restored project).
5. Smoke-test (see §6) before announcing recovery.

### 3c. Daily backup restore (no PITR)
1. Supabase dashboard → *Database → Backups → Restore* the most recent daily backup.
2. Accept the data-loss window (everything since that backup is lost — communicate it).
3. Re-run any migrations newer than the backup if needed: `npm run db:push`.
4. Smoke-test (§6).

---

## 4. Storage restore (documents)

**Assumption:** Supabase Storage is platform-replicated; there is **no independent app-level copy** of uploaded documents in the pilot.

- A deleted **document row** is soft-deleted → the file usually still exists in the bucket and the row can be un-deleted.
- A deleted **storage object** (rare; only via dashboard/service-role) is **not** independently recoverable beyond Supabase's own retention. **⚠ CONFIRM** Storage backup/retention behaviour for the project's plan and record it: `____`.
- **Recommended hardening (post-pilot):** a scheduled export of the documents bucket to a separate cold-storage location for an independent recovery path. Tracked as a follow-up.

---

## 5. Downtime expectations

| Scenario | Expected downtime | User-facing message |
|---|---|---|
| App redeploy / rollback (Vercel) | < 1 min | none (atomic) |
| Bad migration rollback | 5–20 min | "maintenance" banner |
| PITR restore | 15–60 min | planned maintenance notice |
| Daily-backup restore | 30–90 min + data-loss window | planned maintenance + data-loss notice |
| Supabase regional incident | platform-dependent | status page + ETA |

**Vercel rollback:** for an app-only regression (no data change), roll back to the previous deployment in the Vercel dashboard — this is the fastest mitigation and needs **no** database action.

---

## 6. Post-restore smoke test (always run before "all clear")

Run the [operational tests in the launch checklist](pilot-launch-checklist.md#operational-tests), minimally:
1. Staff email login + Google OAuth.
2. Open a dossier; verify documents load and download.
3. Create a draft invoice; confirm totals.
4. Portal login as a client user; verify only their files/invoices appear (RLS intact).
5. Check `audit_log` is still being written.
6. Confirm `[observe]` logs are flowing (no error spike) — see [monitoring verification](monitoring-verification.md).

---

## 7. Incident procedure

1. **Detect** — alert from logs/monitoring (`[observe]` error spike, 5xx, or user report).
2. **Declare** — IT admin owns the incident; notify the break-glass admin.
3. **Contain** — if app regression, **roll back the Vercel deployment** first. If data corruption, identify the timestamp from `audit_log`.
4. **Recover** — choose §3/§4 path; prefer in-app soft-delete recovery, then Vercel rollback, then PITR, then daily restore (most disruptive last).
5. **Verify** — run §6 smoke test.
6. **Communicate** — notify affected pilot customers with scope + data-loss window (if any).
7. **Post-mortem** — record cause, timeline, and a prevention action. Link the `audit_log` / `[observe]` evidence.

**Escalation contacts (⚠ fill in before go-live):**

| Role | Name | Contact |
|---|---|---|
| IT System Admin | `____` | `____` |
| Break-glass backup admin | `____` | `____` |
| Supabase support | (dashboard → Support) | plan-dependent |
| Vercel support | (dashboard → Support) | plan-dependent |
