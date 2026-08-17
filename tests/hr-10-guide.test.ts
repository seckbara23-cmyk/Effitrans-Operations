/**
 * EFFITRANS-HR-10 — Guide utilisateur & SOP RH.
 * ---------------------------------------------------------------------------
 * The governing spec is docs/hr/hr-10-guide-sop-audit.md and the ratifications
 * of RQ-10.1…RQ-10.4. This suite pins what a guide can silently get wrong:
 *
 *   RQ-10.1  no screenshot asset ships in v1;
 *   RQ-10.2  availability is COMPUTED from the live authority census, and the
 *            maker-checker controls still demand a second distinct person;
 *   RQ-10.3  one route, gated on hr:read, with contextual Aide links;
 *   RQ-10.4  no PDF in this phase;
 *   and throughout: French only, no technical code on screen, no invented
 *   Effitrans business content, no new feature/permission/migration.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS, guideAnchorForRoute } from "@/lib/hr/guide/content";
import { validateAuditEvent } from "@/lib/audit/validate";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const exists = (p: string) => existsSync(fileURLToPath(new URL(`../${p}`, import.meta.url)));

const CONTENT = "lib/hr/guide/content.ts";
const READER = "lib/hr/guide.ts";
const PAGE = "app/departments/hr/guide/page.tsx";
const LINK = "components/hr/guide-link.tsx";

// ===========================================================================
describe("the SOP shape — every section answers the same questions", () => {
  it("each section carries the five required fields, in French", () => {
    expect(GUIDE_SECTIONS.length).toBeGreaterThanOrEqual(13);
    for (const s of GUIDE_SECTIONS) {
      expect(s.id, s.title).toMatch(/^[a-z0-9-]+$/);
      expect(s.title.length, s.id).toBeGreaterThan(2);
      expect(s.audience.length, s.id).toBeGreaterThan(5);
      expect(s.when.length, s.id).toBeGreaterThan(5);
      expect(Array.isArray(s.steps), s.id).toBe(true);
      // Every documented activity has numbered steps; the closing section too.
      expect(s.steps.length, s.id).toBeGreaterThan(0);
    }
  });

  it("anchors are unique and routes resolve to exactly one section", () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = GUIDE_SECTIONS.map((s) => s.route).filter(Boolean) as string[];
    expect(new Set(routes).size).toBe(routes.length);
    expect(guideAnchorForRoute("/departments/hr/departs")).toBe("departs");
    expect(guideAnchorForRoute("/departments/hr/inconnu")).toBeNull();
  });

  it("every documented route is a real workspace on disk", () => {
    for (const s of GUIDE_SECTIONS) {
      if (!s.route) continue;
      expect(exists(`app${s.route}/page.tsx`), s.route).toBe(true);
    }
  });

  it("every HR workspace with a route is documented — no orphan screen", () => {
    const root = fileURLToPath(new URL("../app/departments/hr", import.meta.url));
    const routes = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("["))
      .map((d) => `/departments/hr/${d.name}`)
      // The guide documents itself only through the hub tile.
      .filter((r) => r !== "/departments/hr/guide");
    const documented = new Set(GUIDE_SECTIONS.map((s) => s.route));
    for (const r of routes) expect(documented.has(r), `${r} is undocumented`).toBe(true);
  });
});

describe("RQ-10.2 — implemented is not the same as operable", () => {
  it("the maker-checker controls still demand a SECOND distinct person", () => {
    const twoPeople = GUIDE_SECTIONS.filter((s) =>
      s.requires.some((r) => r.code === "hr:manage" && r.minHolders === 2)).map((s) => s.id);
    // Contract verification, and import approval. Payroll adjustment decisions
    // live inside the paie section, whose own gate is the parked approval seat.
    expect(twoPeople).toContain("documents-contrats");
    expect(twoPeople).toContain("imports");
  });

  it("availability is COUNTED from the live catalogue, never hand-written", () => {
    const r = code(READER);
    expect(r).toMatch(/from\("permission"\)/);
    expect(r).toMatch(/from\("role_permission"\)/);
    expect(r).toMatch(/from\("user_role"\)/);
    expect(r).toMatch(/eq\("status", "active"\)/);
    expect(r).toMatch(/\(counts\[r\.code\] \?\? 0\) < r\.minHolders/);
    // The content file states no availability of its own.
    expect(code(CONTENT)).not.toMatch(/available\s*[:=]|disponible aujourd'hui/i);
  });

  it("the page says it is a staffing prerequisite, not a software defect", () => {
    const p = read(PAGE);
    expect(p).toContain(`"Non disponible aujourd'hui"`);
    expect(p).toContain(`"Disponible aujourd'hui"`);
    expect(p).toMatch(/pas un défaut du\s*\n?\s*logiciel/i);
    expect(p).toMatch(/Aucun contrôle n&apos;est\s*\n?\s*assoupli/);
  });

  it("every requirement names a permission that actually exists in the catalogue", () => {
    const templates = read("lib/platform/role-templates.ts");
    const seed = read("supabase/seed.sql");
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => read(`supabase/migrations/${f}`)).join("\n");
    for (const s of GUIDE_SECTIONS) {
      for (const r of s.requires) {
        const known = templates.includes(`"${r.code}"`) || seed.includes(`'${r.code}'`)
          || migrations.includes(`'${r.code}'`);
        expect(known, `${s.id} requires unknown ${r.code}`).toBe(true);
      }
    }
  });
});

describe("what the reader sees — French, plain, and honest", () => {
  it("no permission code, SQLSTATE or table name appears in the content", () => {
    // `requires` carries codes for the census; they must never be RENDERED, so
    // the prose fields are what is scanned.
    const prose = GUIDE_SECTIONS.flatMap((s) =>
      [s.title, s.audience, s.when, ...s.steps, ...s.evidence, ...s.automatic,
       ...s.elsewhere, ...s.toSupply]).join("\n");
    expect(prose).not.toMatch(/hr:[a-z:_]+|admin:[a-z:_]+/);
    expect(prose).not.toMatch(/HR\d{3}|EFA\d{2}|SQLSTATE/);
    expect(prose).not.toMatch(/\bhr_[a-z_]+\b|app_user|role_permission/);
    expect(prose).not.toMatch(/\bRPC\b|migration|trigger|foreign key/i);
  });

  it("authority is described in words, in the requirement labels", () => {
    for (const s of GUIDE_SECTIONS) {
      for (const r of s.requires) {
        expect(r.labelFr, `${s.id}/${r.code}`).not.toMatch(/hr:|admin:/);
        expect(r.labelFr.length).toBeGreaterThan(10);
      }
    }
  });

  it("the guide quotes real production labels", () => {
    const prose = GUIDE_SECTIONS.flatMap((s) => s.steps).join("\n");
    for (const [label, file] of [
      ["Nouvel employé", "components/hr/employee-create-form.tsx"],
      ["Marquer fait", "components/hr/onboarding-studio.tsx"],
      ["Clôturer le départ", "components/hr/offboarding-studio.tsx"],
      ["Exporter (CSV)", "components/hr/reporting-studio.tsx"],
      ["Approuver → PRÊT", "components/hr/import-studio.tsx"],
      ["Modèles de check-list", "components/hr/checklist-templates-panel.tsx"],
    ] as const) {
      expect(prose, `guide quotes ${label}`).toContain(label);
      expect(read(file), `${file} still says ${label}`).toContain(label);
    }
  });

  it("the four empty vocabularies are explained, never invented", () => {
    const toSupply = GUIDE_SECTIONS.flatMap((s) => s.toSupply).join("\n");
    for (const topic of [/motifs de départ/i, /modèles de check-list/i,
                         /catalogue de compétences/i, /types d'ajustement/i]) {
      expect(toSupply, `${topic} must be listed as Effitrans content`).toMatch(topic);
    }
    // And no invented content masquerading as a list of theirs.
    const prose = GUIDE_SECTIONS.flatMap((s) => s.steps).join("\n");
    expect(prose).not.toMatch(/démission|licenciement|fin de période d'essai|retraite/i);
  });

  it("the boundaries HR-8 and HR-7 proved confusing are stated explicitly", () => {
    const all = GUIDE_SECTIONS.flatMap((s) => [...s.steps, ...s.automatic, ...s.elsewhere]).join("\n");
    expect(all).toMatch(/ne met PAS fin au contrat|ne désactive JAMAIS le compte/);
    expect(all).toMatch(/Administration → Utilisateurs/);
    expect(all).toMatch(/Aucun montant n'est calculé/);
  });
});

describe("RQ-10.1 / RQ-10.3 / RQ-10.4 — scope held", () => {
  it("no screenshot or image asset ships with the guide", () => {
    for (const f of [CONTENT, PAGE, LINK, READER]) {
      expect(code(f), f).not.toMatch(/<img|\.png|\.jpg|\.jpeg|\.webp|next\/image/i);
    }
  });

  it("one route, gated on hr:read, audited on view", () => {
    const p = code(PAGE);
    expect(p).toMatch(/hasPermission\(permissions, "hr:read"\)/);
    expect(p).toMatch(/notFound\(\)/);
    expect(p).toMatch(/writeAudit\(\{[\s\S]{0,160}"hr\.guide\.viewed"/);
  });

  // -------------------------------------------------------------------------
  // UAT-HR10-01 — the guide crashed in production on its FIRST render: the
  // audit event carried entityId "sop", and `entity_id` is a uuid column whose
  // validator refuses a business key. The page never renders during a build or
  // a unit test, so nothing local exercised it.
  // -------------------------------------------------------------------------
  it("UAT-HR10-01 — the guide's own audit event passes the real validator", () => {
    const uuid = "00000000-0000-0000-0000-000000000001";
    // The event the page emits today: no entityId at all (the business key
    // travels in `after`, which this validator does not police).
    expect(() => validateAuditEvent({
      action: "hr.guide.viewed", actorId: uuid,
    })).not.toThrow();
    // And the production failure mode, reproduced: it must still be refused.
    expect(() => validateAuditEvent({
      action: "hr.guide.viewed", actorId: uuid, entityId: "sop",
    })).toThrow(/entityId must be a UUID/);
  });

  it("UAT-HR10-01 — no audit call anywhere passes a non-UUID entityId literal", () => {
    // The class of defect, not just its two instances: a literal business key
    // in entity_id crashes the page that emits it, at render time.
    const roots = ["app", "lib", "components"];
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        for (const m of read(rel).matchAll(/entityId:\s*"([^"]*)"/g)) {
          if (!uuidLike.test(m[1])) offenders.push(`${rel}: entityId: "${m[1]}"`);
        }
      }
    };
    for (const r of roots) walk(r);
    expect(offenders).toEqual([]);
  });

  it("contextual Aide links reach the guide from every documented workspace", () => {
    expect(code(LINK)).toMatch(/guideAnchorForRoute\(route\)/);
    expect(code(LINK)).toMatch(/if \(!anchor\) return null/);
    expect(read(LINK)).toContain("Aide — mode opératoire");
    for (const s of GUIDE_SECTIONS) {
      if (!s.route) continue;
      const page = read(`app${s.route}/page.tsx`);
      expect(page, `${s.route} has no Aide link`).toMatch(
        new RegExp(`<GuideLink route="${s.route}" ?/>`));
    }
  });

  it("no PDF was built in this phase (RQ-10.4 deferred)", () => {
    for (const f of [CONTENT, PAGE, LINK, READER]) {
      expect(code(f), f).not.toMatch(/pdf|ReportLayout/i);
    }
    expect(exists("app/departments/hr/guide/pdf")).toBe(false);
  });

  it("HR-10 adds no permission, no migration, no HR feature", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    // 114 remains the newest: HR-10 shipped no migration of its own.
    expect(migrations[migrations.length - 1]).toBe("20260905000001_hr_reports_activation.sql");
    // The reader only reads.
    expect(code(READER)).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    // The guide route creates nothing.
    expect(code(PAGE)).not.toMatch(/\bactions?\/|assertPermission\(/);
  });

  it("the hub offers the guide alongside the workspaces it documents", () => {
    expect(read("app/departments/hr/page.tsx"))
      .toMatch(/WorkspaceTile href="\/departments\/hr\/guide" title="Guide RH"/);
  });
});
