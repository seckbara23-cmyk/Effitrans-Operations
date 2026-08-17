# EFFITRANS — Guide Centre de Marque: completion report & production UAT closure

**Date:** 2026-08-17 · **Audit:** `35697dd` (docs/brand/brand-guide-audit.md, CONDITIONAL GO,
RQ-BC.1–BC.3 ratified) · **Implementation BCG-A/B:** `0ac5296` (**CI #504 GREEN**) ·
**BCG-C closure:** this document.
**No migration, no permission, no Brand Center feature, no screenshots, no PDF.**

## Closure status

# **Guide Centre de Marque: COMPLETE / PRODUCTION-VALIDATED.**

Deployment and CI evidence were established before the verdict, as required: production
serves **`0ac529648263881de7e31209f084bf8267900d94`** (`/api/version`), CI run **#504** is
green on both jobs for that same commit, and the Vercel runtime logs show
`/brand-center/guide` served with **no error group** — alongside all thirteen Brand Center
routes, which confirms the contextual-link edits broke nothing.

The operator then exercised Steps 1–6 in production. All six pass. One wording nuance was
found and corrected (BCG-F1, below).

## Production UAT evidence (operator-observed, recorded verbatim)

> **Step 1:** Guide renders with live « Complétude de la marque : 11 éléments sur 11
> complétés », green state.
>
> **Step 2:** Contextual Aide navigation verified for Gouvernance and Réseaux sociaux; both
> land at their corresponding guide sections.
>
> **Step 3:** Gouvernance clearly presents the template lifecycle Brouillon → Approuvé →
> Publié → Retiré, states that only a Publié model is usable in production, and explicitly
> states « Un modèle ne peut être publié que si la marque est complète ». It also
> distinguishes governance from editing brand information and generating deliverables.
>
> **Step 4:** Cartes de visite et signatures explicitly sends client-specific
> Outlook/Gmail/Apple Mail/mobile installation to « Guides d'installation des signatures »
> and states those instructions are not repeated in the Centre de marque guide.
>
> **Step 5:** Production fidelity verified. Réseaux internationaux shows the « Ajouter une
> adhésion » action area with button « Ajouter » ; E-mailing marketing shows « Copier
> HTML » ; Présentations shows « Télécharger PPTX ».
>
> **Step 6:** « Ce que le Centre de Marque ne fait pas » verified in production: no e-mail
> sending/programming/tracking; no social campaign/programming; SVG input not accepted;
> accounts/names/e-mails/roles remain managed by Utilisateurs; brand values come from
> Direction; no pixel-perfect mail-client guarantee; generated deliverables are not treated
> as approved models.
>
> **Step 7** was optional and intentionally skipped to avoid altering valid production brand
> data.

**Corroboration of Step 1, queried read-only before the session:** all eleven completeness
items were satisfied in production — the three colours, the three fonts, both logos
published, slogan, proposition de valeur, site, adresse, URL de signalement, one active
membership, and one collaborator with a job title. The banner the operator observed,
« 11 éléments sur 11 complétés », is therefore the value the live model owed, not a
coincidence.

## BCG-F1 — a heading described as a button (found in UAT, corrected)

**Observed (Step 5):** in Réseaux internationaux, « Ajouter une adhésion » is the **section
heading**; the button reads « **Ajouter** ». The guide's step named the heading as though it
were the click.

**Why the structural test did not catch it:** the pin asserts the quoted label still exists
in its component — and it does, as an `<h2>`. A string can be present and still be
mis-described. Fidelity of *wording* was pinned; fidelity of *role* was not.

**Corrected:** the step now reads « sous « Ajouter une adhésion », renseignez … puis cliquez
sur « Ajouter » ». A new test pins both facts against the component: that « Ajouter une
adhésion » is an `<h2>`, that « Ajouter » is the button, and that the guide's step says
*sous* the heading and *cliquez sur* the button. A future edit that collapses the two turns
CI red.

This is the second time this project's own tests have taught the same lesson: a pin proves
the string exists, never that the sentence around it is true. Both times the correction came
from a human looking at the screen.

## What was delivered

* **`/brand-center/guide`** — the mode opératoire, gated on `admin:config:manage`
  (RQ-BC.3), audited on view, **14 sections**, each answering the same questions in the same
  order: qui · quand · étapes numérotées · éléments nécessaires · ce que la plateforme fait
  toute seule · ce qui se fait ailleurs · à définir par Effitrans.
* **Readiness computed from the product's own gate** (RQ-BC.1): « N éléments sur 11
  complétés », derived live, **no percentage**, each missing item named with the model's own
  evidence, and an explicit statement that holding the permission does not make the brand
  complete. Only publication and the generators are marked completeness-dependent; the
  editing screens never are, because they are *how* the brand becomes complete.
* **The three acts, separated**: **éditer** une information (immédiat) · **générer** un
  livrable (dérivé à la demande — un PDF téléchargé n'est ni approuvé ni publié) ·
  **gouverner** un modèle (Brouillon → Approuvé → Publié → Retiré, « Un modèle ne peut être
  publié que si la marque est complète »).
* **« Cartes de visite et signatures » as its own section** (RQ-BC.2), covering two real
  production routes on the `admin:users:manage` tier, and **linking** to « Guides
  d'installation des signatures » rather than duplicating it.
* **Contextual « Aide — mode opératoire »** on all thirteen Brand Center surfaces, each
  resolving its own anchor from its route.

## Tests and adversarial checks

23 structural tests. The **route census** guards all fifteen production routes and caught
`/brand-center/documents/[type]` missing from the first content map — a workspace cannot
silently become undocumented. Production wordings are pinned **per section** and against
their page. Mutations **X1–X8** all turn the suite red: hard-coded readiness, an editing
section gated on completeness, governance described as editing, the publication invariant
dropped, installation steps duplicated, a production limitation reworded, the completeness
model falling below eleven items, and the gate weakened. X6 first survived — the closing
« limites » page repeats several contracts — which is why the contract pins are now bound
per section.

Full vitest 6781 passed / 1 skipped, typecheck clean, build compiled with both guide routes
distinct.

## Scope held

No migration. No new permission. No Brand Center feature. No screenshots (RQ-BC.1 v1 rule).
No PDF (RQ-BC.4 deferred). No duplication of `/brand-center/guides`. No invented brand or
business content — colours, slogans, campaign copy and document text remain Effitrans', and
the guide says so where it matters.

## Carried forward — Effitrans content, not software

The brand itself is complete and all fourteen templates are published, so unlike HR there is
no readiness gap. What remains Effitrans' to supply is **content**: the text of documents,
decks and campaigns; the publication calendar for social posts; and the designation of who
is responsible for approving templates — the platform applies the lifecycle, it does not
name the person.

## Next

**HOLD.** The next product workstream is **TMS**, which starts only from its own ratified
lightweight roadmap and an explicit GO. No further Brand Center or HR phase begins.
