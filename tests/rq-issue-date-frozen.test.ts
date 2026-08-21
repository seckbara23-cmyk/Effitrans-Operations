/**
 * RQ / Alternative B — « Émis le : DD/MM/YYYY », frozen, never a render clock.
 * ---------------------------------------------------------------------------
 * The audit established two independent properties, and this change had to keep
 * both:
 *
 *   BUSINESS determinism — a version always represents the same facts;
 *   BYTE determinism     — the same inputs always produce the same bytes.
 *
 * The trap it avoids: the PDF is rendered BEFORE the row is inserted, so reading
 * a clock in each place gives two values moments apart. Across midnight UTC they
 * fall on different DAYS, and the paper would then disagree with
 * `document.generated_at` forever. So the action mints the timestamp ONCE and
 * hands the same value to the renderer and to `finalize_generated_artifact`.
 *
 * Migration 120 exists solely to let the RPC accept it, with `now()` demoted to
 * a fallback for callers that supply nothing.
 *
 * Reproduction contract:
 *   (source_snapshot, renderer_version, artifactVersion, generated_at)
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderArtifact, RENDERER_VERSION, frDate } from "@/lib/documents/artifacts/render";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const renderSrc = read("lib", "documents", "artifacts", "render.ts");
const actions = read("lib", "documents", "artifacts", "actions.ts");
const migration = read("supabase", "migrations", "20260912000001_artifact_generated_at.sql");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = strip(renderSrc);
const actionsCode = strip(actions);
const sql = migration.replace(/--.*$/gm, "");

const SNAPSHOT: Record<string, string> = {
  fileNumber: "EFT-IMP-2026-00005",
  clientName: "Client UAT",
  transportMode: "SEA",
  pickupLocation: "Port de Dakar",
  pickupPlanned: "2026-08-21",
  deliveryLocation: "Diamniadio",
  deliveryPlanned: "2026-08-22",
  transportCompany: "UAT Transporteur SARL",
};

const asText = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const renderOrder = (generatedAt?: string | null, artifactCode = "TRANSPORT_ORDER") =>
  renderArtifact({
    artifactCode,
    snapshot: SNAPSHOT,
    provenance: "NO_DRIVER",
    organizationName: "Effitrans",
    artifactVersion: 4,
    generatedAt,
  });

describe("RQ/B — the issue date is visible and French", () => {
  it("prints « Émis le : DD/MM/YYYY »", () => {
    const out = asText(renderOrder("2026-08-21T11:40:48.000Z"));
    expect(out).toContain("mis le : 21/08/2026");   // accent-free stem
  });

  it("prints the DATE only — no hour", () => {
    const out = asText(renderOrder("2026-08-21T11:40:48.000Z"));
    expect(out).not.toContain("11:40");
    expect(frDate("2026-08-21T11:40:48.000Z")).toBe("21/08/2026");
  });

  it("no raw ISO timestamp reaches the page", () => {
    expect(asText(renderOrder("2026-08-21T11:40:48.000Z"))).not.toContain("2026-08-21T");
  });
});

describe("RQ/B — the date is FROZEN from the supplied value, not a clock", () => {
  it("the renderer reads no clock at all", () => {
    expect(code).not.toContain("new Date()");
    expect(code).not.toContain("Date.now");
  });

  it("the printed date follows the SUPPLIED timestamp", () => {
    // A date far from today: only a supplied value could produce it.
    expect(asText(renderOrder("2019-03-07T23:00:00.000Z"))).toContain("mis le : 07/03/2019");
  });

  it("a DIFFERENT generatedAt intentionally changes the bytes", () => {
    // Proves the timestamp is a real render INPUT, not decoration — which is
    // what makes it part of the reproduction contract.
    const a = renderOrder("2026-08-21T11:40:48.000Z");
    const b = renderOrder("2026-08-22T11:40:48.000Z");
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("identical inputs produce byte-identical output", () => {
    const a = renderOrder("2026-08-21T11:40:48.000Z");
    const b = renderOrder("2026-08-21T11:40:48.000Z");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("two timestamps on the same DAY still differ in bytes only if the day differs", () => {
    // Date-granularity rendering: 09:00 and 21:00 on one day print identically.
    const morning = renderOrder("2026-08-21T09:00:00.000Z");
    const evening = renderOrder("2026-08-21T21:00:00.000Z");
    expect(Array.from(morning)).toEqual(Array.from(evening));
  });

  it("omitting it prints no issue date — what every historical version has", () => {
    expect(asText(renderOrder(null))).not.toContain("mis le :");
  });
});

describe("RQ/B — the SAME timestamp is rendered and persisted", () => {
  it("the action mints it exactly once", () => {
    expect((actionsCode.match(/const generatedAt = new Date\(\)\.toISOString\(\);/g) ?? []).length).toBe(1);
  });

  it("that one value is passed to the renderer", () => {
    const call = actionsCode.slice(
      actionsCode.indexOf("bytes = renderArtifact({"),
      actionsCode.indexOf("});", actionsCode.indexOf("bytes = renderArtifact({")),
    );
    expect(call).toContain("generatedAt,");
  });

  it("and the SAME variable is passed to the RPC — not a second clock read", () => {
    const call = actionsCode.slice(
      actionsCode.indexOf('supabase.rpc("finalize_generated_artifact"'),
      actionsCode.indexOf("});", actionsCode.indexOf('supabase.rpc("finalize_generated_artifact"')),
    );
    expect(call).toContain("p_generated_at: generatedAt,");
    // The decisive assertion: the RPC argument is the variable, never a fresh
    // Date. Two values on the same day would pass a weaker test and still be a
    // bug the day they straddle midnight.
    expect(call).not.toContain("new Date");
    expect(call).not.toContain("Date.now");
  });

  it("the action reads no second clock anywhere", () => {
    expect((actionsCode.match(/new Date\(\)/g) ?? []).length).toBe(1);
  });
});

describe("RQ/B — the RPC contract (migration 120)", () => {
  it("adds p_generated_at as the LAST parameter", () => {
    expect(sql).toContain("p_generated_at     timestamptz default null");
  });

  it("defaults to null so existing callers are not broken", () => {
    expect(sql).toContain("default null");
    expect(sql).toContain("p_generated_at is not the final parameter");
  });

  it("the supplied value wins IN THE INSERT; now() is only the fallback", () => {
    // Bound to the VALUES clause on purpose. `coalesce(p_generated_at, now())`
    // also appears inside this migration's own self-assertion, so a bare
    // toContain stayed green when the INSERT was reverted to plain now() —
    // the pin was satisfied by neighbouring text rather than by the behaviour.
    expect(sql).toContain("p_actor, coalesce(p_generated_at, now()), p_actor,");
    const values = sql.slice(sql.indexOf("insert into public.document"), sql.indexOf("-- Close the previous version"));
    expect(values.length).toBeGreaterThan(200);
    expect(values).not.toMatch(/p_actor,\s*now\(\),\s*p_actor/);
  });

  it("drops the 14-argument function so calls cannot become ambiguous", () => {
    expect(sql).toContain("drop function if exists public.finalize_generated_artifact(");
    expect(sql).toContain("expected exactly 1 finalize_generated_artifact");
  });

  it("restates the grants a DROP would otherwise discard", () => {
    expect(sql).toContain("to service_role;");
    expect(sql).toContain("from anon, authenticated;");
    expect(sql).toContain("must not be executable by anon/authenticated");
  });

  it("remains SECURITY DEFINER with a pinned search_path", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("must remain SECURITY DEFINER");
  });

  it("asserts NO table change: generated_at pre-exists and issued_at must not", () => {
    expect(sql).toContain("this migration must not create it");
    expect(sql).toContain("issued_at must not exist");
    expect(sql).not.toContain("alter table public.document add column");
  });
});

describe("RQ/B — scoped, and nothing else disturbed", () => {
  it("only the ORDRE DE TRANSPORT prints an issue date", () => {
    expect(code).toContain('const ARTIFACTS_WITH_ISSUE_DATE = new Set(["TRANSPORT_ORDER"]);');
    expect(asText(renderOrder("2026-08-21T11:40:48.000Z", "DEMANDE_TRANSPORT"))).not.toContain("mis le :");
  });

  it("the DEMANDE keeps « Date de la demande »", () => {
    const out = asText(renderArtifact({
      artifactCode: "DEMANDE_TRANSPORT",
      snapshot: { ...SNAPSHOT, fileType: "IMPORT", requestedBy: "Ops", requestedAt: "2026-08-20" },
      provenance: "NO_DRIVER",
      organizationName: "Effitrans",
      artifactVersion: 1,
      generatedAt: "2026-08-21T11:40:48.000Z",
    }));
    expect(out).toContain("20/08/2026");
  });

  it("the renderer version was bumped", () => {
    expect(RENDERER_VERSION).toBe("wes4g-4");
  });

  it("the RQ-18b label and the carrier snapshot are untouched", () => {
    const out = asText(renderOrder("2026-08-21T11:40:48.000Z"));
    expect(out).toContain("DITION");                 // « Mode de l'expédition »
    expect(out).toContain("UAT Transporteur SARL");  // assignment snapshot
  });
});
