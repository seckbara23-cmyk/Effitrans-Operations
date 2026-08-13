/**
 * MAYA-P1.1 — Finance records the GAINDE registration (CEO step 8).
 * ---------------------------------------------------------------------------
 * `customs:register` shipped with the process engine, catalogued as « Register
 * the declaration in GAINDE (Finance, step 9) » and granted to the Finance
 * customs role — and nothing consumed it. This is its consumer, and only that.
 *
 * Four properties this suite defends:
 *
 *   1. THE NARROW CAPABILITY, NEVER A BROADER ONE. `external_ref` is already
 *      writable via `customs:update`; reaching it by widening Finance's rights
 *      would trade a precise permission for the declaration-editing authority.
 *   2. NOTHING IS SYNCHRONISED. BLK-1 stands: there is no GAINDE API. The act
 *      records what an operator typed, and provenance stays « manual ».
 *   3. NO STATUS MOVES. Registration is Finance's act; validation is the Chef de
 *      Transit's. They stay separate.
 *   4. CORRECTION IS ALLOWED, A DUPLICATE IS NOT — and the ordering question
 *      the registry raises is reported, not silently enforced.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveQC4 } from "@/lib/files/qc4";
import type { CustomsRecord } from "@/lib/customs/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260827000001_gainde_registration.sql";
const ACTIONS = "lib/customs/actions.ts";
const PANEL = "components/customs/customs-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const TZ = "Africa/Dakar";

function actionBody(): string {
  const s = code(ACTIONS);
  const start = s.indexOf("export async function recordGaindeRegistration");
  expect(start, "recordGaindeRegistration must exist").toBeGreaterThan(-1);
  return s.slice(start, s.indexOf("export async function", start + 1));
}

const customs = (over: Partial<CustomsRecord> = {}): CustomsRecord => ({
  id: "c1", fileId: "f1", status: "DECLARED", required: true,
  declarationNumber: null, customsOffice: null, regime: null, declarationDate: null,
  baeReference: null, releaseDate: null, inspectionStatus: "NOT_REQUIRED",
  externalRef: null, notes: null,
  receivabilityStatus: null, receivabilityAt: null, receivabilityNote: null,
  providerCode: "manual", providerSyncedAt: null,
  reviewedAt: null, reviewedByEmail: null,
  gaindeRegisteredAt: null, gaindeRegisteredByEmail: null, ...over,
});

// ===========================================================================
describe("the permission finally has a consumer", () => {
  it("the action asserts customs:register", () => {
    expect(actionBody()).toContain('assertPermission("customs:register")');
  });

  it("and NOTHING wider — not update, not validate", () => {
    const b = actionBody();
    const perms = [...b.matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(perms).toEqual(["customs:register"]);
    // The database refuses a substitute too, and proves it itself.
    const m = read(MIGRATION);
    expect(m).toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:register', 'SERVICE'\)/);
    expect(m).toContain("a broader customs permission must never substitute");
  });

  it("the Finance customs role holds it, and the Déclarant does not", () => {
    const roles = read("lib/platform/role-templates.ts");
    const holders: string[] = [];
    for (const m of roles.matchAll(/key: "(\w+)"/g)) {
      const next = roles.indexOf('key: "', m.index! + 6);
      if (roles.slice(m.index!, next === -1 ? undefined : next).includes('"customs:register"')) {
        holders.push(m[1]);
      }
    }
    expect(holders).toContain("CUSTOMS_FINANCE_OFFICER");
    expect(holders).not.toContain("CUSTOMS_DECLARANT");
    expect(holders).not.toContain("CHIEF_OF_TRANSIT");
  });

  it("no new permission was created — it already existed", () => {
    expect(read(MIGRATION)).not.toMatch(/insert into public\.(permission|role_permission)/);
    // The catalog entry that named this act all along.
    expect(read("supabase/migrations/20260713000001_process_engine.sql"))
      .toMatch(/'customs:register'[\s\S]{0,140}Register the declaration in GAINDE/);
  });

  it("customs:update remains a DIFFERENT path — the field was always writable", () => {
    const s = code(ACTIONS);
    const upd = s.slice(s.indexOf("export async function updateCustoms"), s.indexOf("export async function changeCustomsStatus"));
    expect(upd).toContain("external_ref");
    expect(upd).toContain('assertPermission("customs:update")');
    // Which is exactly why the narrow act was needed rather than a grant.
    expect(read(MIGRATION)).toContain("trade a precise permission for a broad one");
  });
});

// ===========================================================================
describe("nothing is synchronised", () => {
  it("the RPC never touches provider synchronisation state", () => {
    const m = read(MIGRATION);
    const fn = m.slice(m.indexOf("as $$"), m.indexOf("$$;"));
    expect(fn).not.toContain("provider_synced_at");
    expect(fn).not.toContain("provider_code");
    // …and the migration asserts that itself.
    expect(m).toContain("registration must not touch provider synchronisation state");
  });

  it("no surface claims a live GAINDE link", () => {
    for (const f of [MIGRATION, ACTIONS, PANEL]) {
      expect(code(f), f).not.toMatch(/synchronis[ée]\s+(avec\s+)?GAINDE|GAINDE\s+API/i);
    }
    // NOT a word ban. The operator-facing hint uses « connexion » and
    // « synchronise » inside a NEGATION — it exists precisely to say neither
    // happens — so banning the words would fail on the sentence that makes the
    // honest claim. Assert the claim instead.
    const i18n = read("lib/i18n.ts");
    const block = i18n.slice(i18n.indexOf("gainde: {"), i18n.indexOf("hint:", i18n.indexOf("gainde: {")) + 400);
    expect(block).toMatch(/Aucune connexion GAINDE n'est en service/);
    expect(block).toMatch(/elle ne la synchronise pas/);
    expect(block).toContain("Saisie manuelle");
  });

  it("BLK-1 is not closed by this phase", () => {
    const cfg = read("lib/customs/intelligence/config.ts");
    expect(cfg).toMatch(/there is NO official GAINDE API contract wired/);
  });

  it("QC4 still reports the provenance as manual after a registration", () => {
    const e = deriveQC4({
      canReadCustoms: true, canReadDocuments: true,
      customs: customs({ externalRef: "GND-2026-4417", providerCode: "manual",
                         gaindeRegisteredAt: "2026-08-13T09:30:00.000Z" }),
      documents: [], missingRequiredCount: 0, timeZone: TZ,
    });
    const c = e.controls.find((x) => x.key === "customsTracking")!;
    expect(c.state).toBe("observed");
    expect(c.value).toContain("GND-2026-4417");
    expect(c.value).toContain("saisie manuelle");
    expect(c.reason).toMatch(/aucune intégration/i);
  });
});

// ===========================================================================
describe("no status moves, and no prerequisite is invented", () => {
  it("the write touches only the reference and its attribution", () => {
    const m = code(MIGRATION);
    const upd = m.slice(m.indexOf("update public.customs_record"), m.indexOf("perform public.emit_business_event"));
    expect(upd).toContain("external_ref");
    expect(upd).toContain("gainde_registered_at");
    expect(upd).toContain("gainde_registered_by");
    expect(upd).not.toMatch(/\bstatus\b|intel_status/);
  });

  it("the action fires no handoff, notification or reconciliation", () => {
    expect(actionBody()).not.toMatch(/reconcileDossierProcess|onCustomsReleased|custCustomsCleared|changeCustomsStatus/);
  });

  it("prior Chef Transit validation is NOT enforced — and the reason is recorded", () => {
    const m = read(MIGRATION);
    const fn = m.slice(m.indexOf("as $$"), m.indexOf("$$;"));
    expect(fn).not.toMatch(/reviewed_at|reviewed_by/);
    // The registry describes the ordering but disclaims running the process,
    // and enforcing it would block every dossier predating PG-1.
    expect(m).toContain("DESCRIBES the process. It does not run it");
    expect(read("lib/process/effitrans-process.ts")).toContain("This registry DESCRIBES the process. It does not run it.");
  });

  it("recevabilité and validation stay independent of registration", () => {
    // Comments stripped: the migration legitimately CITES
    // record_customs_receivability as the precedent for its correction
    // doctrine. What matters is that the function body touches neither.
    const m = code(MIGRATION);
    const fn = m.slice(m.indexOf("as $$"), m.indexOf("$$;"));
    expect(fn).not.toMatch(/receivability/);
    expect(fn).not.toMatch(/reviewed_by|reviewed_at/);
    expect(code("lib/customs/receivability.ts")).toContain("RECEIVABILITY_OUTCOMES");
  });
});

// ===========================================================================
describe("correction is allowed; a duplicate is not", () => {
  it("re-recording the SAME reference is refused", () => {
    const m = read(MIGRATION);
    expect(m).toContain("this GAINDE reference is already recorded");
    expect(m).toMatch(/v_prev is not distinct from v_ref/);
    expect(actionBody()).toContain('"reference_unchanged"');
  });

  it("a DIFFERENT reference is accepted, and marked as a correction", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/'corrected', v_prev is not null/);
  });

  it("an empty reference is refused at both layers", () => {
    expect(read(MIGRATION)).toContain("a GAINDE reference is required");
    expect(actionBody()).toContain('"reference_required"');
  });

  it("the row is locked, so two registrars cannot race", () => {
    expect(read(MIGRATION)).toMatch(/for update;/);
  });

  it("attribution moves with the instant — never half a registration", () => {
    expect(read(MIGRATION)).toContain("customs_gainde_registration_complete");
  });
});

// ===========================================================================
describe("security, audit and blast radius", () => {
  it("the RPC is service_role only (OPS-SEC-1)", () => {
    const m = read(MIGRATION);
    for (const who of ["public", "anon", "authenticated"]) {
      expect(m, who).toContain(`revoke execute on function public.record_gainde_registration(uuid, text, uuid) from ${who}`);
    }
    expect(m).toContain("grant  execute on function public.record_gainde_registration(uuid, text, uuid) to service_role");
  });

  it("the tenant is derived from the record, never accepted from the caller", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/select tenant_id[\s\S]{0,120}into v_tenant/);
    expect(m).not.toMatch(/p_tenant\s+uuid/);
  });

  it("INV-9: the fail-closed lane is never invoked", () => {
    const m = read(MIGRATION);
    const fn = m.slice(m.indexOf("as $$"), m.indexOf("$$;"));
    expect(fn).not.toContain("SYSTEM");
  });

  it("dossier visibility is checked before anything is written", () => {
    const b = actionBody();
    expect(b.indexOf("isFileVisible")).toBeGreaterThan(-1);
    expect(b.indexOf("isFileVisible")).toBeLessThan(b.indexOf(".rpc("));
  });

  it("the act is audited and appended to the ledger exactly once", () => {
    expect(actionBody()).toContain("writeAudit");
    const reg = read("lib/workflow/events/types.ts");
    expect((reg.match(/GAINDE_REGISTRATION_RECORDED/g) ?? []).length).toBe(1);
    const entry = reg.slice(reg.indexOf('type: "GAINDE_REGISTRATION_RECORDED"'));
    expect(entry.slice(0, 240)).toContain('emission: "rpc"');
    expect(entry.slice(0, 240)).toContain("clientSafe: false");
    expect(read(MIGRATION)).not.toMatch(/create (or replace )?trigger/i);
  });

  it("without customs:read the registration is not disclosed through QC4", () => {
    const e = deriveQC4({
      canReadCustoms: false, canReadDocuments: true,
      customs: customs({ externalRef: "GND-2026-4417", gaindeRegisteredAt: "2026-08-13T09:30:00.000Z",
                         gaindeRegisteredByEmail: "finance@effitrans.sn" }),
      documents: [], missingRequiredCount: 0, timeZone: TZ,
    });
    const rendered = JSON.stringify(e);
    expect(rendered).not.toContain("GND-2026-4417");
    expect(rendered).not.toContain("finance@effitrans.sn");
  });

  it("the panel gates the control on the real permission", () => {
    expect(code(PAGE)).toContain('canRegisterGainde={hasPermission(permissions, "customs:register")}');
    expect(code(PANEL)).toMatch(/canRegisterGainde &&/);
  });

  it("only customs_record is altered, additively", () => {
    const m = code(MIGRATION);
    expect(new Set([...m.matchAll(/alter table public\.(\w+)/g)].map((x) => x[1]))).toEqual(new Set(["customs_record"]));
    expect(m).not.toMatch(/drop (table|column|constraint)/i);
    expect([...m.matchAll(/add column if not exists (\w+)/g)].map((x) => x[1]).sort())
      .toEqual(["gainde_registered_at", "gainde_registered_by"]);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("PG-1 and PG-6 survive intact", () => {
    expect(code(ACTIONS)).toContain('assertPermission("customs:validate")');
    expect(read("supabase/migrations/20260826000001_customs_editor_attribution.sql"))
      .toMatch(/v_editor = p_actor/);
  });

  it("QC1–QC6 remain, with their open questions open", () => {
    expect(code("lib/commercial/qc1.ts")).toContain("QC1_DEFERRED");
    expect(code("lib/files/qc2.ts")).toContain("QC2_TRANSMISSION_CONFLICT");
    expect(code("lib/files/qc4.ts")).toContain("QC4_NO_CHECKLIST");
    expect(code("lib/files/qc5.ts")).toContain("QC5_NO_VEHICLE_CONFORMITY");
    expect(code("lib/files/qc6.ts")).toContain("QC6_NO_ARCHIVE_AUTHORITY");
  });

  it("the migration ledger is consistent", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const bi = read("lib/platform/ops/build-info.ts");
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(bi)![1]));
    expect(migrations).toContain("20260827000001_gainde_registration.sql");
    expect(bi).toContain('LATEST_MIGRATION = "20260827000001_gainde_registration"');
  });

  it("no rattachement, BAE, transport or finance work leaked in", () => {
    const b = actionBody();
    expect(b).not.toMatch(/rattachement|bae_reference|transport|invoice/i);
  });
});
