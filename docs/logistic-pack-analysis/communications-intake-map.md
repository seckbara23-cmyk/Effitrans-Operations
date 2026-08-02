# LOG-0 — Communications Intake Map

For each artifact class likely to arrive by email: mailbox purpose, triage outcome,
ownership, and automation safety — under EC-0's capture-then-human-triage doctrine.
**No inbound message creates anything automatically; every row below is a *suggested*
outcome a human confirms in EC-2.**

| Arriving artifact | Likely mailbox | Suggested triage outcome | Next-action owner | Becomes governed document? | Auto-suggestion safe? | Human review |
|---|---|---|---|---|---|---|
| New business inquiry / demande de cotation | quotation@ | **create Quotation Request** (EC-3) | Commercial | no (correspondence) | yes — suggest only | **mandatory** |
| Proforma / commercial invoice for a known shipment | operations@ / transit@ | attach to dossier | Transit | **yes — after human promotion** (`COMMERCIAL_INVOICE` etc.) | yes (file-number match) | mandatory |
| BL / AWB / packing list | operations@ | attach to dossier | Operations/Transit | yes — after promotion | yes | mandatory |
| Avis d'arrivée (carrier notice) | operations@ | attach to dossier | Operations | possibly (`ARRIVAL_NOTICE` — RMD) | yes | mandatory |
| Customs correspondence (déclaration, autorisation) | transit@ | attach to dossier | Transit | yes — after promotion | yes | mandatory — regulatory |
| Claim / réclamation | support@ | attach to dossier + flag | Operations (claims owner — Q-OPS-3) | evidence for a future claim entity (G-7) | classification only | **mandatory** |
| Vendor exception letters (rejection, non-delivery…) | operations@ (no procurement mailbox exists as a concept yet) | correspondence (client_id-less — vendor entity absent) | Achats | no | **no** — vendor domain unmodeled | mandatory |
| Invoice payment advice / bank notice | finance@ | attach to dossier or finance correspondence | Finance | possibly (`PAYMENT_RECEIPT`) | classification only | mandatory — money |
| HR-related mail (candidatures, attestations) | (no HR mailbox in scope) | correspondence / discard | HR | HR-3 private context if kept — **never `public.document`** | no | mandatory — C3 risk |
| Spam / unrelated | any | discard with reason | triage seat | no | classification suggestion | mandatory |

## Mailbox purposes to configure (DEC-EC-D1 input)

The kit's own folder structure + the Registre's «Services» sheet support exactly the
purpose vocabulary EC-1 shipped as configuration: **QUOTATION · OPERATIONS · TRANSIT ·
FINANCE · SUPPORT** [O]. No new purpose is needed; GENERAL covers the rest.

## The postal-mail finding

The Registre de courriers registers **courrier postal and télécopie alongside email**,
with chrono numbers and **legal response deadlines** [O]. EC-1 captures email only.
Whether Effitrans needs postal-mail registration inside EC (manual capture form — no
scanner integration invented) is **Q-COMM-1**, and response-deadline tracking
(`Délai légal en jours`) is **Q-COMM-2** — both material to EC-2's shape, neither
assumed.

## Doctrine confirmations

Capture-then-triage confirmed by the register's own arrival→routing sequence [O] ·
triage stays human; AI suggests (EC-5) [R] · attachments are evidence-in-waiting until
promoted (ADR-EC-5) [R] — the mapping above adds *which* WES-4 type each class promotes
into, which is exactly the EC-2 picker's vocabulary.
