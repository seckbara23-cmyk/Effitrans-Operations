# Official invoice artifacts — immutability and re-issue policy

**Status:** binding · **Established:** UAT-2B · **Restated and enforced:** 2026-07-31
(DEF-R10-05, the renderer geometry correction)

## The rule

An official invoice PDF is generated **exactly once** and its bytes are **never** replaced.
The SHA-256 of those bytes is what makes the document verifiable years later; rewriting them
would silently invalidate every copy already delivered, emailed, printed or archived by a
customer, an auditor or a bank.

This is enforced in two independent places, and both must stay:

| Layer | Enforcement |
|---|---|
| Application | `ensureOfficialInvoiceArtifact` returns the stored artifact **before** calling the renderer (`lib/finance/invoice-artifact.ts`) |
| Database | `finalize_official_invoice` returns the existing row with `already: true` — it never updates, never supersedes (`supabase/migrations/20260728000001…sql`) |

Deliberately **not** `finalize_generated_artifact`: that function supersedes a previous
version, which is precisely what an accounting document forbids.

Pinned by `tests/invoice-byte-integrity.test.ts` — no application code may `update` a
recorded `content_sha256`, and the early return must precede the render call.

## What a renderer change does and does not do

`INVOICE_RENDERER_VERSION` is stamped on every artifact at finalization.

| Version | Meaning |
|---|---|
| `uat2b-1` | original release — correct content, **inverted geometry** (DEF-R10-05) |
| `uat2b-2` | 2026-07-31 — geometry corrected to the top-down contract |

A renderer correction therefore reaches **only invoices issued after it deploys**:

- invoices already issued keep their original bytes, hash **and** `renderer_version`;
- nothing in the deploy rewrites, regenerates or re-hashes them;
- the two populations remain distinguishable forever, by that column.

**This is the intended outcome, not a limitation.** An accounting document is a record of
what was issued, not a view that re-renders.

## Re-issuing a defective invoice

Correcting a *delivered* invoice is a **business act**, never a deployment side-effect. No
code path performs it today, and none may be added that does it implicitly.

Any future mechanism must satisfy all of:

1. **Explicit and permissioned** — a named action a human invokes, behind its own permission,
   never a background job, migration, or "regenerate on next download".
2. **Additive** — the original artifact is retained. The correction is a **new** document with
   its own number, bytes and hash; the original stays downloadable as the historical record.
3. **Audited** — actor, timestamp, target invoice, reason from a closed vocabulary, and both
   hashes (superseded and superseding), written append-only.
4. **Customer-visible** — a customer who received the original must be able to see that it was
   superseded and by what. A silent swap is worse than the defect it fixes.
5. **Accounting-correct** — in Senegalese practice a delivered invoice is corrected by a credit
   note (*avoir*) plus a new invoice, not by editing the original. Any implementation follows
   the accounting rule, not the convenience of the software.

Until such a mechanism is ratified and built, invoices issued under `uat2b-1` **stay as they
are**. Their content — amounts, totals, client, dossier, numbering — is correct; only the
layout is poor.

## Consequence to weigh at scheduling time

The population of `uat2b-1` invoices is frozen at whatever exists when `uat2b-2` deploys,
and every invoice issued before then joins it permanently. That is the argument for
deploying the correction promptly — not because the release depends on it, but because the
cost of waiting is measured in permanently mis-laid-out accounting documents.
