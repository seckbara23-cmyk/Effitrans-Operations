/**
 * A cheap, local guard for an expensive, remote failure.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. `activateStep` now refuses an open, unclaimed step to
 * anyone outside its owning role (OPS-CUSTOMS-GAINDE-04 A4). The journey suites
 * are the only place that exercises it for real, they need a live database, and
 * they run ONLY in CI — so an actor/step mismatch costs a full push-and-wait
 * cycle to discover and reads as an unrelated regression when it lands. It cost
 * exactly one such cycle to discover, which is what prompted this file.
 *
 * Everything needed to catch it is static: which role each journey fixture
 * holds (`supabase/tests/journey_identities.sql`), which role owns each step
 * (`supabase/migrations/20260914000001_responsibility_visibility.sql`), and
 * which identity activates which step (the journey sources). This cross-checks
 * the three in milliseconds.
 *
 * ONE DESIGN NOTE, LEARNED THE HARD WAY. The first version allowlisted
 * exceptions by (actor, step) pair. That was worse than nothing: the same pair
 * appears once as a NEGATIVE case and once as a positive one, so the licence
 * granted for the negative case silently covered a real mismatch — a probe that
 * reintroduced the bug found this suite still green. Exceptions now name the
 * mechanism that justifies them and are checked against it, and negative cases
 * are recognised from their own assertion instead of being listed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

/** step_key -> owning role code, from the registry mirror's own seed. */
function owningRoles(): Map<string, string> {
  const sql = read("supabase/migrations/20260914000001_responsibility_visibility.sql");
  const out = new Map<string, string>();
  for (const m of sql.matchAll(/\('([a-z_]+)',\s*'([A-Z_]+)',\s*'step \d+/g)) out.set(m[1], m[2]);
  expect(out.size, "owning-role seed not parsed").toBeGreaterThanOrEqual(26);
  return out;
}

/**
 * journey fixture label -> the role codes it holds.
 *
 * A SET rather than one code since UAT-DECLARANT-PICKER-01: one fixture
 * deliberately holds two roles, and reading only the last grant parsed would
 * have made this guard depend on the order of lines in a SQL file.
 */
function fixtureRoles(): Map<string, Set<string>> {
  const sql = read("supabase/tests/journey_identities.sql");
  const byUid = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/\('(00000000-0000-0000-0000-[0-9a-f]{12})'::uuid,\s*'([A-Z_]+)'\)/g)) {
    const held = byUid.get(m[1]) ?? new Set<string>();
    held.add(m[2]);
    byUid.set(m[1], held);
  }
  const out = new Map<string, Set<string>>();
  for (const m of sql.matchAll(
    /\('(00000000-0000-0000-0000-[0-9a-f]{12})',\s*'[^']+',\s*'journey\.([a-z]+)@test\.local'/g,
  )) {
    const held = byUid.get(m[1]);
    if (held) out.set(m[2], held);
  }
  // The synthetic blind fixture is granted through its own statement.
  if (sql.includes("JOURNEY_EVIDENCE_BLIND")) out.set("blindquote", new Set(["JOURNEY_EVIDENCE_BLIND"]));
  expect(out.size, "journey fixture roles not parsed").toBeGreaterThan(10);
  return out;
}

/** journey variable -> fixture label, e.g. `blind = await identity("blindquote")`. */
function variableToFixture(): Map<string, string> {
  const dir = fileURLToPath(new URL("../tests/journey", import.meta.url));
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    for (const m of read(`tests/journey/${f}`).matchAll(
      /([A-Za-z_$][\w$]*)\s*=\s*await identity\("([a-z]+)"\)/g,
    )) {
      out.set(m[1], m[2]);
    }
  }
  expect(out.size, "journey identity bindings not parsed").toBeGreaterThan(5);
  return out;
}

/**
 * Activations whose actor is NOT the owning role and which are nonetheless
 * legitimate, each mapped to the SOURCE TOKEN that makes them so. An exception
 * that cannot point at its own mechanism is not an exception.
 */
const EXPLAINED: Record<string, string> = {
  // EMPTY, and that is the point. It held one entry — the Chef de Transit
  // activating step 6 after assigning it to himself — until
  // UAT-DECLARANT-PICKER-01 ratified that the Déclarant slot requires the
  // Déclarant role. The journeys now name a Déclarant, so the exception has no
  // call site and test 03 below would reject it as a stale licence.
};

type Activation = { file: string; variable: string; stepKey: string; expectsSuccess: boolean };

function activations(): Activation[] {
  const dir = fileURLToPath(new URL("../tests/journey", import.meta.url));
  const out: Activation[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".journey.ts"))) {
    const src = read(`tests/journey/${f}`)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The binding, when there is one: `const refused = await as(x, () => …)`.
    // Capturing it is what makes the negative/positive split reliable — a
    // fixed-size lookahead window is not, because one activation's window
    // reaches into the NEXT one's assertion, and a probe proved that window
    // silently reclassified a positive call site as negative.
    for (const m of src.matchAll(
      /(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?await\s+as\(\s*([A-Za-z_$][\w$]*)\s*,\s*\(\)\s*=>\s*activateStep\(\s*\w+\s*,\s*"([a-z_]+)"/g,
    )) {
      const [, binding, variable, stepKey] = m;
      // A NEGATIVE case asserts its own refusal, so it makes no ownership claim
      // and the refusal it names may legitimately be a different one.
      let expectsSuccess = true;
      if (binding) {
        const assertion = src.slice(src.indexOf(`expect(${binding}`, m.index ?? 0));
        const stmt = assertion.slice(0, assertion.indexOf(";") + 1);
        if (stmt.includes(".toBe(false)")) expectsSuccess = false;
      }
      out.push({ file: f, variable, stepKey, expectsSuccess });
    }
  }
  return out;
}

describe("every journey activation is performed by the step's owning role", () => {
  const owners = owningRoles();
  const roles = fixtureRoles();
  const vars = variableToFixture();
  const acts = activations();

  it("01 — the three sources parse, and there is something to check", () => {
    expect(acts.length, "no activateStep call sites found").toBeGreaterThan(15);
    expect(acts.some((a) => a.expectsSuccess), "no POSITIVE activation found").toBe(true);
    expect(acts.some((a) => !a.expectsSuccess), "no NEGATIVE activation found").toBe(true);
    expect(owners.get("customs_preparation")).toBe("CUSTOMS_DECLARANT");
    expect(owners.get("cotation")).toBe("QUOTATION_MANAGER");
    expect(roles.get("quotation")?.has("QUOTATION_MANAGER")).toBe(true);
  });

  it("02 — each successful activation is by the owning role, or names its mechanism", () => {
    const problems: string[] = [];
    for (const a of acts) {
      if (!a.expectsSuccess) continue; // a refusal is not an ownership claim
      const owning = owners.get(a.stepKey);
      if (!owning) continue; // outside the registry mirror: the guard defers, by design
      const fixture = vars.get(a.variable);
      if (!fixture) continue; // not an identity() binding — nothing to check
      const held = roles.get(fixture);
      if (held?.has(owning)) continue;
      const token = EXPLAINED[`${a.variable}::${a.stepKey}`];
      if (token && read(`tests/journey/${a.file}`).includes(token)) continue;
      problems.push(
        `${a.file}: ${a.variable} (${held ? [...held].join("+") : "?"}) activates ${a.stepKey}, owned by ${owning}`,
      );
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("03 — every exception still corresponds to a real, successful call site", () => {
    // A stale entry is a licence nobody is using, and the next real mismatch
    // could hide behind it.
    for (const [key, token] of Object.entries(EXPLAINED)) {
      const [variable, stepKey] = key.split("::");
      const sites = acts.filter(
        (a) => a.variable === variable && a.stepKey === stepKey && a.expectsSuccess,
      );
      expect(sites.length, `${key} is allowlisted but nothing activates it successfully`)
        .toBeGreaterThan(0);
      for (const a of sites) {
        expect(
          read(`tests/journey/${a.file}`).includes(token),
          `${key} is allowlisted in ${a.file} but ${token} is not there`,
        ).toBe(true);
      }
    }
  });

  it("04 — the fixtures hold one canonical role each, with one declared exception", () => {
    // A second role held quietly would make one of these pairings pass for the
    // wrong reason. The rule and its single exception are both written in the
    // seed, and the exception must stay single: exactly one fixture holds more
    // than one role, and it is the one the seed names.
    const sql = read("supabase/tests/journey_identities.sql");
    expect(sql).toContain("EXACTLY one canonical role each");
    expect(sql).toContain("ONE DELIBERATE EXCEPTION");

    const multi = [...fixtureRoles().entries()].filter(([, held]) => held.size > 1);
    expect(multi.map(([label]) => label), "only the declared dual-role fixture holds two")
      .toEqual(["declarantchief"]);
    expect([...multi[0][1]].sort()).toEqual(["CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT"]);
  });
});
