# Release Boundaries, Production Dashboard, Future Automation

Part of [RELEASE-0](README.md).

## 1. Release-boundary audit — the whole project, bundled

Method: boundaries follow **ratified sequencing and UAT-ability**, not module aesthetics.
Where the requested example grouping conflicts with a standing ratification, the
ratification wins and the difference is stated.

### Release 1.0 — Platform Foundation Consolidation *(next; fully specified)*

Migrations **68–71** + their UAT gates. Activates: official-invoice artifact +
three-hash parity · Douane discovery · `file:transition` · granular user administration +
staff password lifecycle. *Difference from the requested example:* the Finance **Aging**
foundation (72) is **not** in 1.0 — management explicitly ratified "do not combine
migrations 68–71 with the Aging migration"; it is 1.1.

### Release 1.1 — Finance Aging Foundation

Migration **72** + preview sign-off + Q-01. Activates the aging schema and permissions;
the workspace goes live per tenant via flag + grants.

### Release 1.2 / 1.3 — Aging Operations *(phases already specified)*

1.2: FIN-AGING-4 legacy import (~430 receivables through staging + maker-checker).
1.3: FIN-AGING-5..7 — snapshots/lifecycle, Excel/PDF renderers, secure sharing.

### Release 2.0 — Human Resources *(roadmap ratified in the HR governance addendum)*

2.0: HR-1 Dashboard + Organization Foundation, HR-2 Employee Workspace (registry is
already live — 2.0 activates *around* it), HR-3 Documents & Contracts, HR-4 Onboarding &
Equipment. 2.1: HR-5..HR-9 (leave/attendance, performance/training, payroll preparation,
offboarding, reporting) as their ratifications and legal gates (DEC-B63) close.

### Release 3.0 — Communications

Shared inbox / customer communications / email integration deepening. **Audit note:** the
Messaging Center (8.6A/8.7) shipped with an operator-applied migration + flag + rollout;
its production activation state must be *verified, not assumed* during 3.0 planning — the
release manifest for 3.0 starts with that probe.

### Release 4.0 — Maya Functional Parity & Cutover

The reverse-engineered business workflow document (commit `64f1c99`) is the parity
yardstick: 4.0 closes the gap between it and the legacy system's remaining functions,
then executes cutover (parallel-run window, data reconciliation, legacy read-only, final
sign-off by CEO). Scope is deliberately not enumerated here — it is the *residual* after
1.x–3.x, measured against the workflow doc, and gets its own audit phase (the standing
audit-first rule).

**Standing observation for all boundaries:** every release above is *activation-heavy and
code-light*, because the code is already engineered to ship dark. That is the intended
consequence of the expand→activate→contract doctrine, and it makes each release small,
rehearsed (CI runs every bundle from empty daily), and cheap to abort.

## 2. Production Release Dashboard (design; builds on `/platform/operations`)

The operations console already shows build-info, migration probe and health. The release
view extends it (platform-operator gated, later phase — design only):

| Panel | Content | Source |
|---|---|---|
| Current production version | served SHA (`/api/version`), deploy time, manifest link | existing endpoint |
| Migration status | expected LATEST_MIGRATION vs probed state; pending list (today: 68–72) | build-info + probes |
| Pending release / RC | manifest of the next bundle + its checklist state | `docs/releases/<version>/` |
| Outstanding UAT | per-seat sign-off state for the open release | release-decision doc |
| Known blockers | open ratification items gating activation (Q-01, HRQ-D2, …) | decision registers |
| Deployment history | releases with SHA, date, migrations, sign-offs, incidents | manifests marked DEPLOYED |

Until built, the dashboard exists as a **standing markdown status table** in
`docs/releases/STATUS.md`, updated at each release event — process first, automation later.

## 3. Future automation opportunities *(identified only; nothing implemented)*

| Opportunity | Sketch | Prerequisite |
|---|---|---|
| Release-notes generation | phase reports + commit trailers → draft notes | commit-message discipline (already strong) |
| Checklist generation | manifest → readiness checklist pre-filled with CI/probe results | manifest as structured data (yaml front-matter) |
| Migration validation harness | per-migration probe SQL committed next to each migration; runner executes probes post-apply | probe convention (§3 of migration-governance already writes them per bundle) |
| UAT tracking | sign-off state as structured data feeding the dashboard | release directory convention |
| Release approvals | in-app approval records (reusing maker-checker idioms) instead of doc signatures | platform-admin release surface |
| Production health reporting | scheduled verify-production + runtime-error summary posted per window | existing script + Vercel tooling |

Automation is adopted only after the manual process has run at least twice (R1.0, R1.1) —
automating an unrehearsed process encodes its mistakes.
