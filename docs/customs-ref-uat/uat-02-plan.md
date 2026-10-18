# CUSTOMS-REF-UAT-02 — controlled upload and quarantine testing

**Status: PLAN ONLY. Not authorized. Not executed.**

Scope: document upload, byte validation, metadata and regime normalisation,
quarantine state, publisher-only visibility, declarant isolation, audit and private
storage. Successor to [uat-01b-closure.md](./uat-01b-closure.md).

**Scanner and publication testing are deliberately NOT in this plan.** They are
separated into a later round (§9) because they require infrastructure that does not
exist, and mixing them in would make a GO on uploads imply a GO on publication.

---

## 0. Read this first — the one irreversible fact

**A document uploaded during UAT-02 cannot be deleted.** There is no
operator-facing delete path anywhere in the library. The only two `.delete()` calls
are compensation paths that fire when an audit write fails, to undo a half-created
document.

- Scan evidence is append-only — `prevent_mutation()` blocks UPDATE and DELETE;
  migration #153 states "Never updated or deleted."
- The stored object, its checksum, its version and its uploader are immutable after
  insert, enforced by `trg_customs_reference_identity`.
- Audit rows are append-only by platform rule.
- Storage objects for a finalised document have no application removal path.

The strongest available cleanup is **withdrawal**, which sets `WITHDRAWN` and makes a
document invisible to readers — but the row, its bytes and its audit trail persist
permanently.

This is not a defect. An authoritative reference library *should* be immutable. It
does mean UAT-02 leaves permanent residue in a production system, and that has to be
an explicit decision before execution, not a discovery afterwards. §8 is the
mitigation.

## 1. Preconditions

Every one of these must hold immediately before execution; any failure stops the run.

| # | Precondition |
|---|---|
| 1 | Application SHA matches the authorized release; `env = production` |
| 2 | Database fingerprint `7bc7cb666973` |
| 3 | Migration ledger `CLEAN`, 155/155, 0 pending, CLI cross-check agrees |
| 4 | Scanner **not** configured — `scan-callback` answers `503 scanner_unavailable` |
| 5 | Test accounts available with the effective permissions in §2, each role list confirmed |
| 6 | Target is the production URL, **never a Preview** |
| 7 | Execution authorization recorded, naming this plan |
| 8 | Finance worktree unchanged |

## 2. Test accounts and effective permissions

| Alias | Required effective permissions | Purpose |
|---|---|---|
| **PUB-A** | `customs:reference:read` + `customs:reference:publish` | uploads, metadata, attestations, submission |
| **PUB-B** | `customs:reference:read` + `customs:reference:publish`, **a different person from PUB-A** | the second actor for maker-checker; proves the self-approval refusal is about identity, not permission |
| **READ-A** | `customs:reference:read`, **and NOT** `customs:reference:publish` | declarant isolation |

**Record each account's full role list before starting.** UAT-01B produced an
ambiguous observation precisely because a multi-role account was assumed to be
single-role. An account whose effective permissions are unverified makes every
observation it produces unusable.

No account may be created, and no permission may be granted or revoked, for or
during this UAT.

## 3. Test documents — provenance and legal source (A)

Test documents must be lawful to hold and impossible to mistake for authoritative
text.

**Permitted sources.** A document the organisation already holds lawfully, or a
synthetic PDF generated for the test. A synthetic PDF is preferred for every case
except C, where a genuinely large file is needed.

**Forbidden.** The WCO Harmonized System Explanatory Notes, in any form. They are
licence-fenced by migration #152 and cannot be published without an explicit
licensing approval that has not been granted. Do not upload them even to a
quarantine state, and do not select `EXPLANATORY_NOTES` as the category for any test
document.

**Mandatory naming**, so no future operator can mistake a test row for a real one:

| Field | Value |
|---|---|
| `title` | `[TEST UAT-02 — NE PAS UTILISER] <short description>` |
| `reference_code` | `UAT02-<nn>` |
| `source_authority` | `Effitrans — test UAT-02` |
| `category` | `CIRCULAR` (never `EXPLANATORY_NOTES`) |
| `notes` | the change ID and the execution date |

## 4. Test matrix

Reversibility column: **No** means the row, bytes and audit persist permanently and
can only be withdrawn.

### B — small PDF upload (≤ 4 MB)

| | |
|---|---|
| Actor | PUB-A |
| Steps | Upload a ~1 MB synthetic PDF with §3 naming and complete metadata |
| Expected | `201`; the document appears to a publisher as **QUARANTINE / UNSCANNED / licence RESTRICTED**, provenance and legal version unverified |
| Production objects | 1 `customs_reference_document` row; 1 storage object `<tenant>/<id>.pdf` in the private `customs-reference` bucket |
| Audit | `CUSTOMS_REFERENCE_UPLOADED` |
| Reversible | **No** — withdraw only |

### C — large PDF upload (> 4 MB, ≤ 50 MB)

| | |
|---|---|
| Actor | PUB-A |
| Steps | Upload a ~6 MB PDF. The browser takes the direct-to-storage path automatically |
| Expected | A ticket is minted, bytes go straight to the bucket, finalisation returns `201`; same QUARANTINE state; the staging object is removed |
| Production objects | 1 row; 1 final object; 1 transient `<tenant>/_staging/<uploadId>.pdf` that must be gone afterwards |
| Audit | `CUSTOMS_REFERENCE_UPLOADED` with `via: direct_upload` |
| Reversible | **No** — withdraw only |
| Watch | If finalisation is abandoned mid-flight the staging object is orphaned and nothing sweeps it (known open finding REF-2 F-2). Do not abandon this upload |

### D — byte-signature and size validation

| Case | Actor | Input | Expected | Writes |
|---|---|---|---|---|
| D-1 | PUB-A | an executable renamed `.pdf`, declared `application/pdf` | refused **`not_a_pdf`** — the magic number decides, not the declared type | none (≤4 MB). On the >4 MB path a staging object is created then dropped |
| D-2 | PUB-A | a file > 50 MB | refused **`too_large`** before any ticket is minted; the bucket's own 52 428 800-byte limit is the second line | none |
| D-3 | PUB-A | a PDF under 1 024 bytes | refused **`too_small`** | none |
| D-4 | PUB-A | a valid PDF with a deliberately wrong declared size | refused **`size_mismatch`** | none |

All of D is reversible: no document is created.

### E — metadata and regime normalisation

| Case | Actor | Input | Expected |
|---|---|---|---|
| E-1 | PUB-A | omit the title | refused `title_required` |
| E-2 | PUB-A | omit the source authority | refused `authority_required` |
| E-3 | PUB-A | omit the reference code | refused `reference_code_required` |
| E-4 | PUB-A | `published_on` = `2026-13` | refused `published_on_invalid` |
| E-5 | PUB-A | regimes `" transit ", "MISE EN CONSOMMATION", "Transit", "", ` *(empty)* | stored as exactly `{MISE EN CONSOMMATION, TRANSIT}` — trimmed, upper-cased, de-duplicated, sorted, blanks dropped |
| E-6 | PUB-A | one regime over 48 characters | **refused**, not truncated |
| E-7 | PUB-A | more than 24 regimes | refused |

E-1 to E-4, E-6 and E-7 write nothing. **E-5 writes** — it updates the regime column
on a document created in B.

### F — quarantine state and publisher-only visibility

| Case | Actor | Expected |
|---|---|---|
| F-1 | PUB-A | the B and C documents are listed with a *pending verification* lifecycle badge |
| F-2 | PUB-A | the documents are **not** publishable; the UI names the missing conditions |
| F-3 | PUB-A | requesting a scan is refused with `scanner_unavailable`, and the scan control is disabled with "Analyse indisponible" |

F-3 writes an audit row if a scan is actually requested; prefer observing the
disabled control.

### G — declarant isolation from unpublished references

**The highest-value tests in this round.** Run them immediately after B and C, while
quarantined documents exist and nothing is published.

| Case | Actor | Expected |
|---|---|---|
| G-1 | READ-A | the library renders and shows **zero documents** — the quarantined B and C documents are invisible |
| G-2 | READ-A | no upload form, no publisher controls, no antivirus notice, no publication-state filter |
| G-3 | READ-A | a regime or title search that *would* match the quarantined documents returns **zero** results |
| G-4 | READ-A | requesting the B document's PDF by its id returns **404 `not_found`** — not 403, so the existence of the document is not disclosed |

G-4 writes nothing (the refusal precedes the audit write). G-1 to G-3 write nothing.

**G-3 is the first test in this programme that can actually prove search correctness
in the negative**, because a matching document will exist and must still not be
returned.

### H — audit evidence and private storage

| Case | Expected |
|---|---|
| H-1 | each upload produced exactly one `CUSTOMS_REFERENCE_UPLOADED` audit row naming the actor, the document, the reference code, the size and the sha256 |
| H-2 | no audit row attributes an action to a NULL or system actor |
| H-3 | the storage objects exist under `<tenant>/` and the bucket remains private (`public = false`), PDF-only, 50 MB-capped |
| H-4 | no `_staging/` object remains after C |
| H-5 | `content_sha256` on each row equals the sha256 of the stored bytes |

H is read-only, but **requires a database and storage read path that the browser does
not provide.** Either accept it as verified by migration #152's live verifier (which
already asserts the bucket is private and PDF-only, and that stored bytes are
immutable), or request a separate read-only authorization for a governed query. Do
not grant yourself ad-hoc SQL access to satisfy a checklist.

## 5. Expected production objects, consolidated

If the full matrix runs:

| Object | Count | Permanent? |
|---|---|---|
| `customs_reference_document` rows | **2** (B, C) | **Yes** — withdraw only |
| Storage objects in `customs-reference` | **2** final | **Yes** |
| Transient `_staging/` objects | 1, removed by finalisation | No |
| `CUSTOMS_REFERENCE_UPLOADED` audit rows | 2 | **Yes** |
| Other audit rows | 0–2 if a scan is requested or regimes updated | **Yes** |
| `customs_reference_scan` rows | **0** — no scanner | — |
| Permission, role or user changes | **0** | — |

## 6. Mandatory security gates

Non-negotiable for this and every later round.

1. **No publication without a verified CLEAN scan.** Enforced by the database
   (#153, verified live at 34/34). Do not attempt to work around it.
2. **No development scanner stub in production, ever.** The stub refuses to start
   unless its callback is loopback; do not try to defeat that. Do not set
   `CUSTOMS_SCAN_ENDPOINT` in production as part of UAT.
3. **No simulated CLEAN verdict.** Not by stub, not by hand, not by any route.
4. **No bypass of maker-checker.** Submission and approval must be two different
   people. The self-approval refusal is a result to observe, not an obstacle.
5. **No manual ledger modification.** No `--record-only`, no `db:push`, no direct SQL
   against `supabase_migrations`.
6. **No permission, role or account changes** for or during UAT.
7. **No transactional testing against a Vercel Preview.** One Vercel project, no
   Supabase branching: a Preview is bound to the **production** database. Use the
   production URL only.
8. **No deletion of audit evidence to tidy up.** Audit is append-only and must stay
   that way. A permanent test row is the accepted cost of testing in production.
9. **No unrelated Finance changes.** The Finance worktree carries uncommitted
   CTRL-C-4B work and must remain byte-identical.
10. **No migrations, deployments or code changes** during the UAT window.

## 7. Failure handling and stop conditions (J)

**Stop the run immediately** on any of:

- an unexpected `500` from any library surface;
- a document reaching any state other than QUARANTINE after upload;
- a quarantined document visible to READ-A (that is a confidentiality failure —
  stop, record, and report before doing anything else);
- a `403` for a publisher or a `201` for a non-publisher;
- any publication succeeding;
- any scan evidence row appearing;
- the migration ledger ceasing to read `CLEAN` 155/155;
- the application SHA or database fingerprint changing mid-run.

On stop: record the exact step, preserve all evidence, change nothing, and report.
**Do not attempt a rollback or a manual repair** — there is no supported undo, and
improvising one is how a test becomes an incident.

## 8. Cleanup and retention (I)

Cleanup cannot mean deletion. It means making the residue unmistakable and inert.

1. **Withdraw** every test document at the end of the session, with a reason naming
   the change ID. A withdrawn document is invisible to readers.
2. **Inventory** every created document id, storage path and audit action in the
   execution record, so the residue is accounted for rather than discovered later.
3. **Retain** the audit trail untouched — it is evidence, not clutter.
4. **Keep the files small.** A 6 MB file is enough for case C; there is no reason to
   leave 50 MB in the bucket permanently.
5. **Do not reuse** `UAT02-` reference codes in a later round; increment the suffix,
   so each round's residue is distinguishable.
6. If the organisation later wants the rows physically removed, that is a separate,
   separately-authorized corrective migration with its own verifier — not a UAT step.

## 9. Explicitly deferred to a later round

Not in UAT-02, and a GO here is not a GO for any of it:

- scanner provisioning and hosting;
- EICAR detection and the clean-PDF-accepted case;
- a successful publication;
- the maker-checker positive path (it needs a CLEAN scan);
- withdrawal-after-publication and the rescan-finds-infection path;
- replacement and version lineage, which is most meaningful once a published
  document exists.

## 10. GO / NO-GO criteria for UAT-02

**GO requires all of:**

1. §1 preconditions all hold at execution time.
2. §2 accounts available, each with its full role list recorded.
3. Written acknowledgement of §0 — that test documents are permanent and can only be
   withdrawn.
4. Execution authorization naming this plan.
5. Agreement that §9 is out of scope.

**NO-GO if:** any precondition fails, a scanner is configured, no genuine
non-publisher account exists (G becomes untestable and G is the point), or the
permanence in §0 has not been explicitly accepted.
