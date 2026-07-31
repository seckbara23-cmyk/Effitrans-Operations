# Release Governance — Lifecycle, Types, Approvals, Documentation

Part of [RELEASE-0](README.md).

## 1. The release lifecycle

```
Architecture Approved          ratified decision docs (the DEC-*/HRQ-*/Q-* discipline)
        ↓
Implementation Complete        phase report delivered; commit SHAs named
        ↓
CI Green                       verified PER JOB, PER STEP (0 skipped) — already standing rule
        ↓
Internal Technical Review      the phase's own guards + cross-phase checks (readiness §1–2)
        ↓
Business Approval              the owning seat(s) ratify activation (matrix below)
        ↓
Release Candidate              a RELEASE MANIFEST is cut: SHA pin + migration list +
        ↓                      activation list + rollback pointer (template: 8.0A manifest)
Production Readiness Review    the checklist (production-readiness doc) walked and recorded
        ↓
Production Migration           operator runs the bundle per migration-governance.md
        ↓
Smoke Tests                    the smoke library for every affected module + the core sweep
        ↓
User Acceptance Testing        business validation by the owning seats (smoke-tests-and-uat)
        ↓
Release Sign-off               go/no-go recorded (template: 8.0 release-decision.md)
        ↓
Production Complete            manifest marked DEPLOYED; dashboard + history updated
```

Two structural notes that make this lifecycle honest for THIS platform:

- **"Production Migration" and "code deploy" are different events.** Code reaches
  production continuously; a release *activates* it. A release with no migration
  (documentation-only, flag-only) skips the migration step but not the record.
- **A release candidate is a manifest, not a branch.** Trunk-based delivery stays; the RC
  is the pinned SHA + the enumerated migrations + the enumerated activations, so "what is
  in this release" is always a document, never an inference.

## 2. Release types

| Type | Definition | Approval | Rollback expectation | Testing expectation |
|---|---|---|---|---|
| **Documentation-only** | `docs/**` changes | none beyond review | none | CI green |
| **Patch** | bug fix, no schema, no new permission, no activation change | technical review | Vercel promote-previous (minutes) | CI + affected-module smoke |
| **Minor** | new dark capability OR small activation (one flag/one grant) | owning business seat | deactivate flag / revoke grant; app promote-previous | CI + module smoke + owner UAT of the activated slice |
| **Major** | migration bundle + activation of a module (e.g. 68–71; 72+aging) | owning seat(s) **+ CEO where the matrix requires** | forward-fix first; PITR restore is the last resort (see rollback strategy) | full readiness checklist + smoke library + UAT + sign-off |
| **Database-only** | migrations with no behavior change until later activation (the expand step) | technical review + operator | forward-fix; restore last-resort | migration validation probes + core smoke |
| **Emergency hotfix** | production is broken; smallest correct fix forward | post-hoc review within 24h; CEO informed if customer-visible | Vercel promote-previous is the *first* lever, hotfix second | targeted smoke; full suite follows on the next regular release |

Emergency doctrine: **never redeploy old code over a newer schema** (standing rollback-plan
rule). If a migration is live, the fix is forward.

## 3. Approval matrix

| Domain touched | Required business approval |
|---|---|
| Finance (invoices, payments, aging, caisse, expense) | DAF; DGA where maker-checker seats change; CEO for new financial authorities (the 11.0D precedent) |
| HR (employee data, permissions, config) | HR administrator seat; CEO for confidential-access changes (HRQ-D4) |
| Operations / Transit workflows | OPS supervisor seat + the affected department head |
| Identity / RBAC / permissions | tenant SYSTEM_ADMIN informed; **granting an approval authority always needs the business owner of that authority, never IT alone** (the D-11/DEC-B61 doctrine) |
| Customer portal / customer-visible | CEO |
| Platform administration (cross-tenant) | platform operator + CEO |

Technical review is always additionally required and never substitutes for a business seat
— the same separation the platform enforces in-product (SYSTEM_ADMIN administers, does not
approve).

## 4. Required release documentation (per release; templates from Phase 8.0)

| Document | Purpose | Template/precedent |
|---|---|---|
| **Release Notes** | what changed, in operator and business language | phase reports |
| **Release Manifest** | SHA pin, migration list, activation list, verification results | `docs/production/release-manifest.md` |
| **Migration Notes** | order, prerequisites, per-migration validation, duration estimate | migration-governance.md template |
| **Known Issues** | accepted defects + workarounds | 8.0C acceptance |
| **Breaking Changes** | anything requiring user retraining or integration change | — |
| **Operator Instructions** | the exact commands/clicks, in order | preview-runbook precedent |
| **Support Notes** | what support may see in week one + responses | pilot-plan precedent |
| **Go/No-Go Checklist + Release Approval** | the recorded decision with names and dates | `docs/production/release-decision.md` |

Storage: one directory per release under `docs/releases/<version>/` once releases begin;
the manifest is the index. Every document names its release version and SHA.
