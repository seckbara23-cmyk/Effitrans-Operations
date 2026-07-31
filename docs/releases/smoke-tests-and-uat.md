# Smoke Test Library & User Acceptance Testing

Part of [RELEASE-0](README.md).

## 1. The two layers, kept separate

**Technical validation** proves the deployment is intact (CI on the SHA; migration probes;
API health; the sweeps below). It is owned by engineering/operator and is pass/fail by
machine-checkable criteria. **Business validation (UAT)** proves the *behavior* is the
business the owners ratified. It is owned by the seats, follows scripts agreed before the
window, and is pass/fail by the owner's signature. A release needs both; neither
substitutes for the other.

## 2. Core sweep (every release, first, automated)

`node scripts/gate/verify-production.mjs` — served SHA vs manifest, public routes 200,
auth-walled routes redirect, uniform-404s hold — plus `/api/version` env check and the
`/platform/operations` migration probe (LATEST_MIGRATION + permission-probe row). Owner:
operator. Pass = script exit 0 and probe matches the manifest.

## 3. Module smoke library

Format per test: *steps → expected result · owner · pass/fail criterion*. Run the modules
the release touches, always on production, always with test-designated accounts, never
with customer data.

| Module | Smoke | Expected | Owner |
|---|---|---|---|
| **Authentication** | staff login (password + Google); portal login; forced-change path if bundle includes 71 (issue temp password to a test account → next login lands on `/auth/change-password`; expired temp lands on the terminal notice) | each lands on the right home; no loop | operator |
| **Platform Administration** | platform login → tenant list renders; tenant lifecycle read | platform stack reaches no tenant data | platform operator |
| **User Administration** | `/users` renders; create test user (setup-email mode); role assign/revoke; details page password panel states (after 71: generate temp → one-time reveal → forced change) | each action succeeds + audit rows exist | tenant SYSTEM_ADMIN |
| **Finance** | invoice list; issue in test dossier; official PDF downloads with `X-Invoice-Sha256` (after 68: the three-hash check — finance download = portal download = stored hash); payment record + verify | hashes equal; statuses move | DAF/Finance officer |
| **Finance / Aging** (after 72 + activation) | `/departments/finance` shows the tile only with flag+permission; `/finance/aging` renders 5 tabs; foreign-currency exclusion notice; 366/365 boundary visible in critical tab | tabs reconcile to one total | DAF |
| **Transit** | customs record read; Douane account sees required-customs dossiers (after 69) | discovery works without assignment | Chef de transit |
| **Operations** | dossier open → workflow renders; « Avancer » visible to OPS_SUPERVISOR (after 70); closure gate names its blocker | transition permission works; closure honest | OPS supervisor |
| **HR** | `/departments/hr` renders for HR_OFFICER; SYSTEM_ADMIN sees zero employees; create/read test employee | exclusion holds in prod exactly as in CI | HR officer |
| **Messaging** | staff conversation send/receive; recipient picker gated | messages flow; no cross-department leak | OPS seat |
| **Document Management** | upload to test dossier; signed-URL download; review flow; BAE gate untouched | private buckets stay private | OPS seat |
| **Customer Portal** | portal login; shipment list; invoice PDF (same bytes/hash as staff-side) | isolation + parity | CEO-designate |

Each release's manifest lists which rows ran and their results; a row that cannot run
(module dark) is recorded as N/A-dark, never silently skipped.

## 4. UAT — business validation

- **Scripts first**: each owning seat receives a short scenario script derived from the
  release notes *before* the window (the UAT-1/UAT-2 pattern: named dossiers/records,
  expected outcomes, screenshots optional).
- **Real seats, test data**: UAT runs under the real production roles but against
  test-designated records; customer-visible checks use the designated pilot client only.
- **Defects triage during UAT**: blocker (sign-off withheld) · accepted-with-workaround
  (goes to Known Issues) · cosmetic (backlog). The 8.0C "GO(synthetic)/NO-GO(real)"
  precedent applies: a release can be signed for synthetic/pilot scope without being
  signed for full production scope, and the signature says which.

### Required sign-offs

| Seat | Signs for |
|---|---|
| Finance Manager (DAF) | Finance + Aging behavior, financial documents, hashes |
| Transit Manager | customs/transit flows |
| Operations Manager | dossier lifecycle, tasks, workflow |
| HR administrator | HR surfaces + data protections |
| Tenant SYSTEM_ADMIN | account administration, access, sessions |
| CEO | customer-visible changes; any release the matrix escalates; final go on Major releases |

Sign-off is recorded in the release-decision document with name, date, scope of the
signature, and any Known-Issues acceptances. **The pending R1.0/R1.1 releases already have
their UAT content defined** (UAT-2B three-hash smoke; Douane discovery; closure; temp-
password flow; aging preview checklist) — those become the first filled-in instances of
this process rather than new work.
