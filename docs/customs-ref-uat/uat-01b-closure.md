# CUSTOMS-REF-UAT-01B — closure record

**Status: CLOSED for its read-only browser scope only.**

This record closes the read-only browser testing of the Customs Reference Library.
It does not close the feature, and it does not close UAT. What was not tested is
listed as plainly as what was, because a closure record that blurs the two is how
untested behaviour reaches customers.

---

## 1. Baseline

| | |
|---|---|
| Application | `https://effitrans-operations.vercel.app` |
| Application SHA | `c456735e9c6f72f5ded0f7bb7455401fb35dfaef` |
| Database fingerprint | `7bc7cb666973` |
| Migration ledger | **155/155, `CLEAN`**, latest `20261019000001`, 0 pending, CLI cross-check agrees |
| Scanner | **not configured** — `/api/customs/reference/scan-callback` answers `503 scanner_unavailable` |

Re-verified at the time of writing, not merely quoted from the earlier run: the live
`/api/version`, `origin/main` and the read-only integrity guard all still report the
values above.

## 2. What was exercised, and by whom

Three browser sessions, manually operated:

1. **A multi-role account** holding SYSTEM_ADMIN, CHIEF_OF_TRANSIT **and** COORDINATOR.
2. **A dedicated CUSTOMS_DECLARANT session** — effective permissions exclude
   `customs:reference:publish`.
3. **A dedicated Chef de Transit session** — full effective role membership not
   independently audited.

Nothing was uploaded. No publication action was submitted. **No document PDF was
opened**, which matters: opening one writes a `CUSTOMS_REFERENCE_ACCESSED` audit row
([app/api/customs/reference/[id]/pdf/route.ts:78-79](../../app/api/customs/reference/%5Bid%5D/pdf/route.ts)),
and this scope was required to leave no trace. Rendering the page and running any
search write nothing — `lib/customs/reference/service.ts` contains no insert, update,
delete, RPC or audit call.

## 3. Results

Verdicts mean: **PASS** observed in a browser · **PARTIAL** visually consistent but
not independently established · **NOT TESTABLE** needs published or quarantined
documents · **BLOCKED** needs a scanner or an authorization · **NOT EXECUTED**
outside this scope.

### 3.1 Rendering and navigation

| ID | Check | Role | Verdict |
|---|---|---|---|
| R-1 | Library page renders, no error | all three | **PASS** |
| R-2 | Search card present | all three | **PASS** |
| R-3 | Zero documents shown | all three | **PASS** (consistent — nothing is published, and the library is empty) |
| R-4 | "Réinitialiser" clears the filters | multi-role, declarant | **PASS** |

### 3.2 Publisher-only controls — the load-bearing result

| ID | Check | Role | Verdict |
|---|---|---|---|
| P-1 | Upload form **visible** | multi-role | **PASS** |
| P-2 | Upload form **visible** | Chef de Transit | **PASS** |
| P-3 | **Upload form ABSENT** | **declarant** | **PASS** |
| P-4 | Antivirus warning **visible** | multi-role, Chef de Transit | **PASS** |
| P-5 | **Antivirus warning ABSENT** | **declarant** | **PASS** |
| P-6 | Publication-state filter **visible** | Chef de Transit | **PASS** |
| P-7 | **Publication-state filter ABSENT** | **declarant** | **PASS** |
| P-8 | PDF selector present in the upload form | Chef de Transit | **PASS** |

**P-3, P-5 and P-7 are the most valuable findings in this round.** They are the first
runtime evidence that the UI authorization gates behave as designed, and they
exercise three distinct gates:

- [components/customs/reference-library-panel.tsx:141](../../components/customs/reference-library-panel.tsx) — `{canPublish && <UploadForm …/>}`
- [components/customs/reference-library-panel.tsx:131](../../components/customs/reference-library-panel.tsx) — `{!scannerConfigured && canPublish && …}`
- [components/customs/reference-search.tsx:87](../../components/customs/reference-search.tsx) — the publication-state select

None of those three gates has an automated regression test. Until one exists, P-3
is the only thing standing between a future edit and a read-only role being offered
an upload form. See §6.

### 3.3 Search and filtering

| ID | Check | Verdict |
|---|---|---|
| S-1 | Regime filter control present and accepts input | **PASS** |
| S-2 | Current-edition filter present and applies | **PASS** |
| S-3 | A regime search (`TRANSIT`) returns zero results without error | **PASS** — for *control behaviour and query execution* |
| S-4 | Search **accuracy** — that the right documents match | **NOT TESTABLE** |
| S-5 | Title / type / source / version search accuracy | **NOT TESTABLE** |

S-3 and S-4 are deliberately separated. A zero-result search against an empty table
proves the control renders, the parameter reaches the server and the query runs. It
proves nothing about matching. Search accuracy requires documents and belongs to
UAT-02.

### 3.4 Visibility and isolation

| ID | Check | Verdict |
|---|---|---|
| V-1 | Declarant sees no publisher controls | **PASS** |
| V-2 | Only published documents visible to a reader | **NOT TESTABLE** — none published |
| V-3 | Quarantined documents hidden from a reader | **NOT TESTABLE** — none exist |
| V-4 | SYSTEM_ADMIN-only isolation | **PARTIAL** — the account also held CHIEF_OF_TRANSIT and COORDINATOR |
| V-5 | CHIEF_OF_TRANSIT-only isolation | **PARTIAL** — effective role membership not audited |
| V-6 | Tenant isolation | **NOT EXECUTED** — single tenant; asserted by migration #152's verifier, not browser-tested |

### 3.5 Out of scope in this round

| ID | Check | Verdict |
|---|---|---|
| X-1 | Upload API behaviour (any of the three endpoints) | **NOT EXECUTED** |
| X-2 | Byte-signature and size rejection | **NOT EXECUTED** |
| X-3 | Regime normalisation on write | **NOT EXECUTED** |
| X-4 | Submission for publication, maker-checker refusal | **NOT EXECUTED** |
| X-5 | Successful publication | **BLOCKED** — requires a verified CLEAN scan |
| X-6 | Antivirus detection (EICAR) | **BLOCKED** — no scanner provisioned |
| X-7 | Private-storage object checks | **NOT EXECUTED** |
| X-8 | Audit-record verification | **NOT EXECUTED** |

## 4. What this record explicitly does NOT claim

- **Not claimed:** that SYSTEM_ADMIN-only isolation was independently proven. The
  account used held three roles, and `get_user_permissions` unions all assigned
  roles, so the observed permissions were the union.
- **Not claimed:** that CHIEF_OF_TRANSIT alone is sufficient for publisher access.
  That session's full role membership was not audited.
- **Not claimed:** that search works correctly. No document has ever been matched.
- **Not claimed:** that quarantine isolation was browser-tested. No quarantined
  document exists.
- **Not claimed:** that any upload API was exercised.
- **Not claimed:** that a publication succeeded. None was attempted, and none can
  succeed without a scanner.
- **Not claimed:** that antivirus detection works. It remains unproven.

## 5. Related closed item — the COORDINATOR observation

An earlier manual session reported a COORDINATOR account seeing the upload form. The
RBAC audit established that the account held SYSTEM_ADMIN and CHIEF_OF_TRANSIT as
well, which fully explains it. The permission contract was found correct in all three
sources — migration #152's grant, the role templates, and production's live state
(asserted by #152's verifier: the roles holding `customs:reference:publish` are a
subset of `{SYSTEM_ADMIN, CHIEF_OF_TRANSIT}`, verified live at 36/36). **No defect.**
Closed.

## 6. Open item carried forward

**The three UI authorization gates in §3.2 have no automated regression test.** The
service layer, the API gates and the migration grants are all pinned by tests; the
component render gates are not. P-3, P-5 and P-7 are currently their only
verification, and a manual browser check does not survive a refactor.

Recommended: a structural test asserting `UploadForm` appears nowhere outside a
`canPublish` guard, and that the scanner notice and the publication-state select are
likewise gated. Small, and it converts this round's best finding into a permanent one.

## 7. Closure

**CUSTOMS-REF-UAT-01B is closed for its read-only browser scope.** The library
renders correctly for publishers and for a read-only declarant, the publisher-only
surface is correctly hidden from a non-publisher, and no unexpected errors were
observed in any session.

Everything that requires a document in the library, or a scanner, remains untested
and is carried into [uat-02-plan.md](./uat-02-plan.md).
