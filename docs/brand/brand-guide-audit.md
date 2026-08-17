# EFFITRANS — Guide Centre de Marque: architecture & current-state audit

**Date:** 2026-08-17 · **Status: AUDIT ONLY — nothing implemented.** ·
**Baseline:** HR-1…HR-10 closed (`8538ad7`, CI #502). Pattern of record: HR-10
(`docs/hr/hr-10-guide-sop-audit.md` + its completion report) — one guide route, content as
typed data, contextual « Aide » links, availability computed rather than written.

**Verdict: CONDITIONAL GO — three decisions (RQ-BC.1…RQ-BC.3). None is a blocker; one
changes what the guide computes, and answering it wrong would make the guide say something
untrue about this product.**

---

## 1. Current state — every route, gate and artifact (verified from source)

Fourteen page routes plus one export route. Two authority tiers, **both held by the same
nine active accounts** in production (`admin:config:manage` 9, `admin:users:manage` 9).

| Workspace (exact title) | Route | Gate | Produces |
|---|---|---|---|
| Centre de marque (hub) | `/brand-center` | `admin:config:manage` | completeness view |
| Identité de marque | `/identity` | `admin:config:manage` | stored identity |
| Ressources visuelles | `/assets` | `admin:config:manage` | published PNG assets |
| Réseaux internationaux | `/memberships` | `admin:config:manage` | membership registry |
| Identité collaborateurs | `/people` | `admin:users:manage` | per-person identity |
| — carte de visite | `/card/[userId]` | `admin:users:manage` | digital card |
| — signature | `/signature/[userId]` | `admin:users:manage` | HTML signature |
| Modèles de documents | `/documents`, `/documents/[type]` | `admin:config:manage` | **PDF + DOCX** |
| Présentations | `/presentations` | `admin:config:manage` | **PPTX** |
| Réseaux sociaux | `/social` (+ `/social/export`) | `admin:config:manage` | **SVG + PNG** |
| E-mailing marketing | `/marketing` | `admin:config:manage` | **HTML** (copy-paste) |
| Gouvernance de la marque | `/governance` | `admin:config:manage` | lifecycle decisions |
| Centre de téléchargement | `/downloads` | either tier | all deliverables |
| Guides d'installation des signatures | `/guides` | `admin:users:manage` | **existing help surface** |

**The hub's `SOON` list is empty** — nothing is « Bientôt disponible ». The Brand Center is
fully built.

## 2. The two models the guide must get right

**Completeness — exactly 11 items** (`deriveBrandCompleteness`), which is the figure in the
proposed scope: Couleurs officielles · Typographie · Logo principal (PNG) · Logo e-mail
(PNG) · Slogan · Proposition de valeur · Site web · Adresse · URL de signalement · Réseaux
internationaux · Identité collaborateurs. It reports « N éléments sur 11 complétés » with
per-item evidence, and deliberately shows **no percentage** — honest evidence, not false
precision.

**Governance — a template lifecycle, not asset editing.** This is the distinction the
brief asks to protect, and the product states it plainly in its own subtitle: « Cycle de
vie des modèles (Brouillon → Approuvé → Publié → Retiré). **Un modèle ne peut être publié
que si la marque est complète.** » Five categories (SIGNATURE, DOCUMENT, PRESENTATION,
COMMUNICATION, MARKETING_EMAIL); transitions are constrained both forward and back
(`APPROVED → DRAFT`, `PUBLISHED → APPROVED`, `RETIRED → DRAFT`); only **Publié** is
production-usable.

So the guide must separate three different acts that users conflate:
1. **Editing content** (a colour, a logo, a person's job title) — immediate, no approval;
2. **Generating a deliverable** (PDF, PPTX, PNG, HTML) — derived on demand, nothing stored;
3. **Governing a model** (Brouillon → Approuvé → Publié) — an approval decision, gated on
   brand completeness.

## 3. Production state — staffed and populated, unlike HR

| Fact | Value |
|---|---|
| `admin:config:manage` / `admin:users:manage` holders | **9 / 9** (same accounts) |
| Published assets | **2** — `LOGO_PRIMARY`, `LOGO_EMAIL_PNG` |
| Templates | **14, all `PUBLISHED`** |
| Membership registry rows | 1 |

Because a template cannot reach **Publié** unless the brand is complete, fourteen published
templates are themselves evidence that the eleven completeness items are satisfied today.

**This inverts HR-10's headline.** There, the finding was « the capability exists but nobody
can operate it ». Here, everything is staffed and the brand is complete — so the guide's
honest job is different: explain the three-act distinction above, and mark what is
**Effitrans content** versus **platform behaviour**.

## 4. Existing help surface — and the naming collision to avoid

`/brand-center/guides` already exists: **« Guides d'installation des signatures »**,
per-mail-client numbered instructions (Outlook, Gmail, Apple Mail, iOS, Android, Mailchimp,
HubSpot, Dynamics), gated on `admin:users:manage` and audited on view. It is *installation*
help, not a mode opératoire.

Two consequences: the new guide must be **named and routed distinctly** (`/brand-center/guide`
— singular — « Guide Centre de Marque — mode opératoire »), and its « Identité
collaborateurs » section must **link to** the existing installation guides rather than
restate them. A test should pin that the two surfaces stay distinct.

*(Noted: that page carried the same audit defect as UAT-HR10-01 — `entityId: "install"` on
a uuid column — fixed in `b4a570e` with the HR-10 blocker. It is currently working.)*

## 5. The product already documents its own boundaries — quote them

Each workspace subtitle states a limit, in French, in production. The guide should quote
these rather than invent equivalents:

* Ressources visuelles — « Le SVG n'est pas accepté ; les logos partenaires nécessitent
  l'accord d'usage. » (PNG, max 100 Ko)
* Réseaux internationaux — « Saisissez uniquement des informations approuvées ; les logos
  partenaires ne peuvent être ni modifiés ni recolorés. »
* Identité collaborateurs — « Le nom, l'e-mail et les rôles restent gérés par le module
  Utilisateurs. »
* E-mailing marketing — « Aucun envoi, aucune programmation, aucun suivi. »
* Réseaux sociaux — « Pas de campagne, pas de programmation. »
* Identité de marque — « Les couleurs restent vides tant que la Direction ne les a pas
  fournies. »
* Guides d'installation — « aucune compatibilité pixel-perfect n'est garantie. »

These become « Ce que la plateforme ne fait pas » and « Ce qui se fait ailleurs », verbatim.

## 6. Proposed guide-section map (14 sections)

Same seven-field shape as HR-10 — **Qui · Quand · Étapes numérotées · Éléments nécessaires ·
Ce que la plateforme fait toute seule · Ce qui se fait ailleurs · À définir par Effitrans**.

| # | Section | Route documented |
|---|---|---|
| 1 | Prise en main | — (hub tile) |
| 2 | Complétude de l'identité de marque (les 11 éléments) | `/brand-center` |
| 3 | Identité de marque | `/identity` |
| 4 | Ressources visuelles | `/assets` |
| 5 | Réseaux internationaux | `/memberships` |
| 6 | Identité collaborateurs | `/people` |
| 7 | Cartes de visite et signatures | `/card/[userId]`, `/signature/[userId]`, links to `/guides` |
| 8 | Modèles de documents | `/documents` |
| 9 | Présentations | `/presentations` |
| 10 | Réseaux sociaux | `/social` |
| 11 | E-mailing marketing | `/marketing` |
| 12 | Gouvernance de la marque | `/governance` |
| 13 | Centre de téléchargement | `/downloads` |
| 14 | Ce que le Centre de Marque ne fait pas | — |

Section 7 is an addition to the proposed scope: cards and signatures are distinct routes
with their own authority tier and their own installation help, and folding them into
« Identité collaborateurs » would leave two production routes undocumented — the exact gap
my own tests caught in HR-10 with Formation.

## 7. Permissions / audience recommendation

* **Guide route gated on `admin:config:manage`** — it mirrors the hub, and the same nine
  accounts hold both tiers, so nothing is excluded in practice. (`admin:users:manage`
  appears only on people/card/signature/guides; the guide *describes* those, it does not
  perform them.)
* **Contextual « Aide — mode opératoire »** on the twelve documented workspaces, resolving
  its own anchor from the route — the HR-10 component, reused, not re-implemented.
* **No new permission.** The audit found none required.

## 8. Gaps and contradictions found

1. **No mode opératoire exists** for the Brand Center; the only help is mail-client
   signature installation.
2. **Naming collision risk** between `/guides` (installation) and a new guide — resolved by
   route, title and a test.
3. **The proposed scope omits cards/signatures** as their own section, and they are two
   real routes on a different authority tier (§6).
4. **Three acts are easy to conflate** — editing, generating, governing (§2). The
   governance page is the one users will misread as "editing with extra steps".
5. **`SOON` is empty**, so nothing may be documented as forthcoming.
6. **Nothing is missing from Effitrans on the identity side today** — the brand is complete
   and the templates are published. The « À définir par Effitrans » field will therefore be
   sparse here, and honest: mostly the *content* of documents, decks and campaigns, not the
   identity.

## 9. Decisions required (HOLD)

| # | Decision | Recommendation |
|---|---|---|
| **RQ-BC.1** | **What should the guide compute?** HR-10 counts authority holders because HR's gate is staffing. The Brand Center is fully staffed; its real gate is **brand completeness** (a template cannot be published unless the brand is complete). Should the guide compute readiness from **completeness (N/11)** instead of authority counts? | **Yes.** Reuse the HR-10 *pattern* (computed, never hand-written, with the reason stated) but bind it to this product's own gate. A guide that counted authorities here would always say « disponible » and teach the reader nothing. |
| **RQ-BC.2** | **Section 7 (cartes & signatures)** — add it as proposed in §6, or fold cards/signatures into « Identité collaborateurs »? | **Add it.** Two production routes and a distinct authority tier; folding them leaves routes undocumented, which is precisely the defect my HR-10 tests caught. |
| **RQ-BC.3** | **Audience** — gate the guide on `admin:config:manage` (§7), or make it readable by any authenticated staff member who might receive a signature or a template? | **`admin:config:manage` for v1**, matching the hub. Widen later only if Effitrans wants a staff-facing subset; the installation guides already serve the people who merely *install* a signature. |

**Not decisions, but named:** the guide will describe generation of PDF/DOCX/PPTX/PNG/SVG/
HTML deliverables. It documents them; it changes nothing about them.

## 10. Implementation plan (on GO, after RQ-BC.1–BC.3)

* **BCG-A — content model + guide route.** `lib/brand/guide/content.ts` (pure, 14 sections,
  labels quoted from production) + a completeness-driven readiness reader + `/brand-center/guide`,
  gated, audited on view. **No migration, no permission, no Brand Center feature.**
* **BCG-B — contextual « Aide »** on the twelve documented workspaces, reusing the HR-10
  `GuideLink` component (parameterised by guide route, or a sibling that resolves brand
  anchors) — one component family, not a second help framework.
* **BCG-C — operator UAT + closure**, exactly as HR-10D.

**Tests:** structural, as HR-10 — every section carries the seven fields; every documented
route exists and every Brand Center route is documented; labels quoted from the guide still
exist in their components (so a rename breaks CI); no permission code, SQLSTATE or table
name in the prose; the installation guides stay distinct; **no literal non-UUID `entityId`**
(the UAT-HR10-01 class check, which must be extended to this guide's audit call from the
start). Mutations: a section claiming a capability that does not exist, a quoted label
drifting from its component, the governance section describing publication without the
completeness gate.

**After the guide is COMPLETE / PRODUCTION-VALIDATED: HOLD.** TMS remains next and starts
only from its own ratified lightweight roadmap.
