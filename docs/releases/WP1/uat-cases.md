# Release WP1 — controlled operational UAT cases

**Release:** WP1 (see `release-manifest.md`) · **Status:** PREPARED, NOT EXECUTED.
**Gate:** DEC-CEO-18 (UAT environment). **Never on a Vercel Preview** — it writes the production database.

If the owner authorises production records:
- one dedicated UAT client (« UAT WP1 — ne pas facturer »), dossiers numbered by the normal sequence (no invented numbers);
- test PDFs only, no real customer documents;
- every created dossier noted « UAT WP1 » in the reference field;
- cleanup through the governed paths only: `cancelFile` (audited) for dossiers, `deleteDocument` (soft delete, audited) for documents. Audit rows and `document_expiry_change` rows are append-only and **remain** — that is the evidence.

Evidence per case (SOP v2.0 §6 sheet): UTC timestamp · dossier · actor and role · route · button · exact text displayed · conforme ?

| ID | CEO | Actor | Steps | Expected | Evidence |
|---|---|---|---|---|---|
| UAT-WP1-01 | CEO-001 | Admin | Open `/users`, find a user holding the role | Role reads « Business Development Manager » | screenshot |
| UAT-WP1-02 | CEO-003 | Account Manager | Create an IMP dossier without a PO | Saved; « Identification du dossier » shows « PO client — »; the dossier shows « Information à compléter : PO client (ouverture du dossier, étape 3)… » | screenshot + dossier number |
| UAT-WP1-03 | CEO-003 | Account Manager | Close step 3 on that dossier | **Allowed** (non-blocking in this release) | step state |
| UAT-WP1-04 | CEO-003 | Account Manager | Edit the dossier, enter PO « UAT-PO-001 » | Saved; advisory disappears; audit `file.updated` shows before `null` → after `UAT-PO-001` | audit row id |
| UAT-WP1-05 | CEO-003 | Account Manager | Enter a 65-character PO | Refused: « Le PO client ne peut pas dépasser 64 caractères. » | exact text |
| UAT-WP1-06 | CEO-003 | Account Manager | Enter « Régime douanier prévu » = « Mise à la consommation » | Saved and shown in identification | screenshot |
| UAT-WP1-07 | CEO-003 | Déclarant | Open the customs panel | Read-only line « Régime douanier prévu à l'ouverture : Mise à la consommation — information préliminaire des Opérations, non déclarative. »; the « Régime » field is NOT pre-filled | screenshot |
| UAT-WP1-08 | CEO-003 | Account Manager | Try to edit customs fields | No customs edit control (no `customs:update`) | screenshot |
| UAT-WP1-09 | CEO-004 | Account Manager | Upload a scanned ordre de transit, type « Ordre de transit / instruction client » | Document UPLOADED, not verified; no expiry demanded | document id |
| UAT-WP1-10 | CEO-004 | (blocked) | File an inbound e-mail from `/mail/inbox` | **Not executable** until DEC-CEO-20 (no role holds `communication:inbound:read`) | record as BLOCKED |
| UAT-WP1-11 | CEO-010 | Déclarant | On an UNVERIFIED certificate of origin: « Modifier l'échéance » without a reason | Refused: « Indiquez le motif de la modification. » | exact text |
| UAT-WP1-12 | CEO-010 | Déclarant | Same, with a reason | « Échéance mise à jour. »; history line « Échéance modifiée le … par … — old → new — motif » | screenshot |
| UAT-WP1-13 | CEO-010 | Chef de Transit (holds `document:update` AND `document:approve`) | On a VERIFIED document: « Proposer une nouvelle échéance » | « Nouvelle échéance proposée… »; date unchanged; amber pending banner | screenshot |
| UAT-WP1-14 | CEO-010 | Same Chef de Transit | Look for « Confirmer » on their own proposal | Not offered: « En attente de confirmation par un autre vérificateur. » (the database refuses `self_approval_forbidden` even if forced) | screenshot |
| UAT-WP1-15 | CEO-010 | Responsable Opérations (another `document:approve` holder) | « Confirmer » | « Échéance confirmée et appliquée. »; status still Vérifié; history shows CONFIRMED | screenshot + audit |
| UAT-WP1-16 | CEO-010 | Chef de Transit, then Responsable Opérations | Propose again; the second approver presses « Refuser » without a reason | Refused: « Indiquez le motif de la modification. »; with a reason → « Proposition d'échéance refusée. » | exact texts |
| UAT-WP1-17 | CEO-006 | Pickup Agent | Open the document list | No « Modifier l'échéance » (no `document:update`) | screenshot |
| UAT-WP1-18 | CEO-002 | Any | Evidence sheet | Every row carries date AND time (UTC) | sheet |
| UAT-WP1-19 | CEO-010 | Chef de Transit, then Responsable Opérations | Propose a new date on a VERIFIED document; have the document re-reviewed and rejected; then press « Confirmer » | « Cette proposition ne peut plus être confirmée… »; the date does not move; « Refuser » with a reason closes the proposal | exact text + history |
| UAT-WP1-20 | CEO-010 | Chef de Transit (the proposer) | Look for a way to withdraw your own open proposal | None is offered; the proposal stays until another approver decides (documented limitation, release manifest §7) | screenshot |

Sign-off per seat: Business Development Manager, Account Manager, Déclarant, Chef de Transit, Administrateur. GO (synthetic) / NO-GO (real) scoping per `docs/releases/smoke-tests-and-uat.md`.
