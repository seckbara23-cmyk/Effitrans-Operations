/**
 * QO-1 — devis facultatif : origine commerciale honnête et visible.
 * ---------------------------------------------------------------------------
 * Ratified rule (QO-0 accepted 2026-08-18): a quotation is OPTIONAL. A dossier
 * legitimately originates from an accepted devis OR directly. QO-1 changes two
 * things and NOTHING else:
 *
 *   1. The cotation skip reason is DERIVED, not presumed — the universal
 *      « (client sous contrat) » wording is gone.
 *   2. « Origine commerciale » is visible on the dossier: « Devis N° X » or an
 *      explicit « Sans devis » — never indistinguishable from missing data.
 *
 * Scope guard (all pinned here): no quotation column on operational_file, no
 * new permission, no new table/flag/workflow, no portal exposure, skip/reopen
 * reversibility preserved, downstream controls untouched.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf-8");

const intake = read("lib", "process", "engine", "intake-actions.ts");
const service = read("lib", "files", "service.ts");
const component = read("components", "files", "commercial-origin.tsx");
const page = read("app", "files", "[id]", "page.tsx");
const panel = read("components", "process", "intake-panel.tsx");
const structures = read("lib", "process", "engine", "structures-actions.ts");

const openSlice = intake.slice(
  intake.indexOf("export async function openDossierWorkflow"),
  intake.indexOf("export async function handDossierToTransit"),
);

// ========================================================== derived reason ====

describe("QO-1 — the recorded skip reason is derived, never presumed", () => {
  it("reverse-looks-up the devis on the QUOTATION side (converted_file_id), tenant-scoped — no new relationship", () => {
    expect(openSlice).toContain('.from("quotation")');
    expect(openSlice).toContain('.eq("tenant_id", ctx.tenantId)');
    expect(openSlice).toContain('.eq("converted_file_id", fileId)');
  });

  it("devis branch records the commercial path with the devis number", () => {
    expect(openSlice).toContain("accepté — cotation réalisée côté commercial.");
    expect(openSlice).toContain("Devis N° ${devis.quotation_number}");
  });

  it("direct branch records the honest neutral reason", () => {
    expect(openSlice).toContain('reason = "Ouverture directe — dossier sans devis."');
  });

  it("the operator precision is optional, sanitized, capped, and joins ONLY the sans-devis branch", () => {
    const elseBranch = openSlice.slice(
      openSlice.indexOf('reason = "Ouverture directe'),
      openSlice.indexOf("const skipped = await skipStep"),
    );
    expect(elseBranch).toContain('(input.cotationPrecision ?? "").replace(/\\s+/g, " ").trim().slice(0, 280)');
    expect(elseBranch).toContain("if (precision) reason += ` Précision : ${precision}`");
    const devisBranch = openSlice.slice(openSlice.indexOf("if (devis) {"), openSlice.indexOf("} else {"));
    expect(devisBranch).not.toContain("cotationPrecision");
  });

  it("the universal presumption is GONE from the opening path", () => {
    expect(openSlice).not.toContain("client sous contrat");
    expect(openSlice).not.toContain("sans cotation préalable");
  });

  it("still the SAME audited mechanism: one MANUAL skipStep call, reason threaded", () => {
    expect(openSlice).toContain('skipStep(fileId, "cotation", { reason, source: "MANUAL" })');
    expect(openSlice).toContain("input.skipCotation !== false");
  });
});

// ============================================== reversibility preserved ====

describe("QO-1 — the skip/reopen mechanism is reused, not weakened", () => {
  it("skipStep still requires a non-empty reason and audits the skip", () => {
    const slice = structures.slice(
      structures.indexOf("export async function skipStep"),
      structures.indexOf("export async function reopenSkippedStep"),
    );
    expect(slice).toContain('if (!input.reason || input.reason.trim().length === 0) return fail("reason_required")');
    expect(slice).toContain("AuditActions.PROCESS_STEP_SKIPPED");
  });

  it("reopenSkippedStep still exists, reasoned and audited (SKIPPED → PENDING)", () => {
    expect(structures).toContain("export async function reopenSkippedStep");
  });
});

// ============================================================ the read ====

describe("QO-1 — getCommercialOrigin (lib/files/service.ts)", () => {
  const slice = service.slice(
    service.indexOf("export async function getCommercialOrigin"),
    service.indexOf("export async function listAssignableStaff"),
  );

  it("gated by the page's own authority: file:read (EC-3C — admin reads need an app gate)", () => {
    expect(slice).toContain('await assertPermission("file:read")');
  });

  it("reads the devis link from the quotation side only, tenant-scoped", () => {
    expect(slice).toContain('.from("quotation")');
    expect(slice).toContain('.eq("tenant_id", user.tenantId)');
    expect(slice).toContain('.eq("converted_file_id", fileId)');
  });

  it("surfaces ONLY existence and number — never quotation content (DEC-C32)", () => {
    expect(slice).toContain('.select("id, quotation_number")');
    for (const leak of ["amount", "total", "line", "tax", "currency"]) {
      expect(slice.toLowerCase()).not.toContain(leak);
    }
  });

  it("sans devis: the reason is the cotation execution's recorded skip reason, only when SKIPPED", () => {
    expect(slice).toContain('.eq("step_key", "cotation")');
    expect(slice).toContain('exec?.state === "SKIPPED"');
    expect(slice).toContain("skip_reason");
  });
});

// ======================================================== the component ====

describe("QO-1 — « Origine commerciale » block", () => {
  it("shows the block title and both states in French", () => {
    expect(component).toContain("Origine commerciale");
    expect(component).toContain("Sans devis");
    expect(component).toContain("Devis N° ${devisNumber}");
  });

  it("links into the commercial workspace ONLY for commercial-read holders (DEC-C32)", () => {
    expect(component).toContain("canLinkCommercial ? (");
    expect(component).toContain("/commercial/quotations/${quotationId}");
    const linkless = component.slice(component.indexOf(") : ("), component.indexOf("</p>"));
    expect(linkless).not.toContain("Link");
  });

  it("the recorded reason renders beneath « Sans devis » only — never under a devis line", () => {
    const sansDevisBranch = component.slice(component.indexOf('<div className="mt-2">'));
    expect(sansDevisBranch).toContain("{skipReason && <p");
    const devisBranch = component.slice(component.indexOf("{fromDevis ? ("), component.indexOf('<div className="mt-2">'));
    expect(devisBranch).not.toContain("skipReason");
  });

  it("display only: no client directive, no server action import", () => {
    expect(component).not.toContain('"use client"');
    expect(component).not.toContain("lib/files/actions");
  });
});

// ============================================================= the page ====

describe("QO-1 — dossier page wiring", () => {
  it("loads the origin and mounts the block", () => {
    expect(page).toContain("await getCommercialOrigin(file.id)");
    expect(page).toContain("<CommercialOrigin");
    expect(page).toContain("skipReason={commercialOrigin.skipReason}");
  });

  it("the link gate derives from the CANONICAL commercial-read set — not a re-typed list", () => {
    expect(page).toContain("COMMERCIAL_READ_PERMISSIONS.some((c) => hasPermission(permissions, c))");
  });
});

// ======================================================== intake panel ====

describe("QO-1 — intake panel precision (optional, never blocking)", () => {
  it("offers an OPTIONAL precision field, capped like the server cap", () => {
    expect(panel).toContain("Ouverture sans devis — précision (facultatif)");
    expect(panel).toContain("maxLength={280}");
  });

  it("threads it into the SAME opening call; empty stays undefined", () => {
    expect(panel).toContain("cotationPrecision: cotationPrecision.trim() || undefined");
  });

  it("the open button does NOT depend on the precision — creation is never blocked by a missing devis", () => {
    expect(panel).toContain("disabled={pending || !ownerUserId || nonOwnerBlocking.length > 0}");
  });
});

// ========================================================== scope guard ====

describe("QO-1 — scope guard (code only, architecture preserved)", () => {
  const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
  const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

  it("NO migration ever puts a quotation column on operational_file (the link stays on the quotation side)", () => {
    for (const f of migrations) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), "utf-8");
      const alters = sql.match(/alter table (?:public\.)?operational_file[\s\S]*?;/gi) ?? [];
      for (const stmt of alters) {
        expect(stmt.toLowerCase()).not.toContain("quotation");
      }
    }
  });

  it("QO-1 shipped no migration of its own", () => {
    expect(migrations.some((f) => /commercial_origin|sans_devis|quotation_optional/i.test(f))).toBe(false);
  });

  it("no new permission: the commercial-read set is still exactly quotation:create / quotation:validate", () => {
    const commercial = read("lib", "commercial", "service.ts");
    expect(commercial).toContain(
      'export const COMMERCIAL_READ_PERMISSIONS = ["quotation:create", "quotation:validate"] as const',
    );
  });

  it("the customer portal renders NOTHING of this", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf-8");
          if (src.includes("CommercialOrigin") || src.includes("getCommercialOrigin")) hits.push(full);
        }
      }
    };
    walk(path.join(__dirname, "..", "app", "portal"));
    expect(hits).toEqual([]);
  });

  it("conversion guards untouched: QT616/QT617 still live in the conversion RPC", () => {
    const sql = fs.readFileSync(path.join(migrationsDir, "20260806000001_commercial_quotation.sql"), "utf-8");
    expect(sql).toContain("QT616");
    expect(sql).toContain("QT617");
  });

  it("downstream controls untouched: after the cotation step, no step requires QUOTATION — and facturation still demands FINAL_INVOICE", () => {
    const process = read("lib", "process", "effitrans-process.ts");
    const afterCotation = process.slice(process.indexOf('key: "operations_intake"'));
    expect(afterCotation).not.toContain('"QUOTATION"');
    expect(afterCotation).toContain('"FINAL_INVOICE"');
  });
});
