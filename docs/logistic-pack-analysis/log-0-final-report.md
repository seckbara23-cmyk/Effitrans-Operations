# LOG-0 — Final Report

**Date:** 2026-08-04 · **Read-only audit** — no production code, no migration, no
permission, no source file modified. Deliverable set: 13 documents in this folder.

## 1–4. Numbers

| Metric | Value |
|---|--:|
| Files reviewed | **120** (in 5 groups; 155 MB) |
| Safely machine-parsed | **108** (67 docx · 31 xlsx/xlsm · 10 PDF header-verified) |
| Requiring manual review | **12** (legacy OLE: 9 .xls, 1 .doc, 2 .ppt) |
| Containing real Effitrans operational data | **0** |
| Containing third-party demo/sample data | 40 (freeware workbooks + 1 sample planner) |
| Copyright-restricted (never commit) | 9 (published books/courses, ~87 MB) |
| Exact duplicate pairs | 3 |

**The single most important finding:** the pack is a **generic purchased template &
tool kit** (every file prefixed « Copie de », Scribd IDs on the books, placeholder-only
templates, freeware demo data) — **not** internal Effitrans records. It evidences the
document *vocabulary* and tool *categories* of the business, not its actual operations.

## 5. Main workflows discovered

W-1 import document chain (confirms the ratified 26-step doctrine) · W-2/W-3
procurement & sales **exception-path letter vocabularies** (rejection, non-delivery,
substitution, late delivery, returns; one explicit rule: 10-day silent acceptance of
verbal orders) · W-4 **mail register** (chrono, multi-support incl. postal, legal
response deadlines — the EC-relevant discovery) · W-5 **devis/facture model**
(Senegal-localized: TVA 18% + CA 5%, shared line shape) · W-6 register workflows the
platform already supersedes (EPI, formation, RH). Full detail: workflow-catalog.md.

## 6. Main conflicts / ambiguities

* Kit genericity vs Senegal reality: only MODELE FACTURE is localized; the customs kit
  lacks the entire Senegal chain (BAE, DPI, GAINDE) **the platform already models** —
  resolved in favour of the platform, flagged, not silently.
* `Lettre de Voiture` labeled "(Bill of Lading)" in one template — terminology
  conflation left as-is, noted for the alias table.
* Whether rail/TIR/river modes are used at all — unanswerable from sources (Q-OPS-2).
* Whether the stock tools mean Effitrans *does* warehousing or merely collected tools —
  unanswerable (Q-OPS-1). No conflict was silently resolved.

## 7. Platform coverage summary

13 SUPPORTED · 40 PARTIALLY · 12 NOT SUPPORTED · 1 SUPERSEDED · 3 duplicates · 26 OUT
OF SCOPE · 25 reference-only. The platform **out-models the kit** on customs and HR;
the uncovered ground is quotation (known: EC-3), warehouse, procurement/vendor,
insurance docs, claims, postal mail. Matrix: platform-coverage-matrix.md.

## 8. Top ten gaps

G-1 quotation entity (P1) · G-6 acceptance-evidence format (P1, blocks G-1) · G-2
warehouse domain (P2, decision first) · G-3 vendor domain (P2, decision first) · G-4
postal mail + response deadlines in EC (P2) · G-5 insurance doc types (P2) · G-7 claims
entity (P3) · G-8 outbound letter templates (P3) · G-9 mileage expenses (P3) · G-10
rail/TIR doc types (P4). Register with evidence: gap-register.md.

## 9. Top ten improvement opportunities

I-1 shared devis→facture line model (conversion without re-keying) · I-2 file-number
detection in inbound mail · I-3 inbound PDF type classification · I-4 arrival-notice →
ETA *suggestion* · I-5 lifecycle-driven delay/arrival notices · I-6 response-deadline
attention item · I-7 amount-in-words on devis PDF · I-8 insurance expiry surfacing ·
I-9 HR age-pyramid analytics (HR-9, ratification-gated) · I-10 licensed knowledge
content home.

## 10. Decisions required from Effitrans

**23 questions** across 9 sections (management-questionnaire.md). Blocking clusters:
**Q-COM-1..8** (EC-3) · **Q-COMM-1..4** (EC-2 scope + DEC-EC-D1) · **Q-OPS-1**
(warehouse go/no-go) · **Q-DOC-1** (catalog additions) · Q-LEG-1/2 (contracts,
insurance — with counsel).

## 11. Recommended changes to EC-1 and EC-3

**EC-1: no change.** Its purpose vocabulary, capture-then-triage order and
quarantine doctrine are all *confirmed* by the sources — the paper register works the
same way. **EC-3: enriched, not changed in boundary** — the devis line model, the
TVA 18%/CA 5% configurable cascade, amount-in-words, the DG signature seat and the
conversion-as-projection principle now have source evidence; its blockers
(Q-COM-1..8, DEC-EC-D5) stand.

## 12. Should implementation proceed?

**Yes — nothing in LOG-0 blocks the committed roadmap.** EC-2 can proceed on its
existing dependencies (RATIFY-EC1-1 / DEC-EC-D3), enriched by the intake map. EC-3
remains gated on its questionnaire cluster. New domains (warehouse, procurement,
claims) must not start before their go/no-go questions — audits only, if confirmed.

## 13. Exact next approved phase recommendation

**EC-2 — Triage Workspace**, preceded by the management sitting that answers
**Q-COMM-1..4 and grants RATIFY-EC1-1 / DEC-EC-D3** — because EC-2's scope (postal
capture? deadline tracking?) and its very testability (a triage seat must exist)
depend on those answers. In parallel, circulate the questionnaire's Q-COM cluster so
EC-3 is unblocked by the time EC-2 closes.

---
*Handling note: the source pack itself is ignored by git (copyright, not
confidentiality — zero Effitrans data found), with SHA-256 provenance recorded for all
120 files. Nothing was moved, renamed, or modified.*
