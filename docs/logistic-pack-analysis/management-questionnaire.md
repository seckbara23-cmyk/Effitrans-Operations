# LOG-0 — Management Questionnaire (Effitrans)

Only questions that materially affect architecture, workflow, configuration,
permissions or activation. Each cites why it matters. Register-ready IDs.

## Operations

* **Q-OPS-1** — Does Effitrans operate (or invoice) **warehousing/storage** as a
  service? *(Decides whether the Inventory/Warehouse domain (G-2) exists at all — 8
  collected stock tools suggest yes, nothing proves it.)*
* **Q-OPS-2** — Are **rail (CIM), TIR, river or intermodal** waybills ever used in your
  lanes? *(Decides 4 candidate document types — G-10.)*
* **Q-OPS-3** — Who owns a customer **réclamation** end-to-end, and what outcome states
  exist (accepted/rejected/compensated)? *(Decides claim entity vs conversation tag — G-7.)*
* **Q-OPS-4** — Are vehicles **reserved in advance** (calendar) or only assigned at
  execution? *(G-11.)*

## Commercial / Quotation

* **Q-COM-1** — What information is **mandatory** before a devis can be produced?
  *(Intake spine for EC-3 — the sources evidence parties/goods/route/value; confirm.)*
* **Q-COM-2** — What **numbering scheme** do devis follow? *(Counter design.)*
* **Q-COM-3** — What **validity period** applies, and what happens at expiry?
  *(State machine + G-6.)*
* **Q-COM-4** — Who **approves** a devis internally before sending — always the DG (as
  the template's signature seat suggests), or thresholds? *(Approval seat + permission
  design; maker-checker shape.)*
* **Q-COM-5** — What counts as **client acceptance evidence** — signed devis returned,
  email confirmation, portal click? *(The registry requires actor+date; the format is
  unratified — blocks conversion design.)*
* **Q-COM-6** — Must the **final invoice equal the accepted devis** (with governed
  amendments), or may they diverge freely? *(Determines whether quotation lines seed
  billing as a constraint or a copy.)*
* **Q-COM-7** — For **contract clients** who skip cotation: is one `has_contract` flag
  enough, or do contract kinds (représentation en douane, commission de transit…)
  change behaviour? *(One boolean vs a vocabulary — G-13.)*
* **Q-COM-8** — Are **TVA 18% / CA 5%** applied uniformly, or do exemptions per
  client/regime exist? *(Config model; RLC overlay.)*

## Transit / Customs

* **Q-TRA-1** — Do the 22 customs agreement kinds need lifecycle tracking (validity,
  renewal), or are they filed documents only? *(G-13.)*

## Finance

* **Q-FIN-1** — Should the **caisse recette register** (admin-caisse workbook) move
  into 9.3A, and what are its actual columns? *(Manual review + G-12.)*
* **Q-FIN-2** — Does Effitrans reimburse **mileage/fuel** at fixed rates? Whose rates?
  *(G-9 — rates are configuration, never platform defaults.)*

## Communications

* **Q-COMM-1** — Must **postal mail and fax** be registered alongside email (the
  Registre de courriers does today)? *(EC-2 scope — manual capture form, G-4.)*
* **Q-COMM-2** — Which inbound mail carries a **legal response deadline**, and what are
  the deadlines? *(Deadline field + attention item; values must come from you/counsel,
  never invented.)*
* **Q-COMM-3** — Does the **chrono numbering** of the paper register need to continue
  on-platform (continuity of an official register), or does a new sequence start?
* **Q-COMM-4** — Which five mailbox purposes go live first, on which addresses/domain?
  *(= DEC-EC-D1, restated with the kit's evidence: quotation@, operations@, transit@,
  finance@, support@.)*

## Document governance

* **Q-DOC-1** — Confirm the candidate additions: ARRIVAL_NOTICE, CARGO_MANIFEST,
  INSURANCE_CERTIFICATE/CARGO_POLICY, warehouse Retour/Sortie/Dépôt, CLAIM_NOTICE.
  *(Each is one catalog row + governance defaults — only wanted ones.)*
* **Q-DOC-2** — For inbound-promoted documents, does the **uploader/verifier
  separation** apply as for staff uploads (WES-4), or is triage-promotion itself the
  verification? *(EC-2 governance wiring.)*

## HR

* **Q-HR-1** — The kit's training tool is **request-driven (employee asks)**; HR-6 is
  assignment-driven pending HRQ-P1. Does employee self-service change priority?
  *(Re-poses HRQ-P1 with new evidence, decides nothing.)*

## Compliance

* **Q-LEG-1** — Who is authorized to sign each of the customs agreement kinds, and are
  scanned signed copies required on file? *(Storage class + signature governance.)*
* **Q-LEG-2** — Is cargo insurance **mandatory** on your shipments (own policy or
  client's), and must the platform block/warn without it? *(G-5 — blocking rules are
  ratified, never assumed.)*

## Executive reporting

* **Q-EXE-1** — Which of the paper register statistics (arrivals/departures per
  service, response-time) should become KPIs? *(Only ratified KPIs get built — the
  10.0D discipline.)*
