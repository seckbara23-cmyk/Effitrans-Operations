/**
 * PERF-UX-01 Phase 1 — functions run beside the database.
 * ---------------------------------------------------------------------------
 * Production served every function from `iad1` (Washington, the Vercel
 * default) while Postgres, PostgREST and Auth live in AWS `eu-west-1`
 * (Ireland). Every Supabase request a render or an action made crossed the
 * Atlantic, and a dossier render makes about a hundred.
 *
 * `dub1` is Vercel's Dublin region, in the same AWS region as the database.
 * This is the project-level default Vercel documents for `vercel.json`; the
 * edge middleware is unaffected and still runs at the edge nearest the user.
 *
 * Deliberately single-region: a second region would put some requests back
 * across the Atlantic, which is the thing this removes.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, "utf8");

describe("function region", () => {
  const config = JSON.parse(read("vercel.json")) as Record<string, unknown>;

  it("pins every function to dub1, beside the eu-west-1 database", () => {
    expect(config.regions).toEqual(["dub1"]);
  });

  it("changes nothing else about the deployment", () => {
    expect(Object.keys(config).sort()).toEqual(["$schema", "regions"]);
  });

  it("the database really is in eu-west-1 (the linked pooler says so)", () => {
    const temp = `${root}supabase/.temp`;
    let pooler: string | null = null;
    try {
      if (readdirSync(temp).includes("pooler-url")) pooler = read("supabase/.temp/pooler-url");
    } catch {
      pooler = null; // CI has no link context; the region statement then rests on the audit
    }
    if (pooler !== null) expect(pooler).toContain("eu-west-1");
  });

  it("no route overrides the region back", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && /export const preferredRegion/.test(read(path))) offenders.push(path);
      }
    };
    walk("app");
    expect(offenders).toEqual([]);
  });
});
