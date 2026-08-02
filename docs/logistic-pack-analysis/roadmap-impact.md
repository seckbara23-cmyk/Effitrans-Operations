# LOG-0 — Roadmap Impact

How the findings change or confirm each planned line of work.

## Confirmations (no change needed)

* **EC-1 Inbound Foundation — CONFIRMED, no correction.** The mailbox purpose
  vocabulary EC-1 shipped as configuration (QUOTATION/OPERATIONS/FINANCE/TRANSIT/
  SUPPORT) matches the kit's own structure and the paper register's Services sheet.
  Capture-then-triage is what the paper register already does (arrival first, routing
  second). Nothing in the pack argues for auto-creation of anything.
* **EC-0 doctrine — CONFIRMED.** The correspondence letters supply concrete examples of
  mail that must attach to a dossier rather than quote — the triage split is real.
* **Document doctrine (WES-4) — CONFIRMED and already ahead.** The platform's catalog is
  more specific than the generic kit (BAE, DPI, exonérations, sommier have no kit
  counterpart). The kit adds candidates, not corrections.
* **HR-4 / HR-6 — CONFIRMED.** The kit's EPI and formation tools are weaker versions of
  what already shipped. No change.

## Immediate corrections (this phase applied them)

1. **Source-pack exposure**: `docs/Logistic Pack/` added to `.gitignore` (the `*.docx`
   rule already covered 67 files; the folder rule covers the remaining 53 — books,
   xls/xlsm, ppt). Copyright, not confidentiality, was the live risk.
2. **None to code.** No finding invalidates any shipped behaviour.

## Near-term phases (order recommended)

| Phase | Impact from LOG-0 |
|---|---|
| **EC-2 Triage Workspace** | + `purpose`-based outcome suggestions (quotation@ → suggest quotation-request) · + candidate: response-deadline field & attention item (gated Q-COMM-2) · + candidate: manual postal-capture form (gated Q-COMM-1) · promotion picker uses the WES-4 types per the intake map |
| **EC-3 Commercial/Quotation** | **materially enriched**: line model evidenced (désignation/qté/PU HT; TVA 18% + CA 5% as configurable cascade; net à payer; amount-in-words; RIB; DG signature seat) · conversion = projection of the 9.0C intake spine · blockers unchanged: Q-COM-1..8 + DEC-EC-D5 — **EC-3 still must not start before they close** |
| **Doc-catalog increment** | ARRIVAL_NOTICE, CARGO_MANIFEST, insurance types, warehouse bons, CLAIM_NOTICE — one small migration *after* Q-DOC-1, not before |
| **Comms templates increment** | delay notice + arrival notice as `lib/comms` templates (their lifecycle events already exist) — G-8, smallest first |

## Future opportunities (decision-gated, unscheduled)

Warehouse/Inventory domain (WH-0 audit only, after Q-OPS-1) · Procurement/Vendor
(PROC-0, after Q-PROC answers) · Claims entity (Q-OPS-3) · fleet reservation ·
mileage expense rates · caisse recette register · EC-5 AI assists (I-2..I-4) ·
HR-9 analytics (pyramide) · knowledge/training content (licensed, never committed).

## Should NOT be built

* A stock module copied from the freeware workbooks *before* Q-OPS-1 — a spreadsheet
  tab is not a data model.
* A contract-lifecycle engine for 22 agreement kinds — typed document slots almost
  certainly suffice (Q-LEG-1 decides).
* An LMS from the Livres folder — HR-6 refused it; the books change nothing.
* Letter templates for workflows that do not exist (procurement letters before a vendor
  domain).
* Any project-management module from the gestion-de-projets tools — the process engine
  is the platform's model.
* Hardcoded TVA/CA rates, mileage rates, response deadlines or validity periods —
  configuration after ratification, always.

## Copilots / Portal / Reporting

Copilots: no new surface; EC-5 suggestions remain the plan. Portal: arrival/delay
notices could later surface to customers via the existing notify rail (I-5); no new
portal scope now. Reporting: register statistics → KPIs only via Q-EXE-1.
