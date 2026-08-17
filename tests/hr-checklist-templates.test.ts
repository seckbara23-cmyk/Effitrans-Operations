/**
 * HR-8C — checklist template authoring (the UAT finding).
 * ---------------------------------------------------------------------------
 * ROOT CAUSE PINNED: the template engine shipped with HR-4 and both
 * workspaces read it, but NOTHING wrote it — « Aucun modèle » was permanent
 * and unfixable from inside the platform. This suite pins the closure:
 *
 *   * exactly ONE template engine serves both kinds — no parallel system;
 *   * authoring is gated on the EXISTING hr:config:manage — no new permission;
 *   * kind and code are immutable; templates retire by deactivation;
 *   * a step already used by a case cannot be deleted (FK, translated);
 *   * the workspaces name the real place instead of a place that never existed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHECKLIST_KINDS, CHECKLIST_KIND_LABEL_FR, isChecklistKind } from "@/lib/hr/checklists/model";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = "lib/hr/checklist-actions.ts";
const READS = "lib/hr/checklists.ts";
const PANEL = "components/hr/checklist-templates-panel.tsx";
const CONFIG_PAGE = "app/departments/hr/configuration/page.tsx";

describe("the vocabulary is the migration's, not a new one", () => {
  it("both kinds exist, in French, matching the database CHECK", () => {
    expect([...CHECKLIST_KINDS]).toEqual(["ONBOARDING", "OFFBOARDING"]);
    expect(CHECKLIST_KIND_LABEL_FR.ONBOARDING).toBe("Intégration");
    expect(CHECKLIST_KIND_LABEL_FR.OFFBOARDING).toBe("Départ");
    expect(isChecklistKind("OFFBOARDING")).toBe(true);
    expect(isChecklistKind("DEPART")).toBe(false);
    // The same two values the migration constrains.
    expect(read("supabase/migrations/20260902000001_hr_offboarding_foundation.sql"))
      .toMatch(/check \(kind in \('ONBOARDING','OFFBOARDING'\)\)/);
  });

  it("no parallel checklist model was created — the HR-4 tables are the only ones", () => {
    const a = code(ACTIONS);
    expect(a).toMatch(/from\("hr_checklist_template"\)/);
    expect(a).toMatch(/from\("hr_checklist_item_template"\)/);
    // Nothing else: no new table, no new migration for this fix.
    expect(a).not.toMatch(/from\("(?!hr_checklist_)[a-z_]+"\)/);
  });
});

describe("authority — the existing permission, nothing new", () => {
  it("every action gates on hr:config:manage", () => {
    const a = code(ACTIONS);
    const gates = [...a.matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(gates.length).toBe(5); // create/update template, create/update/delete item
    expect(new Set(gates)).toEqual(new Set(["hr:config:manage"]));
  });

  it("every write is tenant-scoped and audited", () => {
    const a = code(ACTIONS);
    // One audit per mutating action, and each carries the tenant.
    expect((a.match(/writeAudit\(/g) ?? []).length).toBe(5);
    expect((a.match(/tenantId: admin\.tenantId/g) ?? []).length).toBeGreaterThanOrEqual(5);
    for (const m of a.matchAll(/\.(update|delete)\(\)?[\s\S]{0,200}?;/g)) {
      expect(m[0]).toContain('eq("tenant_id", admin.tenantId)');
    }
  });

  it("the reads are tenant-filtered", () => {
    const r = code(READS);
    expect((r.match(/eq\("tenant_id", tenantId\)/g) ?? []).length).toBe(2);
  });
});

describe("what may change and what may not", () => {
  it("kind and code are immutable after creation", () => {
    const a = code(ACTIONS);
    const updateTpl = a.slice(
      a.indexOf("export async function updateChecklistTemplate"),
      a.indexOf("export async function createChecklistItem"),
    );
    expect(updateTpl).not.toMatch(/\bkind\b/);
    expect(updateTpl).not.toMatch(/\bcode\b/);
    // Only the two mutable fields reach the patch.
    expect(updateTpl).toMatch(/next\.label_fr = labelFr/);
    expect(updateTpl).toMatch(/next\.is_active = patch\.isActive/);
  });

  it("templates are retired by deactivation — no delete path exists for them", () => {
    const a = code(ACTIONS);
    expect(a).not.toMatch(/from\("hr_checklist_template"\)[\s\S]{0,120}\.delete\(/);
    expect(read(PANEL)).toMatch(/Désactiver|Réactiver/);
  });

  it("a step already used by a case cannot be deleted, and the refusal is translated", () => {
    const del = code(ACTIONS).slice(code(ACTIONS).indexOf("export async function deleteChecklistItem"));
    expect(del).toMatch(/error\.code === "23503" \? "item_in_use"/);
    expect(read(PANEL)).toContain("déjà été utilisée dans un dossier");
  });

  it("positions are assigned by the server, never typed by a user", () => {
    expect(code(ACTIONS)).toMatch(/position: \(last\?\.position \?\? 0\) \+ 1/);
    expect(code(PANEL)).not.toMatch(/position:/);
  });
});

describe("the surface a person actually uses", () => {
  it("the panel is rendered inside the existing configuration center", () => {
    const p = code(CONFIG_PAGE);
    // The RENDER, not merely the import — an unrendered import is no surface.
    expect(p).toMatch(/<ChecklistTemplatesPanel\s+templates=\{templates\}\s+itemsByTemplate=\{itemsByTemplate\}\s*\/>/);
    expect(p).toMatch(/listAllChecklistTemplates\(user\.tenantId\)/);
    expect(p).toMatch(/listChecklistItemsByTemplate\(user\.tenantId\)/);
    // Still one configuration route — no rival settings page was created.
    expect(p).toMatch(/hasPermission\(permissions, "hr:config:manage"\)/);
  });

  it("the panel speaks French and exposes no technical code", () => {
    // Comment-stripped: the panel's own prose must not satisfy its French pins.
    const s = code(PANEL);
    expect(s).toMatch(/<h2[^>]*>Modèles de check-list<\/h2>/);
    expect(s).toContain("Bloquante (empêche la clôture)");
    expect(s).toContain("Pièce justificative requise");
    expect(s).toContain("Créer le modèle");
    expect(s).not.toMatch(/hr:config:manage|hr_checklist_|23503|23505/);
  });

  it("both workspaces point at the place that now exists", () => {
    expect(read("components/hr/offboarding-studio.tsx")).toContain("Configuration → Modèles de check-list");
    expect(read("components/hr/onboarding-studio.tsx")).toContain("Configuration → Modèles de check-list");
    // The dead-end wording is gone.
    expect(read("components/hr/onboarding-studio.tsx"))
      .not.toContain("se configurent dans le centre de configuration");
  });

  it("the client panel imports the PURE model, never the server-only reads", () => {
    // A client component importing lib/hr/checklists.ts fails the build
    // (server-only) — the payroll/model.ts split exists for exactly this.
    expect(read(PANEL)).toContain('from "@/lib/hr/checklists/model"');
    expect(read(PANEL)).not.toMatch(/from "@\/lib\/hr\/checklists"/);
    // The model must not IMPORT server-only (its prose may name it).
    expect(read("lib/hr/checklists/model.ts")).not.toMatch(/^import "server-only";/m);
    expect(read(READS)).toMatch(/^import "server-only";/m);
  });

  it("editing a template never rewrites an open case — the snapshot rule is restated", () => {
    // The instantiation copies labels (migration 111 / HR-4); the panel says so.
    expect(read(PANEL)).toContain("ne réécrit jamais un dossier existant");
    expect(read(ACTIONS)).toMatch(/SNAPSHOT at instantiation/);
  });
});
