# EC-3A — Finance Reuse Audit (before any quotation table exists)

**Date:** 2026-08-05 · **Documentation only.** Companion to
[ec-3a-governance-freeze.md](ec-3a-governance-freeze.md).
Principle applied: **reuse first; build only what truly does not exist.**
Tags: **[O]** observed in code · **[R]** ratified · **[I]** inferred · **[MD]** management decision.

---

## Verdict table

| Asset | Exists? | Verdict for Commercial |
|---|---|---|
| `billing_charge` | ✅ | **REUSE as the conversion TARGET** — do not extend, do not reuse as quotation lines |
| `invoice_line` | ✅ | **REUSE the SHAPE, not the table** |
| `invoice` | ✅ | **DO NOT TOUCH** — a quotation is not a draft invoice |
| Customer (`client`) | ✅ | **REUSE unchanged** — one customer entity, no commercial duplicate |
| Tax | ❌ **no table** — a `tax_rate` *column* only | **BUILD NOTHING** until MD-Q10 |
| Currency | ❌ **no table** — a `text` column defaulting `'XOF'` | **REUSE the column convention**; no currency registry |
| Pricing / tariffs | ❌ **nothing exists** | **BUILD NOTHING** — MD-Q9/Q10; not EC-3B scope |
| Document templates | ⚠️ partial — one narrow table, three unrelated mechanisms | **REUSE the pattern, not the table** |
| PDF generation | ✅ mature | **REUSE wholesale** — engine + immutable-artifact discipline |
| Numbering engine | ⚠️ **5 copies of one pattern, no shared engine** | **REUSE the PATTERN**; consider consolidation — see §9 |

**Net: Commercial needs 3 new tables** (`quotation_request`, `quotation`, `quotation_line`)
**and 1 counter**. Everything else already exists or must not be built yet.

---

## 1. `billing_charge` — REUSE as the conversion target

```
tenant_id · file_id → operational_file · description · quantity numeric(12,2)
unit_amount numeric(14,2) · tax_rate numeric(5,2) · currency text 'XOF'
created_by · deleted_at (soft delete) · timestamps                          [O]
```

**It is keyed to a DOSSIER (`file_id`, NOT NULL)** [O]. A quotation exists *before* any
dossier — often before the customer has accepted. So `billing_charge` **cannot** hold
quotation lines: there is no dossier to point at, and making `file_id` nullable would
weaken an invariant Finance relies on.

**Correct use:** at conversion (EC-3D), accepted quotation lines **project into**
`billing_charge` rows on the newly created dossier. That is exactly the seam the field
already implies, and it means Finance's billing path is unchanged.

**Do not** add `quotation_id` to `billing_charge` — that would make a Finance table
depend on a Commercial one and invert the boundary [R].

## 2. `invoice_line` — REUSE the shape, not the table

```
invoice_id → invoice (NOT NULL) · charge_id → billing_charge · description
quantity numeric(12,2) · unit_amount numeric(14,2) · tax_rate numeric(5,2)   [O]
```

Bound to an `invoice`, so unusable directly. But the **shape is the right shape** — and
LOG-0 independently found the tenant's own DEVIS and FACTURE sharing one line model [O].
`quotation_line` should mirror these four business fields so conversion is a projection,
not a translation.

**One deliberate divergence to decide (MD-Q9):** Finance uses `numeric`; aging, HR-5
(day-tenths), HR-6 (basis points) and FIN-AGING (integer minor units) use **integers** [O].
Recommendation stands: **integer minor units for new Commercial tables**, converting at
the Finance boundary — quotation→invoice arithmetic is money arithmetic, and `numeric`
was chosen in June before that discipline was ratified. **This is the single most
consequential schema decision in EC-3B**, because it is the one thing that cannot be
changed later without a data migration.

## 3. `invoice` — DO NOT TOUCH

```
file_id (NOT NULL) · client_id · invoice_number (null until issued)
status DRAFT|ISSUED|PARTIALLY_PAID|PAID|VOID · currency · issue/due date  [O]
```

Tempting analogy — "a quotation is a draft invoice" — and **it is wrong**. An invoice is
an *accounting document* about work owed on an existing dossier; a quotation is a
*commercial offer* that may never become either. Overloading `invoice.status` with
quotation states would put pre-sale objects into the accounting ledger, break the
`file_id NOT NULL` invariant, and entangle two lifecycles with different owners [R].

**Reuse instead:** its *patterns* — number-null-until-issued, `unique (tenant_id, number)`
tolerating multiple draft NULLs, and the tenant-match trigger idiom.

## 4. Customer — `client` REUSED UNCHANGED

```
name · ninea (Senegalese business id, unique per tenant) · segment · email
phone · address · account_manager_id · status active|archived               [O]
```

**No commercial customer entity is needed.** `client` already carries the identity,
the NINEA (which a quotation header needs), the segment and the account manager.
A quotation references `client_id`.

**One gap, already known:** `client.has_contract` **does not exist** [O] — the ratified
contract-customer distinction has no home. That is a **one-column additive change on an
existing table**, not a new entity (MD-Q7).

**A prospect who is not yet a client** is a real case a quotation must handle
[MD-Q13 — new]: either a client row is created first (today's only option), or
`quotation_request` carries a free-text prospect name until conversion. **Not decided
here** — it materially affects whether triage can hand off a quotation for an unknown
sender.

## 5. Tax — NOTHING EXISTS, AND NOTHING SHOULD BE BUILT

There is **no tax table anywhere** [O]. Tax appears only as `tax_rate numeric(5,2)
not null default 0` on `billing_charge` and `invoice_line` — a **per-line rate with a
zero default**, i.e. the platform has never encoded a tax rule.

That is not an omission to fix in EC-3B. It is the correct state until **MD-Q10** answers
whether rates are per tenant, per client or per service. LOG-0's observation of
TVA 18% + CA 5% is **one tenant's document**, not a platform rule [O], and this is a
multi-tenant platform.

**EC-3B recommendation:** `quotation_line.tax_rate` mirrors the existing column — a
*field the tenant fills*, defaulting to 0, with **no rate, no cascade and no total
formula in code**. A quotation must render correctly with no tax line at all.

## 6. Currency — REUSE THE COLUMN CONVENTION

No currency table, no FX rates, no conversion [O]. Currency is `text not null default
'XOF'` on `billing_charge`, `invoice` and `payment`.

**Reuse exactly that.** Do not introduce a currency registry or multi-currency logic:
nothing in the platform converts between currencies, and a quotation in one currency
converting to an invoice in another is an unratified business question, not a schema gap.

## 7. Pricing — NOTHING EXISTS

No tariff table, no rate card, no price list, no service catalogue [O]. Prices are typed
per line, everywhere, today.

This is **consistent with the ratified position** ("pricing rules unknown — do not
invent") [R], and it means EC-3B has nothing to reuse *and nothing to build*. A tariff
grid is a genuine future capability, but it belongs after pricing rules are ratified —
**not in EC-3B, and not inferred from the fact that quotations have prices**.

## 8. Document templates — REUSE THE PATTERN, NOT THE TABLE

Three unrelated mechanisms exist [O]:

| Mechanism | Nature | Reusable for quotations? |
|---|---|---|
| `expense_template` | table: `template_code`, `version`, `checksum`, `status DRAFT/ACTIVE/RETIRED`, `active_from` | **pattern yes, table no** — its CHECK hard-codes the two expense codes |
| `hr_template_version` | immutable versioned rows (`code`, `version`, `body_md`) | pattern: versioning discipline |
| `lib/comms/templates.ts` | code registry of ~13 outbound email templates | **REUSE directly** for sending a quotation |

**Recommendation:** the `QUOTATION` PDF is generated by the renderer (§9), not from a
stored template asset, so **no template table is needed in EC-3B**. If Effitrans later
wants a branded quotation template with versioning, `expense_template`'s shape is the
precedent to copy — and its `checksum` + `status` + `active_from` columns are the
governance worth copying.

**The outbound email that carries the quotation reuses `lib/comms` `queueAndSend`** —
one new template key, no new engine [R].

## 9. PDF generation — REUSE WHOLESALE

The most valuable reusable asset found:

* `lib/reports/pdf.ts` — hand-rolled `PdfDoc` engine, no dependency, TOP-LEFT origin [O]
* `lib/finance/invoice-artifact.ts` — **`ensureOfficialInvoiceArtifact`**: renders once,
  hashes the bytes (`sha256Hex`), stores in the **private** documents bucket, records a
  governed `document` row with a **`renderer_version`**, and returns the *existing*
  artifact on re-request [O]
* `app/api/invoices/[id]/pdf/route.ts` — streams bytes through the service role;
  **no signed URL reaches the browser**; staff need `finance:read`, a portal user must
  belong to the invoice's client [O]

**A quotation PDF should follow this path exactly**: render → hash → store as a
`QUOTATION` document (the type already exists) → serve through a protected route. That
gives the sent quotation the same evidentiary weight as an invoice, which matters because
**a sent quotation is customer-facing evidence and immutable** (ADR-Q3).

**Reuse note:** the UAT-2B discipline — *the emailed attachment is the exact stored
artifact, never re-rendered* [R] — applies directly to sending a quotation.

## 10. Numbering engine — REUSE THE PATTERN; A SHARED ENGINE DOES NOT EXIST

**Five counter tables and five near-identical functions** [O]:

| Counter | Function | Format |
|---|---|---|
| `file_counter` | `next_file_number(tenant, type)` | per type |
| `invoice_counter` | `next_invoice_number(tenant)` | `EFT-INV-{year}-{00001}` |
| `employee_counter` | `next_employee_number(tenant)` | matricule |
| `expense_authorization_counter` | `next_expense_authorization_number(tenant)` | — |
| `expense_voucher_counter` | `next_expense_voucher_number(tenant)` | — |

Every one is the same shape: `(tenant_id, year)` PK, `next_seq`, an upsert-increment
returning the sequence, `security definer`, revoked from `public`, granted to
`service_role`. **This is a repeated pattern, not a shared engine** — and a quotation
counter would be the sixth copy.

**Recommendation:** EC-3B adds `quotation_counter` + `next_quotation_number(tenant)`
following the pattern **exactly** — a sixth copy is honest and low-risk. Generalising all
five into one engine is a tempting refactor that would touch five live numbering paths,
including invoices, whose numbers are accounting artifacts. **Do not do it inside EC-3B.**
Recorded as a standalone hygiene candidate.

**Note the hard-coded `'EFT-'` prefix in `next_invoice_number`** [O] — a tenant prefix
baked into a function in a multi-tenant platform. Not EC-3's to fix, but the quotation
counter **must not repeat it**: derive the prefix from tenant configuration or omit it
(**MD-Q11**).

---

## What EC-3B must actually build

| New object | Why nothing existing serves |
|---|---|
| `quotation_request` | no pre-dossier commercial entity exists; EC-2's handoff has nowhere to land |
| `quotation` | `invoice` is an accounting document on an existing dossier (§3) |
| `quotation_line` | `invoice_line`/`billing_charge` are bound to invoice/dossier (§1, §2) |
| `quotation_counter` + `next_quotation_number` | pattern reuse, sixth instance (§10) |
| `quotation:validate` permission | act 2 is unrepresented (freeze FINDING-1) |
| `client.has_contract` column | additive, on the existing table (§4) |

**And nothing else.** No tax table · no currency table · no pricing table · no template
table · no PDF engine · no numbering engine · no customer entity · no communication path.

## New management questions raised by this audit

| Ref | Question | Blocks |
|---|---|---|
| **MD-Q13** | Can a quotation address a **prospect who is not yet a `client`**, or must a client row exist first? | EC-3B schema + EC-2 handoff usefulness |
| **MD-Q14** | Confirm quotation lines project into `billing_charge` at conversion (not into `invoice_line` directly). | EC-3D |
| **MD-Q15** | Should the quotation PDF be a **stored immutable artifact** (invoice discipline) or rendered on demand? *Recommended: stored — a sent quotation is evidence.* | EC-3C |

Existing questions this audit sharpens: **MD-Q9** (money type — now the most consequential
EC-3B decision) · **MD-Q10** (tax — nothing exists to build on, which is correct) ·
**MD-Q11** (numbering — note the `EFT-` precedent to avoid).
