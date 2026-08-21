# TMS-7 — End-to-End Production UAT: CLOSURE REPORT

**Frozen 2026-08-21.** Scope: the accumulated ratified acceptance criteria of
TMS-1, QO-1, TMS-2, TMS-3, TMS-4, TMS-5/5A/5B/5C and TMS-6. No feature
development was performed as part of TMS-7; every code change below exists
because a production UAT exposed a defect.

Evidence detail lives in `tms-7-uat-runbook.md`. This document freezes STATUS.

---

## 1. Final status — FROZEN

| Category | Result |
| --- | --- |
| **A — Automated suites** | **GREEN** — last CI **#556 GREEN** (`build` + `rls-tests`) on `5827abb`, the final code commit of the phase |
| **B — Production database verification** | **6 / 6 PASS** |
| **C — Human production UAT** | **24 / 24 PASS** |

**Category A, stated precisely.** CI is the authority: `rls-tests` applies every
migration to a real Postgres and runs the SQL suites, and it was GREEN on the last
code commit. A local run at closure reports **7173 passed / 1 failed**; the single
failure is the long-standing `tests/expense-approval-chain.test.ts` line-ending pin,
which fails only on Windows checkouts and passes in CI. It is recorded here rather
than rounded away, and it is unrelated to TMS-7 scope.

| Outcome | Count |
| --- | --- |
| **PASS** | **24** |
| **FAIL** | **0** |
| **BLOCKED** | **0** |
| **DEFERRED** | **0** |
| **NOT RUN** | **0** |

Every case in the ratified inventory was executed by the operator in production.
Nothing was skipped, waived, or closed on automated evidence alone.

---

## 2. Category B — database verification (read-only)

| Check | Result |
| --- | --- |
| B1 schema + interlocks live | `provider_table 1`, `exclusion_check 1`, `interlocks 2` |
| B2 no transport claims two executors | **0 contradictions** |
| B3 « En mission » is DERIVED, never stored | `UAT-TMS7-01` **AVAILABLE** with `engaged_now = 1` |
| B4 carrier history survives a rename | printed `UAT Transporteur SARL` ≠ registry `UAT Transporteur SARL — RENOMME UAT17` |
| B5 audit trail of the UAT session | provider / vehicle / transport / customs / document actions all present |
| B6 tenant isolation (structural) | **0 cross-tenant leaks** |

**B4 is the strongest single artefact of this phase**: the carrier-identity
snapshot invariant proven in the DATA, not merely in the interface.

---

## 3. UAT-11b — corrected semantics (recorded deliberately)

The acceptance criterion first issued for UAT-11b was **wrong**, and the
correction is recorded here rather than quietly dropped.

**Stated (incorrectly):** « PASS = the request raises the need WITHOUT creating a
transport; FAIL = submitting creates a `transport_record` ».

**Actual, ratified behaviour:** `requestTransport` **inserts a `transport_record`
with `status = "NOT_STARTED"`** and notifies the TRANSPORT_OFFICER holders.

> **`transport:request` creates a NOT_STARTED transport record and notifies
> Transport. This represents a RAISED OPERATIONAL NEED — not execution having
> started. Planning, assignment and execution remain under the appropriate
> Transport authority.**

That is why the interface then reads « Non démarré ». Under the criterion as
first written, a correct PASS would have been read as a FAIL, and
`transport_record = 0` would in fact have meant the request had FAILED.

The ratified distinction is **not** record-versus-no-record. It is **who may
start execution**:

| Lane | Authority | Effect |
| --- | --- | --- |
| `requestTransport` | `transport:request` | NOT_STARTED record + Transport notified. The requester does **not** execute |
| `createTransport` | `transport:create` | Creates the record; the holder proceeds to plan and assign |

### UAT-11b evidence — `EFT-IMP-2026-00006` / `UAT-TMS7-C`

| Assertion | Evidence |
| --- | --- |
| Actor authority | `account.manager.demo@effitrans.sn`, ACCOUNT_MANAGER only. Via `get_user_permissions`: `file:read` ✔ · `transport:request` ✔ · `transport:create` ✘. Set equality with the role: 43/43, **0 extra, 0 missing** |
| Pre-submit UI | « Aucun transport »; request lane visible; « Demander le transport » available; **no create/start control** |
| Request recorded | `transport_record` `status = NOT_STARTED`, `created_by = account.manager.demo@effitrans.sn`, `2026-08-21 00:19:41.579Z` |
| **Execution NOT started** | `vehicle_id` NULL · `provider_id` NULL · `driver_name` NULL |
| Audit | `transport.requested` by the demo account at `00:19:41.719Z`; `after.file_id` present, **no `note` key** |
| Transport notified | `00:19:42–43Z` to multiple active TRANSPORT_OFFICER holders (`transport.demo@`, `operations4@`, `logistics@`, others) |
| **Blank précision** | **VALID OPTIONAL BEHAVIOUR.** `notes: precision ? … : null` — optional by construction. It left `notes` NULL and omitted `note` from the audit payload. **Not part of the acceptance criterion**, which is the LANE and the authority boundary |

---

## 4. Defects found by production UAT, and fixed

TMS-7 was not a formality. Nine defects were found in production that the
automated suites could not have surfaced, each fixed with regression and
mutation coverage.

| Ref | Defect | Fix |
| --- | --- | --- |
| DEFECT-UAT13 | A constraint refusal was reported as a version conflict, telling the operator to refresh — an action that could never help | `7736be7` |
| DEFECT-UAT15 | « Vérifier » failed anonymously; the governance refusal had no French message | `c7fee6d` |
| **DEFECT-UAT15b** | **The verifier seat was bound by NO policy.** Document verification was structurally impossible platform-wide since WES-4H: `document_review` held **0 rows** | `1498e9f` (ratified RQ-15b, `ab2bacb`) |
| DEFECT-UAT15c | The surface that OPENS a dossier's process was unreachable — the only link to it appeared once the process already existed | `9355966` |
| DEFECT-UAT15d | Share and notify gated on the raw legacy `APPROVED` alias, so a verified document could never be shared; the same staleness under-counted analytics | `c92d43f`, `31a24e1` |
| UAT-17 enabler | `updateProvider` was complete, gated and audited — and called from nowhere | `cd86ba4` |
| UAT-17 UX | Two fields labelled « Raison sociale » on one page; the create form came first | `6568c3e` |
| UAT-17 header | The transport header read the LIVE registry name, so a rename appeared to rewrite history | `5a06d70` |
| DEFECT-UAT18a/b | A subcontracted order asserted « Aucun chauffeur affecté »; the page rendered bottom-up from a coordinate-origin inversion live since WES-4G | `5827abb` |

Ratified during the phase: **RQ-15b** (verifier seat fallback, `ab2bacb`) and
**RQ-18** (branch-aware order readiness, implemented `14a7ca9`).

Three defects shared one root pattern — **a capability that existed and worked,
with nothing leading to it** (Parc & Flotte in TMS-5A, the intake surface in
UAT-15c, provider editing in UAT-17). Worth carrying forward as a review lens.

---

## 5. Outside TMS-7 closure — NOT blockers

These four are **explicitly outside** this closure and are **not resolved here**.
None blocked a UAT case; none blocks release.

| Ref | Kind | State |
| --- | --- | --- |
| **RQ-18b** | Product decision | Should an order's mode describe the DOSSIER's international mode or the EXECUTION mode of the road movement? `transportMode` **deliberately UNCHANGED** |
| **Printed issue date vs PDF determinism** | Product decision | A printed generation date breaks byte-determinism; `generated_at` lives on the artifact row. Un-costed trade-off, not a defect |
| **Deposit legacy `APPROVED` write** | Technical debt | `lib/deposit/actions.ts` writes the legacy spelling on new rows. Harmless today. **NO GO**; preconditions for any change recorded (`52539df`) |
| **Customs-panel error placement** | Technical debt | A correct refusal renders far from the control that triggered it |

---

## 6. Production UAT artefacts retained

Retained deliberately as audited evidence; **no fixture cleanup performed**.

`UAT-TMS7-01` (fleet vehicle) · `UAT-TMS7-99` (vehicle with intervention history)
· `UAT Transporteur SARL — RENOMME UAT17` (subcontractor, renamed to prove the
snapshot) · the retired duplicate provider · `EFT-IMP-2026-00004`, `…00005`,
`…00006` · `account.manager.demo@effitrans.sn`.

---

## 7. Closure statement

**TMS-7 is CLOSED.** The ratified inventory is complete at 24/24 with zero
failures, zero blocked and zero deferred; the database invariants are evidenced
6/6; and every defect found during the phase was fixed, regression-covered,
mutation-tested, CI-verified and confirmed deployed in production before the
affected case was re-run.
