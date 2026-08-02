# LOG-0 — Source Inventory (docs/Logistic Pack)

**Generated:** 2026-08-04 · **Files:** 120 · **Method:** programmatic scan (zip/XML for
OOXML, header check for PDF, OLE detection for legacy) + targeted manual reads.
Hashes are SHA-256 (first 12 hex) recorded for provenance — the pack itself is
NOT committed (see confidentiality-and-source-handling.md).

**Global findings that apply to every row:**
* Every filename is prefixed « Copie de » — the folder is a copied distribution of a
  purchased/downloaded **generic template & tool kit**, not internal Effitrans records.
* **No real Effitrans operational data was found in any parsed file** — templates carry
  `____` blanks and `[à remplir]` placeholders; workbooks carry third-party demo data
  (French freeware samples); the sole email address in the letter set is
  `VOTREEMAIL@VOTRECIE.COM`.
* Files with Scribd numeric ID prefixes (e.g. 119457777-…) are third-party published
  works — a **copyright** concern for any public commit, distinct from confidentiality.
* Legend: parse = whether safely machine-parsed here; manual = requires human review.

| # | Path | Type | KB | sha256₁₂ | Domain | Classification | Parse | Real data |
|--:|---|---|--:|---|---|---|---|---|
| 1 | DOCUMENTS PDF TRANSIT DOUANE/Dossier - Du transport à logistique.pdf | pdf | 216 | `58dc5395ac86` | Training / Knowledge | reference (course) | pdf (text/scan mix — manual review for books) | none |
| 2 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de ACCORD DE REPRÉSENTATION EN DOUANE.docx | docx | 33 | `dcacc027e794` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 3 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Accord de Classification Tarifaire.docx | docx | 32 | `4ddbc04ada21` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 4 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Accord de Coopération Douanière Régionale.docx | docx | 33 | `2dec3f88295d` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 5 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Accord de Dédouanement Accéléré.docx | docx | 32 | `6db27075d7b6` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 6 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Accord de Facilitation des Échanges.docx | docx | 33 | `56a9bdc45e55` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 7 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Accord de Gestion des Entrepôts Sous Douane.docx | docx | 33 | `6ef619d55fc4` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 8 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Accord de Gestion des Zones Franches.docx | docx | 33 | `8078cad00390` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 9 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Accord de Transit International.docx | docx | 32 | `e4a9e01b2a1c` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 10 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de CONTRAT DE FRANCHISE DOUANIÈRE.docx | docx | 32 | `d99e0bba0f32` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 11 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Cautionnement Douanier.docx | docx | 33 | `62f8667517ba` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 12 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Certification Douanière.docx | docx | 33 | `568edaff8238` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 13 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Commission de Transit(1).docx | docx | 33 | `02298807283e` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 14 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Commission de Transit.docx | docx | 33 | `02298807283e` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 15 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Conformité aux Normes Douanières.docx | docx | 33 | `9537a0fe3ccd` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 16 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Déclaration en Douane.docx | docx | 32 | `1b60f9d5287a` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 17 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Garantie Douanière.docx | docx | 32 | `77b94a8ec024` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 18 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Gestion des Données Douanières.docx | docx | 33 | `42cd705ffd21` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 19 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Gestion des Litiges Douaniers.docx | docx | 33 | `40c6991cd2b5` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 20 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Gestion des Risques Douaniers.docx | docx | 33 | `31c5301c3964` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 21 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Sous-Traitance en Douane.docx | docx | 33 | `5bcd1b435e0a` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 22 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Contrats et accords/Copie de Contrat de Traitement en Douane.docx | docx | 33 | `f696b5472557` | Compliance / Legal + Transit/Customs | template (contract) | parsed | none |
| 23 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Autorisation de Transit.docx | docx | 32 | `599f8341df67` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 24 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Avis d_Arrivée (Arrival Notice).docx | docx | 32 | `d2d93efb49da` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 25 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Avis de Réclamation.docx | docx | 32 | `fdce6d9b6f88` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 26 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de BON DE CHARGEMENT (LOADING NOTE).docx | docx | 33 | `0eb0ada4b6d0` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 27 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Bon de Commande (Purchase Order).docx | docx | 33 | `fe93b66b0959` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 28 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Bon de Dépôt (Deposit Note).docx | docx | 32 | `5ed1b3cd070c` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 29 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Bon de Livraison (Delivery Note).docx | docx | 32 | `2bdba4269162` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 30 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Bon de Retour (Return Note).docx | docx | 33 | `91e576126f88` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 31 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Bon de Réception (Receipt Note).docx | docx | 32 | `38d41cb9e700` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 32 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Bon de Sortie (Outbound Note).docx | docx | 33 | `c9a15b401306` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 33 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Bulletin de Suivi (Tracking Report).docx | docx | 32 | `2d850b193493` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 34 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de CERTIFICAT D_ASSURANCE TRANSPORTEUR.docx | docx | 32 | `afc6e88e0b92` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 35 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Certificat d_Origine.docx | docx | 32 | `0508d85fe7e8` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 36 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Connaissement Maritime (Bill of Lading).docx | docx | 33 | `9b4a1b097bfe` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 37 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de DIRECT MARITIME TRANSPORT DOCUMENT.docx | docx | 33 | `2cf783d4fb13` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 38 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Déclaration d_Assurance.docx | docx | 32 | `244af48bbdbe` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 39 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Facture Commerciale.docx | docx | 33 | `6c4f6dd9292c` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 40 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Facture Pro Forma.docx | docx | 33 | `430b906f0a7f` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 41 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Formulaire de Déclaration en Douane.docx | docx | 33 | `74fb9712b3f8` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 42 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de LETTRE DE TRANSPORT INTERMODALE.docx | docx | 33 | `a3e0d5f48926` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 43 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de LETTRE DE VOITURE TIR.docx | docx | 35 | `855d0209633e` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 44 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de LISTE DE COLISAGE (PACKING LIST).docx | docx | 33 | `423bc90e6995` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 45 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Lettre de Transport Fluvial.docx | docx | 32 | `11ab7bcb876f` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 46 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Lettre de Transport Routier National.docx | docx | 32 | `c5b594c0f88d` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 47 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Lettre de Voiture (Bill of Lading).docx | docx | 34 | `95e07a199409` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 48 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Lettre de Voiture CIM.docx | docx | 35 | `a21a90e49229` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 49 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de MANIFESTE DE CARGAISON (CARGO MANIFEST).docx | docx | 33 | `4779f102e7dc` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 50 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Documents administratifs/Copie de Police d_Assurance Cargo.docx | docx | 32 | `c64c339897d2` | Transit/Customs + Operations | template (operational document) | parsed | none |
| 51 | KIT TRANSIT DOUANE & IMPORT EXPORT DE MARCHANDISES/Rapports et Analyses/Copie de Calendrier de Planification des Transports.xlsx | xlsx | 13 | `4cc3a294c7ea` | Operations / Reporting | reference (sample planner) | parsed (1 sheets) | synthetic sample rows |
| 52 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/1-Acquisition , location et vente d_équipement/Copie de 537370319-le-connaissement.doc | doc | 42 | `0be9d86146d7` | Procurement / Vendor | reference | legacy OLE — manual review | none |
| 53 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de 494305155-Modification-de-La-Commande.pdf | pdf | 41 | `df25c348e2a1` | Procurement / Vendor | template (correspondence letter) | pdf (text/scan mix — manual review for books) | placeholder only |
| 54 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de 646466936-Accuse-Reception-de-Marchandise.docx | docx | 13 | `fbedacc98e29` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 55 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de 698560749-NonLivraison.docx | docx | 15 | `857cc6812097` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 56 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de Accusé de reception de marchandises.docx | docx | 286 | `623e21dec2e2` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 57 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de Avis d_expédition.docx | docx | 8 | `ec40d8147aaa` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 58 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de Avis de rejets de marchandises.docx | docx | 469 | `53ee902a3060` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 59 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de Bienvenus à nos nouveau  fournissseurs.docx | docx | 8 | `5e7586cc99ca` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 60 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de Notification de livraison incomplète.docx | docx | 286 | `76663d1fff27` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 61 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/2-Achats et Approvisionnement/Copie de Notification de produits defectueux.docx | docx | 8 | `8378709feb60` | Procurement / Vendor | template (correspondence letter) | parsed | placeholder only |
| 62 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de 177735034-MODELE-DE-CONTRAT-DE-VENTE-INTERNATIONALE.pdf | pdf | 721 | `97902184b6ea` | Commercial + Operations | template (correspondence letter) | pdf (text/scan mix — manual review for books) | placeholder only |
| 63 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de 534971204-ATTESTATIONSURL-HONNEURFRANCAIS.pdf | pdf | 63 | `cbedc34741d9` | Commercial + Operations | template (correspondence letter) | pdf (text/scan mix — manual review for books) | placeholder only |
| 64 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Acceptation de commande et livraison par lots.docx | docx | 8 | `346e991b9c6a` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 65 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Accusé de reception et acceptation de commande.docx | docx | 8 | `d70ad6f04adb` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 66 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Autorisation de retour de marchandise.docx | docx | 8 | `77c95cf7cd12` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 67 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Autorisation de retours tardifs de marchandise.docx | docx | 8 | `65dd3a81dd3d` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 68 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Avis d_incapacité d_execution de commande.docx | docx | 8 | `7728b2d23651` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 69 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Avis de livraison de marchandises de substitution.docx | docx | 8 | `e55f19809b0c` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 70 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Confirmation d_une commande verbale.docx | docx | 8 | `a64575f7f7ba` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 71 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Notification de remplacement de marchandises rejetés.docx | docx | 8 | `497806ef6a8d` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 72 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Notification de retards inattendu dans l_expédition.docx | docx | 8 | `dbe16ff6cf5a` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 73 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/3-Vente et expedition/Copie de Retard d_exécution de commande.docx | docx | 8 | `cdb081ce9fc2` | Commercial + Operations | template (correspondence letter) | parsed | placeholder only |
| 74 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 119457777-optimisez-votre-platforme-logistique.pdf | pdf | 22710 | `c218171436a0` | Training / Knowledge | reference (third-party published book) | pdf (text/scan mix — manual review for books) | none — but COPYRIGHTED |
| 75 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 152304775-La-gestion-de-la-chaine-logistique.ppt | ppt | 2542 | `6946d675c5db` | Training / Knowledge | reference (third-party published book) | legacy OLE — manual review | none — but COPYRIGHTED |
| 76 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 155278510-L-Externalisation-Logistique.pdf | pdf | 657 | `7360d8779960` | Training / Knowledge | reference (third-party published book) | pdf (text/scan mix — manual review for books) | none — but COPYRIGHTED |
| 77 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 294059912-Conception-d-Une-Chaine-Logistique.pdf | pdf | 2561 | `4e1fda5a587b` | Training / Knowledge | reference (third-party published book) | pdf (text/scan mix — manual review for books) | none — but COPYRIGHTED |
| 78 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 378627375-La-Logistique-de-L-entreprise-pdf.pdf | pdf | 13940 | `fb89b1a84916` | Training / Knowledge | reference (third-party published book) | pdf (text/scan mix — manual review for books) | none — but COPYRIGHTED |
| 79 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 583179801-Cours-Gestion-Industrielle-Part-1.ppt | ppt | 3432 | `b0546d08d44a` | Training / Knowledge | reference (third-party published book) | legacy OLE — manual review | none — but COPYRIGHTED |
| 80 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 646414267-Transports.pdf | pdf | 10828 | `2745cc8137fa` | Training / Knowledge | reference (third-party published book) | pdf (text/scan mix — manual review for books) | none — but COPYRIGHTED |
| 81 | KIT TRANSPORT LOGISTIQUE ET SUPPLYCHAIN/4-Livres/Copie de 652687951-Manuel-Logistique-V13-2-Francais-28-09-2021.pdf | pdf | 36496 | `2da401d64423` | Training / Knowledge | reference (third-party published book) | pdf (text/scan mix — manual review for books) | none — but COPYRIGHTED |
| 82 | PROGICIELS EXCEL/Copie de Application de Gestion de chambres d_hotels.xlsm | xlsm | 1895 | `06b0ba07b386` | Cross-domain (see per-file) | third-party freeware workbook | parsed (3 sheets, VBA) | third-party demo data |
| 83 | PROGICIELS EXCEL/Copie de Application de Suivi de comptes.xlsm | xlsm | 365 | `154aa4edb2c5` | Cross-domain (see per-file) | third-party freeware workbook | parsed (6 sheets, VBA) | third-party demo data |
| 84 | PROGICIELS EXCEL/Copie de Application_suivi-compte-_public.xlsm | xlsm | 301 | `afa0e11588c6` | Cross-domain (see per-file) | third-party freeware workbook | parsed (21 sheets, VBA) | third-party demo data |
| 85 | PROGICIELS EXCEL/Copie de Budget personnel mensuel.xls | xls | 83 | `660332d8d72b` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 86 | PROGICIELS EXCEL/Copie de Gestion des EPI.xlsm | xlsm | 133 | `d6801b2b89f5` | Cross-domain (see per-file) | third-party freeware workbook | parsed (8 sheets, VBA) | third-party demo data |
| 87 | PROGICIELS EXCEL/Copie de Gestion du temps.xls | xls | 1548 | `a299dbe01d9b` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 88 | PROGICIELS EXCEL/Copie de Gestion-Stocks.xls | xls | 2836 | `8a63583bbca8` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 89 | PROGICIELS EXCEL/Copie de Gestionnaire MEMO.xlsm | xlsm | 1167 | `44b21fc7f605` | Cross-domain (see per-file) | third-party freeware workbook | parsed (5 sheets, VBA) | third-party demo data |
| 90 | PROGICIELS EXCEL/Copie de Gestionnaire universel_de_fichiers.xlsm | xlsm | 274 | `44948854cfb8` | Cross-domain (see per-file) | third-party freeware workbook | parsed (3 sheets, VBA) | third-party demo data |
| 91 | PROGICIELS EXCEL/Copie de LOGICIEL DE GESTION DE STOCKS.xlsm | xlsm | 718 | `612653098b56` | Cross-domain (see per-file) | third-party freeware workbook | parsed (6 sheets, VBA) | third-party demo data |
| 92 | PROGICIELS EXCEL/Copie de Loi PINEL.xls | xls | 136 | `3887389e6f24` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 93 | PROGICIELS EXCEL/Copie de MODELE FACTURE.xlsx | xlsx | 20 | `f653b3215945` | Cross-domain (see per-file) | third-party freeware workbook | parsed (2 sheets) | third-party demo data |
| 94 | PROGICIELS EXCEL/Copie de Modèle-de-gestion-de-stock-au-format-Excel.xls | xls | 884 | `6c271bc3e660` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 95 | PROGICIELS EXCEL/Copie de Mon-planning-perso.xlsm | xlsm | 2649 | `ca77501dd1f0` | Cross-domain (see per-file) | third-party freeware workbook | parsed (15 sheets, VBA) | third-party demo data |
| 96 | PROGICIELS EXCEL/Copie de Registre de courriers.xlsm | xlsm | 226 | `c893ae58298b` | Cross-domain (see per-file) | third-party freeware workbook | parsed (12 sheets, VBA) | third-party demo data |
| 97 | PROGICIELS EXCEL/Copie de Stock-Pratique OK.xlsm | xlsm | 718 | `612653098b56` | Cross-domain (see per-file) | third-party freeware workbook | parsed (6 sheets, VBA) | third-party demo data |
| 98 | PROGICIELS EXCEL/Copie de Tableau de bord RH V00.xlsm | xlsm | 1478 | `2f7fa5c5d004` | Cross-domain (see per-file) | third-party freeware workbook | parsed (4 sheets, VBA) | third-party demo data |
| 99 | PROGICIELS EXCEL/Copie de admin-caisse-recettes.xls | xls | 206 | `6a3df705dda4` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 100 | PROGICIELS EXCEL/Copie de bom-pratique-excel-windows.xlsm | xlsm | 487 | `cdf310644c1a` | Cross-domain (see per-file) | third-party freeware workbook | parsed (7 sheets, VBA) | third-party demo data |
| 101 | PROGICIELS EXCEL/Copie de generateur-de-mot-de-passe.xls | xls | 77 | `2640eb3753ca` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 102 | PROGICIELS EXCEL/Copie de geromemo.xlsm | xlsm | 1167 | `954ead28934b` | Cross-domain (see per-file) | third-party freeware workbook | parsed (5 sheets, VBA) | third-party demo data |
| 103 | PROGICIELS EXCEL/Copie de gestion-de-projets.xlsx | xlsx | 229 | `75e5d06e0d57` | Cross-domain (see per-file) | third-party freeware workbook | parsed (2 sheets) | third-party demo data |
| 104 | PROGICIELS EXCEL/Copie de gestion-de-stock-et-facturation-excel-gratuit-2.xlsx | xlsx | 1702 | `3631dec722f0` | Cross-domain (see per-file) | third-party freeware workbook | parsed (9 sheets) | third-party demo data |
| 105 | PROGICIELS EXCEL/Copie de gestion-de-stock.xlsm | xlsm | 183 | `614c68746e27` | Cross-domain (see per-file) | third-party freeware workbook | parsed (9 sheets, VBA) | third-party demo data |
| 106 | PROGICIELS EXCEL/Copie de gestion-demandes-formation.xlsm | xlsm | 83 | `4aea144f2153` | Cross-domain (see per-file) | third-party freeware workbook | parsed (9 sheets, VBA) | third-party demo data |
| 107 | PROGICIELS EXCEL/Copie de gestion_de_stock_excel.xlsm | xlsm | 2190 | `8a41f106400d` | Cross-domain (see per-file) | third-party freeware workbook | parsed (23 sheets) | third-party demo data |
| 108 | PROGICIELS EXCEL/Copie de gestion_multiprojets.xlsm | xlsm | 4501 | `21613a95ec2f` | Cross-domain (see per-file) | third-party freeware workbook | parsed (4 sheets, VBA) | third-party demo data |
| 109 | PROGICIELS EXCEL/Copie de gestion_patrimoine_bati_v2.xlsm | xlsm | 1277 | `9c5c359ad289` | Cross-domain (see per-file) | third-party freeware workbook | parsed (18 sheets, VBA) | third-party demo data |
| 110 | PROGICIELS EXCEL/Copie de gestionnaire_de_fichiers_pdf_3.0.xlsm | xlsm | 317 | `0b6125f65e7e` | Cross-domain (see per-file) | third-party freeware workbook | parsed (3 sheets, VBA) | third-party demo data |
| 111 | PROGICIELS EXCEL/Copie de gestionnaire_universel_de_fichiers.xlsm | xlsm | 274 | `44948854cfb8` | Cross-domain (see per-file) | third-party freeware workbook | parsed (3 sheets, VBA) | third-party demo data |
| 112 | PROGICIELS EXCEL/Copie de gestionstock23.xls | xls | 280 | `f0f2aee79eca` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 113 | PROGICIELS EXCEL/Copie de mailoutllok.xlsm | xlsm | 93 | `78368061d6f0` | Cross-domain (see per-file) | third-party freeware workbook | parsed (3 sheets, VBA) | third-party demo data |
| 114 | PROGICIELS EXCEL/Copie de modele DEVIS.xls | xls | 74 | `b84b332fa408` | Cross-domain (see per-file) | third-party freeware workbook | legacy OLE — manual review | third-party demo data |
| 115 | PROGICIELS EXCEL/Copie de ndf-formulaire-v5.xlsm | xlsm | 717 | `cb7bafdf180c` | Cross-domain (see per-file) | third-party freeware workbook | parsed (6 sheets, VBA) | third-party demo data |
| 116 | PROGICIELS EXCEL/Copie de planning-pratique-v2.2.1-excel-windows.xlsm | xlsm | 725 | `749f3cbf9b13` | Cross-domain (see per-file) | third-party freeware workbook | parsed (9 sheets, VBA) | third-party demo data |
| 117 | PROGICIELS EXCEL/Copie de planning_interventions_machines_v2.1.xlsm | xlsm | 136 | `3cc793246142` | Cross-domain (see per-file) | third-party freeware workbook | parsed (2 sheets, VBA) | third-party demo data |
| 118 | PROGICIELS EXCEL/Copie de reservation-vehicules.xlsm | xlsm | 1289 | `08a2abc3f46e` | Cross-domain (see per-file) | third-party freeware workbook | parsed (12 sheets, VBA) | third-party demo data |
| 119 | PROGICIELS EXCEL/Copie de suivi-personnel-v3.2.xlsm | xlsm | 1376 | `4593447eb308` | Cross-domain (see per-file) | third-party freeware workbook | parsed (8 sheets, VBA) | third-party demo data |
| 120 | PROGICIELS EXCEL/Copie de vocabulary-list.xlsm | xlsm | 53 | `8c4da7133eea` | Cross-domain (see per-file) | third-party freeware workbook | parsed (3 sheets, VBA) | third-party demo data |

## Totals

| Metric | Count |
|---|--:|
| Files | 120 |
| Safely machine-parsed (docx/xlsx/xlsm/pdf-header) | 108 |
| Legacy OLE requiring manual review (doc/xls/ppt) | 12 |
| Containing real Effitrans operational data | 0 |
| Containing third-party demo/sample data | 40 |
| Exact duplicate pairs | 3 |
| Third-party copyrighted publications (never commit) | 9 |
