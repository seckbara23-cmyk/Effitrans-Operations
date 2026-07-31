# R1.0 — Operational Validation Checklist (executable)

**Purpose:** close R1.0. The ledger reconciliation is done (72/72, verified 2026-07-31);
what remains is proving the running system behaves. This document is the *executable*
form of [`smoke-uat-checklist.md`](smoke-uat-checklist.md) §A–B: exact URL, exact seat,
exact clicks, expected result, pass/fail criterion, and the remedy when it fails.

**Standing constraints for this checklist:** no migrations, no schema changes, no code
changes. Every step below is a *read* or a *normal business action performed by the seat
that owns it*. The one deliberate exception is B4 step 2, which issues a temporary
password to a **test account** — that is the feature under test, not an intervention.

**Production base URL:** `https://effitrans-operations.vercel.app`
**Expected served SHA:** the current `main` HEAD — at time of writing `d8b37d8`
(`d8b37d84262da40f51495a3bf04eff56b746d419`). Re-check before A2; a newer commit is fine
as long as it is HEAD.

---

## A2 · Production verification sweep

| | |
|---|---|
| **URL** | *(CLI, no browser)* — targets `https://effitrans-operations.vercel.app` |
| **Seat** | Operator (terminal with the repo checked out; **no** production credentials needed — the sweep runs anonymous) |

### Exact commands

```powershell
cd "c:\Projects\Effitrans Operation Platform"
git rev-parse HEAD                                    # copy the full SHA
node scripts/gate/verify-production.mjs https://effitrans-operations.vercel.app <PASTE_FULL_SHA>
```

Git Bash is identical (`node scripts/gate/verify-production.mjs …`).

### What it checks

1. `/api/version` — served SHA equals the SHA you passed, `env=production`, `hosted=true`
2. Route sweep — 5 public routes answer **200** (`/login`, `/portal/login`, `/api/version`,
   `/offline`, `/manifest.webmanifest`); 24 staff routes redirect anonymous visitors to
   `/login`; 4 portal routes redirect to `/portal/login`; **nothing 404s**, no redirect loop
3. Security headers — HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`
4. Prints the Supabase project ref the deployment is wired to

### Expected result

Every line prefixed `PASS`, closing with a zero exit code.

```powershell
echo $LASTEXITCODE      # PowerShell — must print 0
```

### Pass / fail

- **PASS** — exit code `0`, zero `FAIL` lines.
- **FAIL** — any `FAIL` line or a non-zero exit.

### If it fails

| Symptom | Action |
|---|---|
| `version: sha mismatch` | The deployment is older than `main`. Check the Vercel deployment for that commit finished; re-run after it does. **Not** a schema issue. |
| A staff route **200s** instead of redirecting | Stop — that is an auth-gate regression. Record the route; do not proceed to B. |
| A route **404s** | Record which. A 404 on a flag-gated route (`/finance/aging`) is **expected and correct** at R1.0 — the sweep does not include it; any *other* 404 is a finding. |
| Missing security header | Record; not an R1.0 blocker by itself. Raise for the next release. |
| Timeout / network | Re-run once. Persistent timeouts = platform incident, not a release finding. |

---

## A3 · Operations dashboard verification

| | |
|---|---|
| **URL** | `https://effitrans-operations.vercel.app/platform/operations` |
| **Seat** | Platform operator login (a staff account holding platform access — the same login used for `/platform`) |

### Exact clicks

1. Sign in at `/login`.
2. Navigate to `/platform/operations` (address bar, or « Plateforme » → « Opérations »).
3. Read the two top cards: **« Déploiement »** and **« Santé plateforme »**.

### Expected result

**Card « Déploiement »** — header state **ok** (not « warn », not « indisponible »):

| Row | Expected value |
|---|---|
| Commit | first 12 chars of the served SHA (`d8b37d84262d` for `d8b37d8`) |
| Branche | `main` |
| Environnement | `production` |
| Région | any region string (informational) |
| **Migrations livrées** | **`72 · dernière : 20260729000002_aging_balance_foundation`** |
| Base de données | the probe row resolves — the card is **not** in `warn` |

**Card « Santé plateforme »** — « Base de données » reads `joignable · <n> ms`;
« Hébergement » reads `Vercel (production)`.

> **What the numbers mean.** « Migrations livrées » is a **build-time constant** pinned to
> the migrations directory by a unit test — it states what the *deployed code* expects, not
> what the database contains. The `warn` state comes from `probeApplied`: the console looks
> up the permission row `finance:expense:read` (migration `20260725000001`). Post-repair
> that row exists, so `warn` must not appear. This is deliberately an *honest* probe — it
> proves migrations ≥ 58 by data, and the console does not over-claim about DDL-only
> migrations it cannot see through PostgREST.

### Pass / fail

- **PASS** — « Migrations livrées » shows `72 · dernière : 20260729000002_…`, the
  Déploiement card is **not** `warn`, and the DB reads joignable.
- **FAIL** — card is `warn` (probe row missing), migration count ≠ 72, or DB unreachable.

### If it fails

| Symptom | Action |
|---|---|
| Card in `warn` | The `finance:expense:read` permission row is missing — that contradicts the 30/30 verification. Re-run only the one confirming read: `select count(*) from public.permission where code='finance:expense:read';` (expect 1). This is the sanctioned "smoke failed → look" exception. |
| Count ≠ 72 | The deployment is older than `d8b37d8`; re-check the served SHA (A2). Constants are pinned by CI, so a mismatch means stale deploy, never drift. |
| « indisponible » on all cards | Session lacks platform access — re-login with the platform operator seat before recording a failure. |
| DB « INJOIGNABLE » | Platform incident. Stop the checklist; nothing below is meaningful. |

---

## B1 · Invoice integrity — three-hash verification

| | |
|---|---|
| **Record under test** | invoice **`EFT-INV-2026-00001`** |
| **Seats** | (a) Finance / DAF staff account with `finance:read`; (b) the pilot **portal** customer that owns this invoice |

**The three hashes** — staff-served, portal-served, and the hash of the bytes actually
received. The `X-Invoice-Sha256` header is read straight from `document.content_sha256`,
so a header/bytes match proves the stored hash describes the served artifact, and a
staff/portal match proves both paths resolve to the same finalized artifact. No SQL is
required (an optional confirming query is at the end).

> ### ⚠️ Capture rule learned on 2026-07-31 (OBS-R10-06)
>
> **Never hash a file saved from the browser's PDF *viewer*.** Edge and Chrome re-serialise
> the document through their own PDF engine when you use the viewer's Save button: the
> result renders identically but is a different file — in the observed case 1 641 bytes
> against the 3 073 the server sent, because our PDFs ship with uncompressed content streams
> and the viewer compresses them. A `…-current.pdf` filename is the tell; the platform names
> the file `EFT-INV-…….pdf`.
>
> **H3 must be the bytes as delivered:**
> - right-click the link → « **Enregistrer la cible du lien sous…** » (never open-then-save), **or**
> - `curl` the URL with the session cookie.
>
> Then check the saved file's **byte length equals the advertised `Content-Length`** before
> hashing. A length mismatch means you captured a re-encoding, not the artifact — recapture.

### Exact clicks — staff path

1. Sign in at `/login` as the Finance/DAF seat.
2. Go to **`/finance`**.
3. In the table, find the row whose « N° » is `EFT-INV-2026-00001`; click the **dossier
   number** in the « Dossier » column → lands on `/files/{fileId}`.
4. Open the browser **DevTools → Network** tab (F12) *before* the next click.
5. Scroll to the Finance panel → the strip « **Facture officielle EFT-INV-2026-00001** »
   → click « **Télécharger le PDF** » (opens `/api/invoices/{invoiceId}/pdf` in a new tab).
   *If this is the first ever download the artifact is rendered and finalized now — that is
   expected, once, and is not a failure.*
6. In DevTools, select the `pdf` request → **Headers → Response Headers** → record
   `X-Invoice-Sha256` = `H1 = ________________________________`
7. Save the delivered bytes — **right-click the link → « Enregistrer la cible du lien sous… »**
   (not the viewer's Save button; see the capture rule above). Then:
   ```powershell
   (Get-Item "C:\path\to\EFT-INV-2026-00001.pdf").Length     # must equal Content-Length
   certutil -hashfile "C:\path\to\EFT-INV-2026-00001.pdf" SHA256
   ```
   `saved length = ______` (must equal the advertised `Content-Length`)
   `H3 = ________________________________` *(certutil prints spaces — ignore them; compare case-insensitively)*

### Exact clicks — portal path

8. In a **private/incognito window**, sign in at `/portal/login` as the pilot customer.
9. Go to **`/portal/invoices`** → click invoice `EFT-INV-2026-00001` →
   `/portal/invoices/{id}`.
10. DevTools → Network open → click « **Télécharger le PDF** » → record
    `X-Invoice-Sha256` = `H2 = ________________________________`

### Expected result

`H1 = H2 = H3`, all three the same 64-character hex string.

### Pass / fail

- **PASS** — the three values are identical.
- **FAIL** — any difference, or the header is absent, or either download 404s/403s.

### If it fails

| Symptom | Action |
|---|---|
| `H1 ≠ H2` | Two artifacts exist for one invoice — a real integrity finding. **Stop B1**, record both hashes and the invoice id, do not re-download or regenerate (that would mask it). Escalate as an R1.0 blocker. |
| `H3 ≠ H1` | The served bytes do not match the recorded hash (transfer/caching). Re-download once from a clean private window; if it repeats, escalate as a blocker. |
| Header absent | You captured the redirect rather than the PDF response, or DevTools was opened after the click. Retry with « Preserve log » enabled. |
| Portal 403 / invoice not listed | The pilot customer does not own this invoice — pick the invoice the pilot customer *does* own and record which one you used. Not a failure of the mechanism. |
| Staff « Télécharger le PDF » absent | The invoice is still a **draft** (the strip only renders for non-draft invoices with a number). Choose an issued invoice and record the substitution. |

*Optional confirmation (read-only, only if a mismatch appears):*
```sql
select content_sha256 from public.document
 where artifact_code = 'OFFICIAL_INVOICE'
   and invoice_id = (select id from public.invoice where invoice_number = 'EFT-INV-2026-00001');
```

---

## B2 · Customs discovery workflow

Proves migration **69** (`customs_department_discovery`) in the running system: a Douane
user who has **never been personally assigned** must still *discover* dossiers that carry a
live customs leg.

| | |
|---|---|
| **URLs** | `/files` and `/departments/customs` |
| **Seat** | a **CUSTOMS_DECLARANT**, **CHIEF_OF_TRANSIT** or **CUSTOMS_FIELD_AGENT** account with **no** dossier assignment |

> **Precondition that makes or breaks the test:** the account must **not** hold
> `file:read:all`. With `file:read:all` every dossier is visible for an unrelated reason and
> the test proves nothing. Confirm the seat's role before starting; record which role you used.

### Exact clicks

1. Sign in at `/login` as the customs seat (an account that is **not** account manager,
   coordinator, creator, process owner or task assignee on any dossier).
2. Go to **`/files`** — the dossier list.
3. Go to **`/departments/customs`** — the Douane queue.

### Expected result

- `/files` lists dossiers whose customs leg is **live and required** (`customs_record`
  present, same tenant, `required = true`) — **without** any personal assignment.
- `/departments/customs` renders the counters (« Prêt pour déclaration », « En attente de
  réponse », « Sous inspection », « Prêt pour mainlevée », « Files douane ») over a
  **non-empty** queue, and « Files douane » equals the number of queue rows shown.
- **Negative control:** a dossier with **no** customs record — or one whose customs record
  is `required = false` — does **not** appear. Name the dossier you used as the control:
  `________`

### Pass / fail

- **PASS** — customs dossiers visible with zero personal assignment **and** the control
  dossier absent.
- **FAIL** — zero dossiers visible (the pre-69 defect), or the control dossier visible
  (over-broad grant).

### If it fails

| Symptom | Action |
|---|---|
| « Accès non autorisé au dédouanement » on `/departments/customs` | The seat lacks `customs:read` — a **grant** matter, not migration 69. Record it and re-test with a properly granted seat. |
| Zero dossiers on `/files` | Confirm at least one dossier genuinely has `customs_record.required = true` in the same tenant before calling it a failure — with none, zero is the correct answer. If one exists and is still invisible, that is a real R1.0 blocker. |
| Control dossier **is** visible | Check the seat truly lacks `file:read:all` and has no assignment history on it; if both hold, record as an over-visibility finding (blocker). |
| CASHIER sees zero dossiers | **Correct behaviour, not a defect** — CASHIER holds no `file:read` and is execution-only under DEC-C21. Do not "fix". |

---

## B3 · Dossier closure workflow

Proves migration **70** (`file:transition`) end-to-end.

| | |
|---|---|
| **URL** | `/files/{id}#closure` for dossier **`EFT-IMP-2026-00003`** |
| **Seat** | **OPS_SUPERVISOR** (must hold `file:transition`) |

### Exact clicks

1. Sign in at `/login` as the OPS_SUPERVISOR seat.
2. Go to **`/files`** → click dossier **`EFT-IMP-2026-00003`**.
3. Scroll to the section headed « **Clôture du dossier** » (direct anchor: append
   `#closure` to the URL).
4. Confirm the current state reads « Statut : **Livré** » (or the stage preceding closure).
5. Click « **Faire avancer → Clôturé** ».

### Expected result

- The button completes without an error line; the page refreshes.
- « Statut » now reads « **Clôturé** ».
- The « Historique » list gains a row: `Livré → Clôturé` with today's timestamp and **your**
  account email.

### Pass / fail

- **PASS** — status is `Clôturé` and the history row names the actor.
- **FAIL** — an error message appears, or the status does not change.

### If it fails

| Symptom | Action |
|---|---|
| The button is **not rendered** | The seat lacks `file:transition` (editing rights `file:update` are a *different* permission and do not substitute). Grant matter — record it. |
| Error naming a **blocker** (customs not released / POD missing / invoice unsettled) | **This is the gate working as designed, not a defect.** Record the exact wording and either satisfy the named condition through normal business flow or select a different dossier that is genuinely closable, and record the substitution. Do **not** bypass the gate or edit data to force it. |
| « Action non autorisée » | Server-side refusal despite a visible button — record verbatim; that is a genuine finding. |
| Status changes but no history row | Integrity finding — record the dossier id and escalate. |

---

## B4 · Temporary password lifecycle

Proves migration **71** in the running system.

| | |
|---|---|
| **URL** | `/users` → `/users/{id}` |
| **Seats** | tenant **SYSTEM_ADMIN** (holds `admin:users:temp_password`) **+** a designated **TEST** staff account |

> Use a **test** account, never a real employee. An administrator **cannot** issue a
> temporary password to themselves — that refusal is itself expected behaviour.

### Solo-operator adaptation (used on 2026-07-31)

When one person holds the only production session, three rules keep the test non-destructive:

1. **Never sign out of the admin session.** Do the test-account login in a **private /
   incognito window**; the admin session survives in the main window. If the temporary
   password is somehow lost mid-test, the recovery lever (`Générer…` again) is only
   reachable from that surviving admin session.
2. **Never target a real employee.** Issuing a temporary password **immediately invalidates
   the target's current password** — on a real account that is an outage for a colleague who
   never asked for one. The target must be an account whose lockout costs nothing.
3. **The admin account is never the target.** The server refuses self-issue
   (`generateStaffTempPassword` rejects `userId === admin.id`) precisely because an
   administrator holding only a forced-change credential is a self-inflicted outage. The
   refusal is a designed control — worth observing once, not worth working around.

Creating a test account, if none exists, is **additive and supported** (`admin:users:create`
with credential mode « générer ») but note the platform's archive-not-delete lifecycle
(Phase 8.1A): the row can be **archived, never deleted**. Choose the account name knowing it
is permanent.

> ### ⚠️ Precondition learned on 2026-07-31 (DEF-R10-01)
>
> **The password under test must be issued from `/users/{id}`, not from account creation.**
> Two different generators exist and only one arms the gate:
>
> | Path | Arms `must_change_password`? |
> |---|---|
> | « Nouvel utilisateur » → mode « Générer un mot de passe temporaire » (`createUser`) | **NO** — as built; see [`validation-findings.md`](validation-findings.md) |
> | `/users/{id}` → « Générer un nouveau mot de passe temporaire » (`generateStaffTempPassword`) | **YES** — writes the flag, the expiry and the change stamp in one update |
>
> A B4 run that logs in with a creation-time password tests the wrong path and will
> correctly land on `/dashboard`. Step 4 below is the step that matters.

### Exact clicks — issuing

1. Sign in at `/login` as SYSTEM_ADMIN → go to **`/users`**.
2. Click the **test** account → `/users/{id}`.
3. Find the section « **Gestion du mot de passe** ». Read « État du mot de passe » and
   « Dernière modification » (may read « Inconnue — antérieure au suivi » — normal).
4. Click « **Générer un nouveau mot de passe temporaire** ».
5. The confirmation appears: « **Générer un nouveau mot de passe temporaire ?** » listing
   the three consequences (current password invalidated immediately; new one shown once;
   user must change it at next login).
6. Choose « **Motif (obligatoire)** » — one of *Mot de passe oublié · Compte verrouillé ·
   Nouveau poste de travail · Autre*; optionally fill « Précision ».
7. Click « **Générer le mot de passe** ».

### Expected result — issuing

- Dialog « **Mot de passe temporaire généré** » shows: Utilisateur, **Mot de passe
  temporaire**, « **Expire le** » *(≈24 h ahead, formatted in French)*, « Changement du mot
  de passe obligatoire à la première connexion », a « **Copier** » button, and the warning
  that it is shown **once** and is irrecoverable.
- After closing, the panel's « État du mot de passe » reads **temporaire** with the expiry.
- Attempting the same on **your own** account: the control is unavailable (self-issue is refused).

### Exact clicks — consuming

8. Copy the password, sign out (or use a private window).
9. Sign in at `/login` as the test account with that temporary password.

### Expected result — consuming

- You are sent to **`/auth/change-password`** and cannot reach any application page first.
- After setting a new password, the session continues to `/dashboard`.
- Back as SYSTEM_ADMIN on `/users/{id}`: « État du mot de passe » now reads **défini** and
  « Dernière modification » shows the moment you just changed it.

### Expired path (step 4 of the original checklist) — **preview only**

Verify in the **preview** environment: set that test row's `temp_password_expires_at` into
the past *(a write — permitted in preview)*, then log in → expect the terminal notice at
**`/auth/password-expired`** with no exchange possible. **Production writes to force
expiry are not authorized.** The alternative is to wait out the ~24 h window in production.
Record which option you took: `☐ preview  ☐ production wait  ☐ deferred`

### Pass / fail

- **PASS** — password shown exactly once with expiry; forced change on first login; panel
  state transitions temporaire → défini; audit records actor/target/reason/IP and **never**
  the password itself.
- **FAIL** — password retrievable a second time, no forced change, missing reason
  requirement, or the password appears in any log or audit payload.

### If it fails

| Symptom | Action |
|---|---|
| Button absent | Seat lacks `admin:users:temp_password`. **Note:** the deprecated umbrella `admin:users:manage` is still accepted by the server (expand→contract fallback), so absence means neither is held. Grant matter. |
| No forced change on login | Real defect in the lifecycle gate — record and escalate as an R1.0 blocker. |
| Password visible after reopening the page | Severe finding — the secret must live only in React state. Escalate immediately. |
| Reason not required | Compliance defect — the reason is a ratified requirement. Escalate. |
| Test account locked out | Use « **Déverrouiller le compte** » (needs `admin:users:unlock`) or « Envoyer un e-mail de réinitialisation », then retry. |

---

## Results record

| # | Check | Result | Date | Initials | Notes |
|---|---|---|---|---|---|
| A1 | Served SHA (`/api/version`) | ✅ PASS | 2026-07-31 | operator | `5b24164a57fc…` = `main` HEAD |
| A2 | Production verification sweep | ✅ PASS | 2026-07-31 | operator | ALL CHECKS PASSED, exit 0 |
| A3 | Operations dashboard | ✅ PASS | 2026-07-31 | operator | 72 · `20260729000002_…`; Déploiement/Santé/Sécurité all **Sain** |
| B1 | Invoice three-hash | ☐ PASS ☐ FAIL | | | H = |
| B2 | Customs discovery | 🔄 IN PROGRESS | 2026-07-31 | operator | positive target CONFIRMED (`uat.douane@effitrans.sn`, CUSTOMS_DECLARANT, `EFT-IMP-2026-00002` « Requis » + « Visible parce que : Département destinataire »); negative control outstanding |
| B3 | Dossier closure | ✅ PASS | 2026-07-31 | operator | `EFT-IMP-2026-00003` → Clôturé; history + journal + artifacts preserved; delete control = expected gate (OBS-R10-07) |
| B4 | Temp-password lifecycle | ✅ PASS | 2026-07-31 | operator | admin-issued path; forced change confirmed; expired path deferred (preview-only) |

## Observation classification vocabulary

Used for every observation from B1 onward, so a refusal is never silently read as a failure:

| Verdict | Meaning |
|---|---|
| **PASS** | The expected result occurred, with the evidence in hand |
| **FAIL** | The mechanism did not do what it promises — needs classification: release blocker · pre-existing defect · data issue · operator issue |
| **EXPECTED GATE** | The system refused **by design** (a closure blocker, a permission the seat genuinely lacks, an archived record). Not a failure — record the wording and move on; never force it |
| **NOT APPLICABLE** | The precondition for this step does not exist in production (no such record, no such seat). Record why; do not substitute silently |

When every row is PASS, complete [`release-signoff.md`](release-signoff.md) — R1.0 is not
closed until that document is signed.
