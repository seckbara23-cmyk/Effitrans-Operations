/**
 * BLOCKER-3 — the mock modules are GONE, and must stay gone.
 * ---------------------------------------------------------------------------
 * Phase 5.0A found static, in-memory MOCK datasets still wired into the app:
 * lib/customs.ts, lib/tasks.ts, lib/shipments.ts, lib/customers.ts,
 * lib/documents.ts, lib/status.ts, lib/mock-data.ts, plus a tree of components
 * that rendered them. Two of the routes even ran generateStaticParams() over the
 * mocks, baking fabricated IDs (TSK-2026-0001, EFT-2026-0488, …) into every
 * production build.
 *
 * Phase 5.0C retired the routes. Phase 5.0D-5 deleted the modules, the components
 * and the routes outright. This guard proves it and fails CI if any of it returns.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Every mock module deleted in Phase 5.0D-5. */
const DELETED_MODULES = [
  "lib/customs.ts",
  "lib/tasks.ts",
  "lib/shipments.ts",
  "lib/customers.ts",
  "lib/documents.ts",
  "lib/status.ts",
  "lib/mock-data.ts",
];

/** Component trees and routes that existed only to render the mocks. */
const DELETED_PATHS = [
  "components/customers",
  "components/shipments",
  "components/customs/customs-explorer.tsx",
  "components/customs/customs-panels.tsx",
  "components/customs/customs-timeline.tsx",
  "components/dashboard/customs-table.tsx",
  "components/dashboard/shipments-table.tsx",
  "components/dashboard/tasks-table.tsx",
  "components/dashboard/kpi-card.tsx",
  "components/documents/document-panels.tsx",
  "components/documents/documents-explorer.tsx",
  "components/documents/doc-type-icon.tsx",
  "components/tasks/task-panels.tsx",
  "components/tasks/task-timeline.tsx",
  "components/tasks/tasks-explorer.tsx",
  "components/ui/badge.tsx",
  "components/ui/mode-tag.tsx",
  "components/ui/agent-chip.tsx",
  "app/shipments",
  "app/customers",
  "app/documents",
  "app/customs/[customsId]",
  "app/tasks/[taskId]",
];

/** Walk the real source tree (never node_modules / .next). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const rel = `${dir}/${entry}`;
    const full = join(root, rel);
    if (statSync(full).isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

const PRODUCTION = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")];

describe("BLOCKER-3 — mock modules are deleted", () => {
  it("finds a real production tree to scan (guard is not vacuous)", () => {
    expect(PRODUCTION.length).toBeGreaterThan(200);
  });

  it("has deleted every mock module", () => {
    const survivors = DELETED_MODULES.filter((m) => existsSync(join(root, m)));
    expect(survivors, `mock modules still on disk: ${survivors.join(", ")}`).toEqual([]);
  });

  it("has deleted every mock component tree and route", () => {
    const survivors = DELETED_PATHS.filter((p) => existsSync(join(root, p)));
    expect(survivors, `mock paths still on disk: ${survivors.join(", ")}`).toEqual([]);
  });

  it("no production file imports a deleted mock module", () => {
    const specs = DELETED_MODULES.map((m) => m.replace(/^lib\//, "@/lib/").replace(/\.ts$/, ""));
    const offenders: string[] = [];

    for (const file of PRODUCTION) {
      const src = readFileSync(join(root, file), "utf8");
      for (const spec of specs) {
        // Exact module specifier only: "@/lib/customs" must not match
        // "@/lib/customs/service" (the REAL customs module, which stays).
        const re = new RegExp(`["']${spec.replace(/[/@]/g, "\\$&")}["']`);
        if (re.test(src)) offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders, `production code still imports mock data:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no route bakes a fabricated ID into the build (no generateStaticParams over mocks)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("app")) {
      const src = readFileSync(join(root, file), "utf8");
      if (/export\s+(async\s+)?function\s+generateStaticParams/.test(src)) {
        offenders.push(file);
      }
    }
    // Every dossier/task/customs route is dynamic and DB-backed. No route may
    // prerender a fixed set of operational IDs.
    expect(offenders, `routes prerendering fixed IDs: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no fabricated operational ID survives anywhere in the source", () => {
    const FAKE = [/TSK-2026-\d{4}/, /EFT-2026-04\d{2}/, /DDU-2026-\d{5}/];
    const offenders: string[] = [];
    for (const file of PRODUCTION) {
      const src = readFileSync(join(root, file), "utf8");
      for (const pattern of FAKE) {
        if (pattern.test(src)) offenders.push(`${file} (${pattern})`);
      }
    }
    expect(offenders, `fabricated IDs still in source:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keeps the REAL modules that share a name with a deleted mock", () => {
    // lib/customs.ts (mock) is gone; lib/customs/ (the real module) stays.
    for (const real of [
      "lib/customs/service.ts",
      "lib/tasks/service.ts",
      "lib/documents/service.ts",
      "lib/clients/service.ts",
    ]) {
      expect(existsSync(join(root, real)), `${real} must survive`).toBe(true);
    }
  });
});
