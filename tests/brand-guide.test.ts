/**
 * EFFITRANS — Guide Centre de Marque (BCG-A/B).
 * ---------------------------------------------------------------------------
 * Governing spec: docs/brand/brand-guide-audit.md and the ratifications of
 * RQ-BC.1…RQ-BC.3. This suite pins what a guide can silently get wrong:
 *
 *   RQ-BC.1  readiness is computed from BRAND COMPLETENESS (N/11, no
 *            percentage, live), never from authority counts, never hard-coded;
 *            and the three acts — éditer / générer / gouverner — stay distinct;
 *   RQ-BC.2  cards & signatures are documented as their own section, and
 *            /brand-center/guides stays a DISTINCT surface that is linked;
 *   RQ-BC.3  one route gated on admin:config:manage, no new permission;
 *   census   every production Brand Center route is documented — a future
 *            workspace cannot silently become undocumented;
 *   content  production wordings are reused verbatim, not re-described.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BRAND_GUIDE_SECTIONS, brandGuideAnchorForRoute, documentedBrandRoutes,
} from "@/lib/brand/guide/content";
import { deriveBrandCompleteness } from "@/lib/brand/model";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const exists = (p: string) => existsSync(fileURLToPath(new URL(`../${p}`, import.meta.url)));

const CONTENT = "lib/brand/guide/content.ts";
const READER = "lib/brand/guide.ts";
const PAGE = "app/brand-center/guide/page.tsx";
const LINK = "components/brand/guide-link.tsx";

/** Every production page route under /brand-center, as the filesystem has it. */
function productionBrandRoutes(): string[] {
  const base = fileURLToPath(new URL("../app/brand-center", import.meta.url));
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`, `${prefix}/${e.name}`);
      else if (e.name === "page.tsx") out.push(prefix);
    }
  };
  walk(base, "/brand-center");
  return out.sort();
}

// ===========================================================================
describe("the census — no production workspace goes undocumented", () => {
  it("every Brand Center route is documented, or is the guide itself", () => {
    const documented = new Set(documentedBrandRoutes());
    // The two guide surfaces document themselves: the mode opératoire IS this
    // guide, and the installation guides are linked from it by name.
    const selfDocumenting = new Set(["/brand-center/guide", "/brand-center/guides"]);
    const orphans = productionBrandRoutes()
      .filter((r) => !documented.has(r) && !selfDocumenting.has(r));
    expect(orphans, `undocumented Brand Center routes: ${orphans.join(", ")}`).toEqual([]);
  });

  it("the census actually sees the whole product — 15 pages plus the new guide", () => {
    const routes = productionBrandRoutes();
    expect(routes.length).toBe(16);
    for (const r of ["/brand-center", "/brand-center/identity", "/brand-center/assets",
      "/brand-center/memberships", "/brand-center/people", "/brand-center/documents",
      "/brand-center/documents/[type]", "/brand-center/presentations", "/brand-center/social",
      "/brand-center/marketing", "/brand-center/governance", "/brand-center/downloads",
      "/brand-center/guides", "/brand-center/card/[userId]", "/brand-center/signature/[userId]"]) {
      expect(routes, r).toContain(r);
    }
  });

  it("every documented route exists on disk", () => {
    for (const r of documentedBrandRoutes()) {
      expect(exists(`app${r}/page.tsx`), r).toBe(true);
    }
  });
});

describe("the SOP shape — every section answers the same questions", () => {
  it("14 sections, each with audience, moment and numbered steps", () => {
    expect(BRAND_GUIDE_SECTIONS.length).toBe(14);
    for (const s of BRAND_GUIDE_SECTIONS) {
      expect(s.id, s.title).toMatch(/^[a-z0-9-]+$/);
      expect(s.audience.length, s.id).toBeGreaterThan(5);
      expect(s.when.length, s.id).toBeGreaterThan(5);
      expect(s.steps.length, s.id).toBeGreaterThan(0);
      expect(typeof s.completenessDependent, s.id).toBe("boolean");
    }
  });

  it("anchors are unique and resolve, including the sub-surfaces", () => {
    const ids = BRAND_GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(brandGuideAnchorForRoute("/brand-center/governance")).toBe("gouvernance");
    // RQ-BC.2 — card and signature are real routes reached through their section.
    expect(brandGuideAnchorForRoute("/brand-center/card/[userId]")).toBe("cartes-signatures");
    expect(brandGuideAnchorForRoute("/brand-center/signature/[userId]")).toBe("cartes-signatures");
    expect(brandGuideAnchorForRoute("/brand-center/inconnu")).toBeNull();
  });
});

describe("RQ-BC.1 — readiness is the product's own gate, computed live", () => {
  it("the reader derives from brand completeness, not from authority counts", () => {
    const r = code(READER);
    expect(r).toMatch(/getBrandCenterOverview\(\)/);
    expect(r).toMatch(/completeness\.items[\s\S]{0,120}filter\(\(i\) => !i\.complete\)/);
    // Never a permission census, never a stored verdict.
    expect(r).not.toMatch(/role_permission|user_role|hasPermission|holders/);
    expect(r).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("the model still has exactly 11 items and reports no percentage", () => {
    const empty = deriveBrandCompleteness({
      colors: { green: "", gold: "", anthracite: "" },
      fonts: { heading: "", body: "", fallback: "" },
      slogan: "", valueProposition: "", website: "", address: "", whistleblowerUrl: "",
      publishedKinds: [], activeMembershipCount: 0, workforceWithTitleCount: 0,
    });
    expect(empty.total).toBe(11);
    expect(empty.completed).toBe(0);
    expect(empty.summary).toBe("0 éléments sur 11 complétés");
    expect(empty.summary).not.toMatch(/%/);
    // And every item explains itself — the evidence the guide surfaces.
    for (const i of empty.items) expect(i.evidence.length, i.key).toBeGreaterThan(5);
  });

  it("the page shows the summary and the missing items' evidence, never a percentage", () => {
    const p = read(PAGE);
    expect(p).toContain("readiness.summary");
    expect(p).toMatch(/readiness\.missing\.map/);
    expect(p).toContain("m.evidence");
    expect(code(PAGE)).not.toMatch(/%|pourcentage|Math\.round/);
  });

  it("having the permission does not imply the brand is complete", () => {
    expect(read(PAGE)).toContain("Disposer de l&apos;autorisation ne rend pas la marque complète");
    expect(read(CONTENT)).toMatch(/Avoir l'autorisation d'accéder au Centre de marque ne signifie pas que la marque est complète/);
  });

  it("only publication and the generators depend on completeness — editing never does", () => {
    const dependent = BRAND_GUIDE_SECTIONS.filter((s) => s.completenessDependent).map((s) => s.id).sort();
    expect(dependent).toEqual(
      ["documents", "emailing", "gouvernance", "presentations", "reseaux-sociaux"].sort());
    // Editing is how the brand BECOMES complete; gating it would be a trap.
    for (const id of ["identite", "ressources", "reseaux-internationaux", "collaborateurs"]) {
      expect(BRAND_GUIDE_SECTIONS.find((s) => s.id === id)?.completenessDependent, id).toBe(false);
    }
  });

  it("the three acts are distinguished, and governance is not editing", () => {
    const intro = BRAND_GUIDE_SECTIONS.find((s) => s.id === "prise-en-main")!;
    const text = intro.steps.join("\n");
    expect(text).toMatch(/ÉDITER/);
    expect(text).toMatch(/GÉNÉRER/);
    expect(text).toMatch(/GOUVERNER/);
    const gov = BRAND_GUIDE_SECTIONS.find((s) => s.id === "gouvernance")!;
    expect(gov.elsewhere.join("\n")).toMatch(/n'est PAS modifier une information de marque/);
    expect(gov.elsewhere.join("\n")).toMatch(/Générer un livrable n'est pas non plus un acte de gouvernance/);
  });
});

describe("governance — the lifecycle, exactly as implemented", () => {
  it("the four states and the publication invariant are quoted", () => {
    const gov = BRAND_GUIDE_SECTIONS.find((s) => s.id === "gouvernance")!;
    const all = [...gov.steps, ...gov.needs, ...gov.automatic].join("\n");
    expect(all).toMatch(/Brouillon → Approuvé → Publié → Retiré/);
    expect(all).toContain("Un modèle ne peut être publié que si la marque est complète.");
    // The production page says the same sentence — the guide did not invent it.
    expect(read("app/brand-center/governance/page.tsx"))
      .toContain("Un modèle ne peut être publié que si la marque est complète.");
  });

  it("no approval semantics beyond what the code enforces", () => {
    const gov = BRAND_GUIDE_SECTIONS.find((s) => s.id === "gouvernance")!;
    const all = [...gov.steps, ...gov.automatic, ...gov.needs].join("\n");
    // No invented second approver, no delay, no expiry, no quorum.
    expect(all).not.toMatch(/deux personnes|second|quatre yeux|délai|expire|quorum/i);
    // And the transitions it describes are the ones the module allows.
    const lifecycle = read("lib/brand/governance/lifecycle.ts");
    expect(lifecycle).toMatch(/DRAFT: \["APPROVED"\]/);
    expect(lifecycle).toMatch(/APPROVED: \["PUBLISHED", "DRAFT"\]/);
    expect(lifecycle).toMatch(/PUBLISHED: \["RETIRED", "APPROVED"\]/);
    expect(lifecycle).toMatch(/RETIRED: \["DRAFT"\]/);
  });
});

describe("content fidelity — production wordings, reused not re-described", () => {
  it("each ratified sentence sits in ITS OWN section, and still in its page", () => {
    // Bound per section: the closing « limites » page repeats several of these,
    // so a guide-wide search would let a reworded workspace section pass.
    for (const [sentence, sectionId, page] of [
      ["Aucun envoi, aucune programmation, aucun suivi", "emailing", "app/brand-center/marketing/page.tsx"],
      ["Le SVG n'est pas accepté", "ressources", "app/brand-center/assets/page.tsx"],
      ["Le nom, l'e-mail et les rôles restent gérés par le module Utilisateurs", "collaborateurs", "app/brand-center/people/page.tsx"],
      ["Pas de campagne, pas de programmation", "reseaux-sociaux", "app/brand-center/social/page.tsx"],
      ["Les couleurs restent vides tant que la Direction ne les a pas fournies", "identite", "app/brand-center/identity/page.tsx"],
    ] as const) {
      const s = BRAND_GUIDE_SECTIONS.find((x) => x.id === sectionId)!;
      const sectionProse = [...s.steps, ...s.needs, ...s.automatic, ...s.elsewhere, ...s.toSupply].join("\n");
      expect(sectionProse, `section ${sectionId} must quote: ${sentence}`).toContain(sentence);
      expect(read(page), `${page} still says it`).toContain(sentence);
    }
  });

  it("quoted UI labels still exist in their studios", () => {
    const prose = BRAND_GUIDE_SECTIONS.flatMap((s) => s.steps).join("\n");
    for (const [label, file] of [
      ["Texte alternatif (obligatoire)", "components/brand/asset-manager.tsx"],
      ["Ajouter une adhésion", "components/brand/membership-manager.tsx"],
      ["Télécharger PPTX", "components/brand/presentation-studio.tsx"],
      ["Copier HTML", "components/brand/marketing-studio.tsx"],
      ["Télécharger PNG", "components/brand/communication-studio.tsx"],
    ] as const) {
      expect(prose, `guide quotes ${label}`).toContain(label);
      expect(read(file), `${file} still says ${label}`).toContain(label);
    }
  });

  it("BCG-F1 — a heading is not described as a button", () => {
    // Production UAT (Step 5): « Ajouter une adhésion » is the section HEADING;
    // the button reads « Ajouter ». The guide must name the click accurately.
    const membership = read("components/brand/membership-manager.tsx");
    expect(membership).toMatch(/<h2[^>]*>Ajouter une adhésion<\/h2>/);
    expect(membership).toMatch(/"Ajouter"/);
    const s = BRAND_GUIDE_SECTIONS.find((x) => x.id === "reseaux-internationaux")!;
    const step = s.steps.find((t) => t.includes("Ajouter une adhésion"))!;
    expect(step).toMatch(/sous « Ajouter une adhésion »/);
    expect(step).toMatch(/cliquez sur « Ajouter »/);
  });

  it("no permission code, SQLSTATE or table name reaches the reader", () => {
    const prose = BRAND_GUIDE_SECTIONS.flatMap((s) =>
      [s.title, s.audience, s.when, ...s.steps, ...s.needs, ...s.automatic,
       ...s.elsewhere, ...s.toSupply]).join("\n");
    expect(prose).not.toMatch(/admin:[a-z:_]+|hr:[a-z:_]+/);
    expect(prose).not.toMatch(/brand_asset|brand_template|workforce_profile/);
    expect(prose).not.toMatch(/\bRPC\b|migration|SQLSTATE/i);
  });

  it("no brand content is invented — colours, slogans and texts stay Effitrans'", () => {
    const prose = BRAND_GUIDE_SECTIONS.flatMap((s) => [...s.steps, ...s.toSupply]).join("\n");
    expect(prose).not.toMatch(/#[0-9a-f]{6}/i);
    expect(prose).toMatch(/valeurs officielles validées par la Direction|relèvent d'Effitrans/);
  });
});

describe("RQ-BC.2 / RQ-BC.3 — scope, gate and the two distinct guides", () => {
  it("the mode opératoire is gated on admin:config:manage and audited safely", () => {
    const p = code(PAGE);
    expect(p).toMatch(/hasPermission\(permissions, "admin:config:manage"\)/);
    expect(p).toMatch(/writeAudit\(\{[\s\S]{0,160}"brand\.guide\.viewed"/);
    // UAT-HR10-01 class: entity_id is a uuid column; a page with no row passes none.
    expect(p).not.toMatch(/entityId:/);
  });

  it("no new permission, no migration, no Brand Center feature", () => {
    for (const f of [CONTENT, READER, PAGE, LINK]) {
      expect(code(f), f).not.toMatch(/insert into public\.permission|role_permission/);
    }
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql")).sort();
    expect(migrations[migrations.length - 1]).toBe("20260905000001_hr_reports_activation.sql");
  });

  it("the two guide surfaces stay semantically distinct, and one links to the other", () => {
    // Singular = mode opératoire; plural = mail-client installation.
    expect(exists("app/brand-center/guide/page.tsx")).toBe(true);
    expect(exists("app/brand-center/guides/page.tsx")).toBe(true);
    expect(read(PAGE)).toContain("Guides d&apos;installation des signatures");
    expect(read(PAGE)).toContain('href="/brand-center/guides"');
    // The mode opératoire does NOT restate installation steps.
    const prose = BRAND_GUIDE_SECTIONS.flatMap((s) => s.steps).join("\n");
    expect(prose).not.toMatch(/Fichier → Options|Paramètres \(roue dentée\)|Réglages → Mail/);
    expect(prose).toMatch(/elles ne sont pas répétées ici/);
    // And the installation guide keeps its own identity.
    expect(read("app/brand-center/guides/page.tsx")).toContain("Guides d'installation des signatures");
  });

  it("contextual Aide links reach the guide from every documented workspace", () => {
    expect(code(LINK)).toMatch(/brandGuideAnchorForRoute\(route\)/);
    expect(code(LINK)).toMatch(/if \(!anchor\) return null/);
    // One family: the same affordance and wording as the HR guide link.
    expect(read(LINK)).toContain("Aide — mode opératoire");
    expect(read("components/hr/guide-link.tsx")).toContain("Aide — mode opératoire");
    for (const r of documentedBrandRoutes()) {
      const page = read(`app${r}/page.tsx`);
      expect(page, `${r} has no Aide link`).toMatch(
        new RegExp(`<BrandGuideLink route="${r.replace(/[[\]]/g, "\\$&")}" ?/>`));
    }
  });

  it("no screenshots, and no PDF *of the guide* in v1", () => {
    // The guide legitimately DOCUMENTS PDF/PNG deliverables; what v1 must not
    // do is ship an image asset or render itself through the PDF engine.
    for (const f of [CONTENT, READER, PAGE, LINK]) {
      expect(code(f), f).not.toMatch(/<img\b|next\/image|ReportLayout|buildReportPdf/);
    }
    expect(exists("app/brand-center/guide/pdf")).toBe(false);
  });
});
