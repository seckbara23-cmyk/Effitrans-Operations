# R1.0 — Findings raised during operator validation

Findings discovered while executing
[`operator-validation-checklist.md`](operator-validation-checklist.md). A finding is
recorded here whether or not it blocks the release; the classification is stated
explicitly and separately from the evidence.

> **Commit identifiers in this document.** The 2026-07-31 history sanitation changed five
> commit SHAs — **because the repository's history was rewritten, not because any application
> behaviour changed**. The fix commit referred to below as `106423a` is now **`733c116`**;
> the full mapping is in
> [`history-sanitation-2026-07-31.md`](history-sanitation-2026-07-31.md). Every other SHA
> cited here predates the rewrite and still resolves.

---

## OBS-R10-07 — « Supprimer le dossier » stays visible on a closed dossier

**Raised:** 2026-07-31, during B3 · **Verdict: EXPECTED GATE.** The action is a **true
physical delete**, but it is content-guarded and cannot reach a dossier carrying business
records. B3 is unaffected — **PASS**.

### What the control actually does

`deleteFile` (`lib/files/actions.ts:237-277`) performs `.delete()` on `operational_file`
with FK cascade. It is **not** a soft delete: there is no `deleted_at`, no archive state.

It is gated by `evaluateHardDelete` (`lib/files/delete-policy.ts:38`), which permits the
delete **only for an empty shell** — zero finance records, documents, customs, transport and
tasks. Anything else returns `has_operations` and no write occurs. The module comment states
the reason plainly: every FK to `operational_file` cascades, so the guard is what stops a
delete from destroying business records.

### Why `EFT-IMP-2026-00003` is structurally undeletable

The very evidence B3 verified is what blocks it: the official invoice artifact, the
generated documents, the customs record and the transport record each make
`hasBlockingOperations()` true. The UI states the refusal in French rather than hiding it —
« Ce dossier contient des opérations et ne peut pas être supprimé. Vous pouvez le
clôturer/annuler. » — and the confirmation text scopes the action explicitly: « Supprimer
définitivement ce dossier **vide** ? »

The button renders on permission (`file:delete` — SYSTEM_ADMIN / OPS_SUPERVISOR); the
refusal is content-based and enforced server-side. Consistent with the house doctrine of
naming a refusal instead of silently hiding the control.

### Audit durability

The audit row is written **before** the delete (`actions.ts:258-266`), and
`audit_log.entity_id` is a plain `uuid` with **no foreign key** to `operational_file`
(`20260613000001_create_foundation_tables.sql:76-91`) — only `tenant_id` and `actor_id` are
FKs. So even a legitimate empty-shell delete leaves its audit trail intact.

### Residual observation for governance (not a defect, not a B3 failure)

**The guard is content-based, not lifecycle-based.** A dossier that is *closed but empty*
remains physically deletable, and its `file_status_history` would cascade with it. In
practice such a dossier is a mistake-shell, but closure itself confers no protection. If
closure should be terminal against deletion, that is a governance decision to ratify — a
one-line status condition in `evaluateHardDelete` — not a defect in what was specified.

---

## OBS-R10-06 — 3 073-byte response vs 1 641-byte saved file

**Raised:** 2026-07-31, during B1 · **Verdict: the server is exonerated by construction; the
discrepancy is introduced by the browser's PDF viewer on save.** Not a defect in the
platform. B1's capture procedure was wrong and has been corrected.

### The evidence

| | |
|---|---|
| Response | `200`, `Content-Type: application/pdf`, `Content-Length: 3073`, `X-Invoice-Sha256: a1442d13…8c2e` |
| Saved file | `EFT-INV-2026-00001-current.pdf`, **1 641 bytes**, `d6ed259c…0adf4` |

### What is hashed, and what is sent

One buffer, start to finish — `lib/finance/invoice-artifact.ts:96-115`:

```ts
const bytes = renderOfficialInvoice(snapshot);   // :96
const contentSha256 = sha256Hex(bytes);          // :97   <- the header value
await uploadObject(storagePath, bytes, "application/pdf");  // :101  <- the stored object
… finalize_official_invoice(… p_content_sha256: contentSha256 …)     // :104-115
```

and at download — `app/api/invoices/[id]/pdf/route.ts:90-109`:

```ts
const bytes = new Uint8Array(await blob.arrayBuffer());   // :95  the stored object
return new NextResponse(bytes, { headers: {
  "Content-Length": String(bytes.byteLength),             // :103 derived from the body itself
  "X-Invoice-Sha256": artifact.contentSha256,             // :107 the hash of those same bytes
}});
```

**`Content-Length` is trustworthy** — it is computed from the very buffer being sent, not
from a stored number. **3 073 is the true body length.** No text codec touches the bytes
(`TextDecoder`, `.text()`, `toString(` are all absent from the route). The route imports no
renderer, so nothing generates a second PDF on download.

### The service worker is not involved

`public/sw.js` — `cacheableStatic()` (`:52-59`) returns true **only** for `/_next/static/`,
`/icons/` and `/favicon.ico`. For everything else the fetch handler **returns at `:81`
without calling `event.respondWith`**, so the browser's normal network path applies: the SW
cannot transform, truncate, replace or cache the response — and every `cache.put` in the
file sits downstream of that gate. DevTools labelling the request « from service worker »
reflects an SW-**controlled client**, not interception. Pinned by
`tests/invoice-byte-integrity.test.ts`, which evaluates the real predicate out of `sw.js`.

### What actually produced 1 641 bytes

Two facts converge:

1. **Our PDFs are uncompressed.** `lib/reports/pdf.ts:259` writes page content as
   `<< /Length n >> stream … endstream` with **no `/Filter`**. A 3 073-byte uncompressed
   text-only invoice is exactly the expected size.
2. **The file was produced by the viewer, not the network.** The name
   `…-current.pdf` is not ours — `invoiceFileName()` (`invoice-artifact.ts:43-45`) returns
   `${invoiceNumber}.pdf`, and the response carries
   `Content-Disposition: inline; filename="EFT-INV-2026-00001.pdf"`. The suffix comes from
   Edge's PDF viewer save path, which **re-serialises the document through its own PDF
   engine** — re-writing the object structure and compressing the streams. Roughly halving
   an uncompressed content stream is precisely what that produces.

So the 1 641-byte file is a **semantically equivalent re-encoding**, not the artifact. It is
neither "the previous artifact" nor "a later one": both hashes describe the same accounting
content, and only `a1442d13…` describes the bytes the platform issued and stores.

### Consequence for B1 — the procedure was at fault

**H3 must be the bytes as delivered.** Never the viewer's Save button. Corrected in
`operator-validation-checklist.md`: use « Enregistrer la cible du lien sous… » on the link
(or `curl` with the session cookie), then hash the saved file, and check that its byte
length equals the advertised `Content-Length`.

### Residual observation (not a defect, worth knowing)

The route publishes `artifact.contentSha256` **from the database row** rather than hashing
the streamed bytes on every request. That is a deliberate cost choice, and the two cannot
diverge through any code path in the repo (one buffer is hashed and uploaded together, and
nothing ever updates the column). Should storage and the row ever diverge through an
out-of-band act, the header would describe the row rather than the body — which is exactly
what B1's H3 check would expose.

---

## DEF-R10-05 — the official invoice PDF is laid out upside-down (coordinate mismatch)

**Raised:** 2026-07-31, during B1 · **Reporter:** operator (production)
**Classification:** **post-R1.0 defect — Major (document quality), NOT a release blocker.**
**FIXED 2026-07-31 — awaiting deployment and production retest.** Renderer corrected to the
top-down contract; `INVOICE_RENDERER_VERSION` → `uat2b-2`; geometry regression suite added
(`tests/invoice-pdf-geometry.test.ts`) and proven to fail against the old layout. Issued
invoices are untouched by design — see
[`docs/finance/invoice-artifact-immutability.md`](../../finance/invoice-artifact-immutability.md).

### 1. What the pipeline actually is

**There is no browser, no HTML and no CSS anywhere in this pipeline.** `package.json`
contains no `puppeteer`, `playwright`, `pdfkit`, `pdf-lib` or `jsPDF`. The engine is
`lib/reports/pdf.ts` — a hand-rolled PDF writer emitting content-stream operators directly.
So of the candidates raised:

| Candidate | Verdict |
|---|---|
| HTML layout | **NOT APPLICABLE** — no HTML |
| Print CSS | **NOT APPLICABLE** — no CSS |
| Playwright / Puppeteer rendering | **NOT APPLICABLE** — no headless browser in the dependency tree |
| Fixed header reservation | **NOT APPLICABLE** to this document — the header band belongs to `ReportLayout` (`lib/reports/templates.ts`), which the invoice does **not** use; it writes to `PdfDoc` directly |
| Page-break rules | **Contributing, not causal** — the guard is inverted too (§3), but only on multi-page invoices |
| Another rendering defect | ✅ **THE CAUSE — a coordinate-convention mismatch** |

### 2. Root cause

`PdfDoc` is a **top-down** API. Its own comments say « top-left origin », and every
primitive converts on the caller's behalf:

```ts
// lib/reports/pdf.ts:149  (text)
const py = this.height - y;
// :160 fillRect, :166 strokeRect, :174 line, :195 image — all `this.height - y…`
```

`lib/finance/invoice-pdf.ts` was written against a **bottom-up** mental model: it starts at
`let y = 800` (`:96`) and **decrements** (`y -= 16`, `:100`) to advance down the page.

With A4 height 841.89 the first line is therefore emitted at
`py = 841.89 − 800 = 41.89` — **41.89 pt from the BOTTOM** — and every subsequent
decrement moves the next element **upward**. The document is built from the bottom of the
page toward the middle, leaving the top blank. That is precisely the reported symptom.

**Every other renderer uses the house convention** — top-down and incrementing:

| File | Convention |
|---|---|
| `lib/reports/templates.ts` (ReportLayout) | `this.y += h`; header stamped at `y = 24`/`40` |
| `lib/copilot/export.ts` | `let y = M + 6` then `y += 20` |
| `lib/finance/expense/pdf.ts` | via ReportLayout |
| **`lib/finance/invoice-pdf.ts`** | **`let y = 800` then `y -= …` — the sole outlier** |

### 3. Predicted secondary symptoms (confirm these to close the diagnosis)

1. **The vertical order is inverted** — the organization name sits at the very bottom of the
   page, « Coordonnées de règlement » highest, the line table between them. This is the
   decisive confirmation; a merely *shifted* but correctly-ordered invoice would mean a
   different cause.
2. The « Désignation / Qté / P.U. / Montant » shading band (`fillRect(M, y - 4, …, 18)`,
   `:170`) sits offset from its own header text.
3. On a multi-page invoice the guard `if (y < 140) { addPage(); y = 800 }` (`:179-182`) is
   inverted: `y` *falls* as content is added, so the break fires when content nears the top,
   and the new page restarts at the bottom.

### 4. Why CI is green

`tests/uat2b-invoice-artifact.test.ts` pins **determinism** (same snapshot → same hash),
**provenance** (no `Date.now`, no `Intl`, no invented values), **money formatting**, and the
`%PDF-` header. **It asserts nothing about geometry.** No test in the suite reads a single
coordinate — so a layout inversion passes every gate. That absence is itself worth recording.

### 5. Severity and blast radius

| Dimension | Assessment |
|---|---|
| Data correctness | **Unaffected** — amounts, totals, dossier, client all correct; `invoiceTotals` is the shared function |
| Hash / verifiability | **Unaffected** — the renderer is deterministic; H1 = H2 = H3 holds regardless of layout |
| B1 acceptance | **Unaffected** — B1 tests byte identity across paths |
| Business impact | **Major.** This is *the* accounting document: sent to customers, used for tax and banking. An invoice printed bottom-up is not presentable |

### 6. The immutability consequence — the reason this should not wait

Official invoice artifacts are **generate-once and immutable**
(`lib/finance/invoice-artifact.ts:12-13, 61-72` — the function returns early when an
artifact exists, and `finalize_official_invoice` returns the existing row). So:

- every invoice already issued keeps this layout **permanently**;
- fixing the renderer **changes the bytes, hence the hash**, so it cannot silently repair
  what is already issued — re-issue would be a governed act, not a redeploy;
- therefore the cost grows with every invoice issued. `INVOICE_RENDERER_VERSION`
  (`invoice-pdf.ts:27`, currently `"uat2b-1"`) is the existing hook for versioning that
  decision.

### 7. Minimal corrective change (recommended — NOT implemented)

**Confine the change to `lib/finance/invoice-pdf.ts`.** Do **not** touch `lib/reports/pdf.ts`:
four other renderers depend on its current, correct, documented convention.

The mechanical inversion:

| Line(s) | Now | Minimal change |
|---|---|---|
| `:96`, `:113` | `let y = 800`, `let ry = 800` | start at the top margin: `M` (40) |
| all `y -= n`, `ry -= n`, `dy -= n` | decrement | `+= n` |
| `:125`, `:163` | `Math.min(y, ry)` / `Math.min(y, dy)` | `Math.max(…)` — "lowest point reached" flips sense |
| `:170` | `fillRect(M, y - 4, …)` | re-anchor the band relative to the baseline in top-down terms |
| `:179-182` | `if (y < 140) { addPage(); y = 800 }` | `if (y > 700) { addPage(); y = M }` |
| `:212` | totals rule at `y + 12` | `y - 12` |

Then add the missing guard: **one geometry regression test** asserting the issuer block is
emitted in the top quarter of the page — the class of test whose absence let this ship.

### 8. Release position

**Post-R1.0 defect.** R1.0 ships no code; this renderer has been in production since UAT-2B.
It does not block R1.0, and it does not block B1 — **continue B1 to H1/H2/H3.** It should be
scheduled promptly for the reason in §6, not because the release depends on it.

---

## OBS-R10-04 — dossier `EFT-IMP-2026-00003` carries invoice `EFT-INV-2026-00001`

**Raised:** 2026-07-31, during B1 · **Verdict: EXPECTED — independent numbering by design.**
Not a defect, not an operator error, and it does **not** invalidate the B1 evidence.

### Why the numbers do not correspond

Dossiers and invoices are minted by **two independent counters**, and neither derives from
the other:

| Artefact | RPC | Counter table | Prefix |
|---|---|---|---|
| Dossier | `next_file_number` — `lib/files/actions.ts:60` | `file_counter` (`lib/db/tenant-tables.ts:41`) | `EFT-IMP` / per type |
| Invoice | `next_invoice_number` — `lib/finance/actions.ts:308`, `lib/process/billing/actions.ts:451` | `invoice_counter` (`lib/db/tenant-tables.ts:53`) | `EFT-INV` |

Same family as the expense documents (`EFT-AUT`, `EFT-BON` — `lib/finance/expense/numbering.ts`).
The sequences count **different things**, so a tenant's 3rd import dossier legitimately
carries its 1st official invoice. An invoice number that mirrored its dossier number would
be the anomaly.

### Why the mapping is already proven by where it was seen

The « Facture officielle » strip is rendered by `FinancePanel`, fed by
`getFinanceForFile(file.id)` (`app/files/[id]/page.tsx:148`), which queries `invoice` with
**`.eq("file_id", fileId)`** and `.eq("tenant_id", …)` (`lib/finance/service.ts:164-168`).
An invoice belonging to another dossier is **structurally incapable** of appearing in that
panel. The strip's presence on `/files/{EFT-IMP-2026-00003}` *is* the mapping evidence.

Independent second source: the PDF prints « **Dossier : {fileNumber}** »
(`lib/finance/invoice-pdf.ts:142`), resolved from `operational_file.file_number` for the
invoice's own `file_id` (`lib/finance/invoice-artifact.ts:145-147, 203`) — so the artifact
declares its own dossier, from the bytes rather than the UI.

### Evidence required before resuming H1/H2/H3

Three confirmations, all read-only (see the operator response of 2026-07-31); they must
**agree**. If the `/finance` row named a different dossier while the panel and the PDF named
this one, that would be a genuine mapping defect and B1 would stop.

### Note for B3

No ordering constraint. `app/api/invoices/[id]/pdf/route.ts` states availability is
deliberately broad — an issued invoice stays downloadable after payment, cancellation,
**closure and archival**. Closing `EFT-IMP-2026-00003` in B3 will not affect B1's artefact.

---

## DEF-R10-03 — « Action non autorisée. » cannot distinguish a denial from a failure

**Raised:** 2026-07-31, during B4 · **Reporter:** operator (production)
**Classification:** **confirmed error-classification defect**, pre-existing, **not an R1.0
blocker**. *Underlying cause resolved 2026-07-31:* the same action **succeeded** later in
the same production session (B4 PASS). A missing grant cannot succeed on retry, so reading
**(A) genuine denial is eliminated** — the refusal was reading **(B)**, a non-authorization
failure reported as a refusal. The bare catch stands as the defect: it is what made a
transient failure indistinguishable from a permission problem, and it cost two rounds of
investigation to establish.

### 1. Observation

SYSTEM_ADMIN on `/users/{uat-id}`; the details page renders; the button « Générer un
nouveau mot de passe temporaire » **is visible**; a valid reason is chosen; « Générer le mot
de passe » returns « **Action non autorisée.** » and no password is generated.

### 2. Exact execution path

| Step | Location | What happens |
|---|---|---|
| 1 | `app/users/[id]/page.tsx:106` | Page passes `canGenerateTempPassword={canUserAdmin(permissions, "tempPassword")}` |
| 2 | `components/users/user-password-panel.tsx:196` | Button renders **only** when `canGenerateTempPassword && !isSelf` |
| 3 | `components/users/user-password-panel.tsx:200-203` | Click opens the confirm dialog (client state only) |
| 4 | `components/users/user-password-panel.tsx:101` | « Générer le mot de passe » calls `generateStaffTempPassword(user.id, { reason, note })` |
| 5 | `lib/users/password-actions.ts:1` | `"use server"` — server-action boundary |
| 6 | **`lib/users/password-actions.ts:104-108`** | **The failing block.** `try { admin = await assertAnyPermission(userAdminCodes("tempPassword")) } catch { return { ok:false, error:"forbidden" } }` |
| 7 | `lib/users/permissions.ts:47` | Codes checked: **`admin:users:temp_password`** OR **`admin:users:manage`** |
| 8 | `lib/users/password-actions.ts:102` → `components/users/user-password-panel.tsx:103` | `error:"forbidden"` → `t.users.errors.forbidden` → « Action non autorisée. » |

Execution **never reaches** the reason validation (`:110`), the self-check (`:113`), the
tenant-scoped target read (`:116-122`), GoTrue (`:126`) or the flag write (`:138`).

### 3. The seven questions

| # | Question | Answer |
|---|---|---|
| 1 | Which server action executes | `generateStaffTempPassword` — `lib/users/password-actions.ts:99` |
| 2 | Which permission(s) it checks | `admin:users:temp_password` **OR** `admin:users:manage` (`userAdminCodes("tempPassword")`) |
| 3 | Different permission than the page? | The **page-entry** gate is `read`; the **button** gate is `tempPassword` — *the same pair the action checks*, via the same `canUserAdmin`/`hasPermission` predicate (both are plain `Array.includes`, `lib/rbac/check.ts:10`). So no: the button and the action agree by construction. |
| 4 | Does tenant validation fail? | **Not reached.** The tenant-scoped read is `:116-122` and returns `not_found` → « Utilisateur introuvable. » — a **different** message. Ruled out by the observed string. |
| 5 | Does actor == target fail? | **Not reached.** `:113` returns `cannot_disable_self` → « Vous ne pouvez pas désactiver votre propre compte. » — a different message; and the button hides when `isSelf`. Ruled out twice. |
| 6 | Should SYSTEM_ADMIN be allowed by design? | **Yes.** Migration 71 grants all 7 codes to **every** `SYSTEM_ADMIN` role (`20260729000001…sql:110-124`, no tenant filter), and the umbrella remains accepted. |
| 7 | Production defect or expected behaviour? | The **message** is a confirmed defect (§4). Whether the refusal *itself* is correct depends on §5. |

### 4. The confirmed defect: a bare catch

```ts
try { admin = await assertAnyPermission(userAdminCodes("tempPassword")); }
catch { return { ok: false, error: "forbidden" }; }
```

`catch` with no discrimination maps **every** throw class to an authorization refusal.
`assertAnyPermission` (`lib/auth/require-permission.ts:41-47`) can throw for three
materially different reasons:

1. `PermissionError` — a genuine denial;
2. `getCurrentUser()` resolving to **null** — an *authentication* failure (expired or
   unrefreshable session), which is not a denial at all;
3. `getEffectivePermissions()` **throwing** — `lib/rbac/permissions.ts:29-31` raises
   `[rbac] failed to resolve permissions: …` on any RPC error — an *infrastructure* failure.

All three surface to the operator as « Action non autorisée. » **The message is therefore
not evidence of a permission problem**, and the same pattern repeats across the module.
No fix proposed.

### 5. What the evidence does and does not settle

Two readings survive, and they are mutually exclusive:

- **(A) Genuine denial.** The effective permissions lack both codes. But then step 2 could
  not have rendered the button — it is gated on the *same* pair. For (A) to hold, the page
  render and the click must have resolved different permission sets.
- **(B) Masked non-authorization failure.** The permissions are intact (consistent with the
  visible button) and `assertAnyPermission` threw for reason 2 or 3 above. An expired
  access token between page render and click produces exactly this, and would also explain
  why `createUser` / `archiveUser` — the same helper, the same module pattern — succeeded
  earlier in the session.

**Discriminators, cheapest first, all production-safe:**

1. **Hard-reload `/users/{id}` (Ctrl+F5) and immediately repeat the action.** Success on a
   fresh session ⇒ **(B)**, session-expiry masked as a refusal.
2. Still refused → on the same page click « **Envoyer un e-mail de réinitialisation** »
   (`admin:users:reset_password`, same module, different code; harmless — it mints a link
   to the test account). Refused too ⇒ the whole module, not one code.
3. Still ambiguous → the read-only query pair below. This is the sanctioned
   "a smoke test failed → look" exception:

```sql
select r.code as role, p.code as permission
  from public.role_permission rp
  join public.role r       on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
 where p.code like 'admin:users:%'
 order by 1, 2;

-- exactly what both gates call, for the administrator's own id
select code from public.get_user_permissions(
  (select id from public.app_user where email = 'seckbara23@gmail.com')
) where code like 'admin:users:%' order by 1;
```

If the second returns `admin:users:temp_password`, reading **(A) is eliminated** and the
refusal was a masked failure.

### 6. Is B4 blocked by an implementation defect?

**Not by a defect in the lever itself** — `generateStaffTempPassword` never executed, so
nothing about its behaviour has been contradicted. B4 is **blocked pending §5**: the answer
determines whether the obstacle is a grant gap (data, one INSERT), a session artefact (retry
resolves it), or an infrastructure failure (investigate the RPC). The bare-catch defect is
real and independent, and it is precisely what made this ambiguous — but it does not itself
prevent B4 from passing.

---

## OBS-R10-02 — `/users/{id}` refused while `/users` was accessible

**Raised:** 2026-07-31, during B4 · **Reporter:** operator (production)
**Classification:** ✅ **RESOLVED 2026-07-31 — no defect.** Operator screenshots confirmed
the refusal came from the UAT account's own session, exactly as the audit predicted. The
authorization system behaved correctly. Retained as a record of the audit.

### 1. Observation

While authenticated as SYSTEM_ADMIN (`seckbara23@gmail.com`): `/users` accessible, user
creation works, archive/suspend works — but `/users/{id}` for the UAT account returns
« Vous n'avez pas l'autorisation de gérer les utilisateurs. »

### 2. The authorization path, audited

| Question | Answer | File · line |
|---|---|---|
| Permission checked by `/users/[id]` | `admin:users:read` **OR** `admin:users:manage` | `app/users/[id]/page.tsx:41` → `canUserAdmin(permissions, "read")` |
| Granular instead of umbrella? | **No.** `userAdminCodes("read")` returns **both** codes and the gate passes if **either** is held | `lib/users/permissions.ts:47-54` |
| Does the check differ from the list page? | **No — identical call, identical argument, identical source array** | list: `app/users/page.tsx:40`; detail: `app/users/[id]/page.tsx:41` |
| Is the authenticated user evaluated correctly? | Yes — `requireUser()` then `getEffectivePermissions(current.id)`, the same pair the list page uses | `app/users/[id]/page.tsx:38-39` |
| Could the loader have produced this message? | **No.** `getAdminUser` → `listUsers` → `assertAnyPermission(userAdminCodes("read"))` **throws** on refusal (error boundary), and a missing record renders `t.users.errors.not_found`, a different string | `lib/users/service.ts:150-152, 73` |

The string « Vous n'avez pas l'autorisation de gérer les utilisateurs. » (`t.users.forbidden`)
occurs in exactly **two** places in the entire codebase — the two page gates above. So the
message pins the failure to the page gate, which means the effective permission array for
**that request** contained neither `admin:users:read` nor `admin:users:manage`.

### 3. Why this cannot be a route-level defect

Both routes read the same array, produced by the same function, for the same user id, and
apply the same predicate. **One session cannot yield both outcomes.** Therefore the two
observations were made in **two different request contexts**.

**Leading explanation:** the detail page was opened in the **private/incognito window
authenticated as the UAT account** — the window opened for B4's login step. That account was
deliberately created with **no roles** (per the B4 solo-operator procedure), so it is
authenticated (no `/login` redirect) and holds **zero** permissions — which renders exactly
this notice on `/users/{id}`. The SYSTEM_ADMIN evidence (list, create, archive) comes from
the main window.

### 4. The decisive test (no SQL, no writes)

**In the same window and tab that produced the refusal**, open `/users`:

| Result | Conclusion |
|---|---|
| `/users` **also** refuses | Session mix-up confirmed — **no defect**. Re-run the B4 steps in the SYSTEM_ADMIN window. |
| `/users` renders the directory while `/users/{id}` refuses, same tab, same minute | A genuine contradiction that the code cannot express. Escalate with: the account email shown in the topbar on **both** screens, the full `/users/{id}` URL, and whether a hard refresh changes it. The remaining candidate would be `get_user_permissions` returning an incomplete set for one request — a database-side issue, not a route-gate one. |

### 5. Effect on the release

- **Not an R1.0 blocker.** R1.0 ships no code; `app/users/[id]/page.tsx` has been in
  production since `2fec38b`, unchanged by this release.
- **Blocks B4 execution.** The lever under test — « Générer un nouveau mot de passe
  temporaire » — exists only on `/users/{id}`. B4 stays **OPEN** until the detail page is
  reachable in the SYSTEM_ADMIN session.

---

## DEF-R10-01 — a creation-time generated password does not arm the forced-change gate

**Raised:** 2026-07-31, during B4 · **Reporter:** operator (production)
**Classification:** **implementation defect, pre-existing — NOT an R1.0 release blocker**
(reasoning in §5) · **B4 verdict: still OPEN — the B4 mechanism was not exercised**

### 1. Observation

A staff account created for the UAT (`uat.r10@effitrans.sn`) with credential mode
« Générer un mot de passe temporaire » authenticated successfully with that password and
landed directly on `/dashboard`. No `/auth/change-password` interception occurred.

### 2. The four hypotheses, answered

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | `must_change_password` was never written | ✅ **THE ROOT CAUSE** | `lib/users/actions.ts:183` — `createUser`'s `app_user` insert names only `id, tenant_id, email, name, status`. It never writes `must_change_password`, `temp_password_expires_at` or `password_changed_at`. Migration 71 declares the column `boolean not null default false` (`20260729000001…sql:130`), so the row is created with the gate **disarmed**. |
| 2 | Login/session code ignores the flag | ❌ No | The flag is read on **every** authenticated staff request: `lib/auth/require-user.ts:61` calls `getStaffPasswordGate` and redirects on its verdict. `/dashboard` is guarded — `app/dashboard/page.tsx:40` calls `requireUser()`. |
| 3 | Middleware fails to redirect | ❌ No — **and by design** | `middleware.ts` refreshes the Supabase session only; its header states the AUTH-3 constraint: *"NO business-domain redirects"*. Enforcement is page-level, deliberately. Middleware was never the enforcement point, so it cannot have failed as one. |
| 4 | Lifecycle state-machine regression | ❌ No | `evaluatePasswordGate` (`lib/users/password-lifecycle.ts:120-132`) is a pure function: expiry first, then `mustChangePassword === true → "must_change"`, else `"ok"`. Given `false`, `"ok"` is the **correct** output. The machine behaved exactly as specified — it was handed a disarmed state. |

### 3. Why the test did not exercise B4

B4 tests the **migration-71 lever**: `generateStaffTempPassword`
(`lib/users/password-actions.ts:99`), reached from `/users/{id}` → « Générer un nouveau mot
de passe temporaire ». That function **does** arm the gate — `password-actions.ts:138-149`
writes `must_change_password: true`, `temp_password_expires_at` and `password_changed_at`
in one update, after changing the password, in that deliberate order.

The account instead authenticated with the **creation-time** credential produced by
`createUser` (Phase 5.0E-4), a path that predates migration 71 and was never updated to
write the new columns. **Two different generators, one of which arms the gate.** The
observed behaviour is therefore *correct for the path actually exercised*, and B4 proper
remains unrun.

### 4. The defect that is nonetheless real

The creation flow's own one-time panel tells the administrator, verbatim:

> « Transmettez-le de façon sécurisée ; **l'utilisateur devra le changer à la première
> connexion.** » — `lib/i18n.ts`, `users.credential.warning`

That is a promise the code does not keep. The audit action is likewise named
`USER_CREATED_WITH_TEMP_PASSWORD`, and the mode is labelled « Générer un mot de passe
**temporaire** » — three places call the credential temporary while nothing makes it
temporary. Consequence: an initial password chosen by an administrator, and known to that
administrator, can remain the user's permanent password indefinitely, with no expiry and
no forced rotation. Security-relevant (a shared secret persists), not an outage.

**No fix is proposed here** — investigation only, as instructed.

### 5. Classification reasoning

**Not an R1.0 blocker:**

- R1.0 ships **no code and no schema** — it reconciles the migration ledger and validates
  behaviour that was already deployed. This defect is in `createUser`, unchanged since
  Phase 5.0E-4 and untouched by migration 71 or by anything in R1.0. It is not a
  regression *introduced* by this release; blocking R1.0 would not remove it from
  production, and releasing R1.0 does not worsen it.
- Migration 71's lever is **not shown defective** — it is **not yet tested**. Nothing here
  contradicts the code path B4 targets.

**But B4 cannot be signed as PASS.** Its verdict stays **OPEN** until the *admin-issued*
temporary password is exercised from `/users/{id}`. If that retest fails, the finding is
promoted to an **R1.0 blocker**, because migration 71's central promise would then be
unproven in the running system.

**Deferred to a later release** as a code change, with the create/issue paths reconciled
(or the wording corrected to match the behaviour) — a decision to be taken deliberately,
not folded into a reconciliation release.

### 6. Exact execution trace (added 2026-07-31, after OBS-R10-02 was resolved)

**The create form executes `createUser()`. It never calls `generateStaffTempPassword()`** —
`components/users/users-admin.tsx` imports only from `@/lib/users/actions` (lines 15-23) and
has no reference to `password-actions.ts` anywhere.

| Step | Location | What happens |
|---|---|---|
| 1 | `components/users/users-admin.tsx:383-401` | Radio « Générer un mot de passe temporaire » sets `credentialMode = "generate"` |
| 2 | `components/users/users-admin.tsx:419-432` | Submit calls `createUser({ email, name, credentialMode, roleIds, sendWelcome, status })` |
| 3 | `lib/users/actions.ts:1` | `"use server"` — server-action boundary |
| 4 | `lib/users/actions.ts:79, 97` | `createUser` gates on `assertAnyPermission(userAdminCodes("create"))` |
| 5 | `lib/users/actions.ts:141` | `generateTempPassword()` — CSPRNG from `lib/portal/temp-password.ts:40`, **the same generator the admin lever uses** |
| 6 | `lib/users/actions.ts:166-170` | GoTrue `auth.admin.createUser({ email, password, email_confirm: true })` — the credential is live immediately |
| 7 | `lib/users/actions.ts:183-189` | **The decisive line.** `app_user` insert names `id, tenant_id, email, name, status` — **no `must_change_password`, no `temp_password_expires_at`, no `password_changed_at`** |
| 8 | `20260729000001…sql:130` | Column is `boolean not null default false` → row created **disarmed** |
| 9 | `lib/users/actions.ts:208-221` | Audit written as `USER_CREATED_WITH_TEMP_PASSWORD` — the name asserts a lifecycle the row does not have |
| 10 | `lib/users/actions.ts:235-242` → `users-admin.tsx:82-112` | Password returned once and shown by `CredentialPanel`, under the warning that promises a forced first-login change |
| 11 | first login → `lib/auth/require-user.ts:61` | Gate reads `false` → `evaluatePasswordGate` returns `"ok"` → `/dashboard` renders. **Correct behaviour on a disarmed row.** |

**Contrast — the lever B4 actually tests:**
`components/users/user-password-panel.tsx:101` → `generateStaffTempPassword`
(`lib/users/password-actions.ts:99`) → GoTrue password update (`:126`) → **flag update
(`:138-149`)** setting `must_change_password: true`, `temp_password_expires_at`,
`password_changed_at` → audit with `forcedChange: true` (`:166`).

**Root cause restated precisely:** the two paths share the password *generator* and nothing
else. Arming the lifecycle exists **only** in `generateStaffTempPassword`. `createUser`
dates from Phase 5.0E-4 and was never extended when migration 71 introduced the columns, so
in the create flow "temporary" means only *shown once*, never *must be changed* — while
three labels (the mode name, the panel warning, the audit action) say otherwise.

**Consequence for B4: none — no code fix is required.** The mechanism B4 tests is reachable
in the production UI today, on `/users/{id}`. DEF-R10-01 concerns the *create* path, which
B4 does not test.

### 7. One observation settles it definitively

The root cause above is read from code. The live discriminator, requiring no SQL, is on
`/users/{id}` for the UAT account — the row « **État du mot de passe** »:

| Reads | Means | Implication |
|---|---|---|
| « **Inconnu — aucune modification enregistrée** » | `must_change_password = false`, `password_changed_at = null` | **Confirms the root cause above.** The gate was never armed. |
| « **Mot de passe temporaire en attente de changement** » | `must_change_password = true` | The gate **was** armed and the user still reached `/dashboard` → the gate failed **open** (`lib/users/password-gate.ts:50` returns `"ok"` on any read error). That would be a **materially more serious** finding and an R1.0 blocker. |

Labels: `lib/users/password-lifecycle.ts:159-164`.
