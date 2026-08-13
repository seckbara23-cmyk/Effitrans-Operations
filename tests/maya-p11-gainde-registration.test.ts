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

  it("the migration's OWN guard reads code, not prose — the P1.1 incident", () => {
    // The first version of this migration scanned pg_proc.prosrc raw. prosrc
    // INCLUDES comments, so it matched the body's own honesty line naming
    // customs:update to say it is NOT used — and aborted in production, then
    // in CI #449. The rule was right; the evidence was wrong.
    const m = read(MIGRATION);
    expect(m).toContain("v_body := regexp_replace(v_src, '--.*$', '', 'ng')");
    // Every permission check now reads the stripped body, never the raw source.
    const guard = m.slice(m.indexOf("declare n int; v_src text; v_body text;"));
    for (const bad of ["v_src ~ 'customs:update'", "v_src ~ 'customs:validate'", "v_src !~ 'customs:register'"]) {
      expect(guard, bad).not.toContain(bad);
    }
    expect(guard).toContain("v_body ~ 'customs:update'");
    expect(guard).toContain("v_body !~ 'customs:register'");
  });

  it("the EXECUTABLE body names customs:register and no broader permission", () => {
    // The property the migration asserts, asserted here too — on the same
    // comment-stripped basis, so the two can never disagree.
    const m = read(MIGRATION);
    const raw = m.slice(m.indexOf("as $$", m.indexOf("record_gainde_registration")));
    const body = raw.slice(0, raw.indexOf("$$;")).replace(/--[^\n]*/g, "");
    expect(body).toContain("customs:register");
    expect(body).not.toContain("customs:update");
    expect(body).not.toContain("customs:validate");
    expect(body).not.toContain("provider_code");
    expect(body).not.toContain("provider_synced_at");
    expect(body).not.toContain("intel_status");
    expect(body).not.toContain("SYSTEM");
    // …and the comment that broke it is still there, because it is true.
    expect(raw.slice(0, raw.indexOf("$$;"))).toContain("never customs:update");
  });

  it("the migration is re-run safe, which is why 105 needs no new timestamp", () => {
    const m = read(MIGRATION);
    expect(m).toContain("add column if not exists");
    expect(m).toContain("create or replace function");
    expect(m).toMatch(/if not exists \(\s*select 1 from pg_constraint/);
    expect(m).toContain("RE-RUN SAFE");
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

  it("the action fires no handoff and no status cascade", () => {
    // MAYA-P1.2 AMENDED THIS. It used to forbid `reconcileDossierProcess` too,
    // and that was right at the time: no rule proved this step from Finance's
    // fact, so reconciling would have completed CEO step 8 from the DECLARANT's
    // paperwork. P1.2 made the rule read the milestone, so the call became the
    // ordinary WES-5 convergence — and what the prohibition actually protected
    // (no status move, no cascade, no handoff) is unchanged and still pinned.
    expect(actionBody()).not.toMatch(/onCustomsReleased|custCustomsCleared|changeCustomsStatus|sendHandoff|notifyRoles/);
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
// MAYA-P1.1 — production UAT reconciliation.
//
// UAT reported « no Enregistrement GAINDE action available to Finance ». The
// control was not missing. « Chargé finance » is FINANCE_OFFICER; the role that
// owns CEO step 8 is CUSTOMS_FINANCE_OFFICER, « Chargé finance douane ». The
// first holds NO customs permission at all — which is, in as many words, the
// ratified reason the second exists. Two different jobs, two different labels,
// one letter of difference on screen.
//
// So nothing is built here. What was missing was a TEST: nothing pinned the
// composition that makes the act reachable to the right actor and inert for the
// wrong one. These do.
//
// Note the asymmetry they guard. The server action admits `customs:register`
// ALONE, but the panel that carries the button is wrapped in `customs:read`.
// That is safe only for as long as every register-holder also holds read —
// true in all three grant sources today, and now enforced rather than assumed.
// The alternative, granting Finance `customs:read` it does not need or building
// a second panel for a holder that does not exist, both cost more than the rule.
// ===========================================================================
function templateBlock(roleKey: string): string {
  const roles = read("lib/platform/role-templates.ts");
  const start = roles.indexOf(`key: "${roleKey}"`);
  expect(start, `${roleKey} must be a tenant role template`).toBeGreaterThan(-1);
  const next = roles.indexOf('key: "', start + 6);
  return roles.slice(start, next === -1 ? undefined : next);
}

/** The GAINDE card, from its heading to the next card's. */
function gaindeCard(): string {
  const p = code(PANEL);
  const start = p.indexOf("c.gainde.title");
  const end = p.indexOf("c.validation.title");
  expect(start, "the GAINDE card must exist in the panel").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return p.slice(start, end);
}

describe("a customs:register holder reaches the act, and gains nothing else", () => {
  it("every role granted customs:register also holds customs:read", () => {
    // THE REACHABILITY INVARIANT. The panel wrapper is `customs:read`; the
    // action is `customs:register`. A role granted the second without the first
    // would hold an authority it could never exercise — a silent dead end, not
    // an error message. Fix the composition then, not this assertion.
    const roles = read("lib/platform/role-templates.ts");
    const registerHolders = [...roles.matchAll(/key: "(\w+)"/g)]
      .map((m) => m[1])
      .filter((k) => templateBlock(k).includes('"customs:register"'));
    expect(registerHolders.length).toBeGreaterThan(0);
    for (const k of registerHolders) {
      expect(templateBlock(k), `${k} holds customs:register`).toContain('"customs:read"');
    }
  });

  it("the two SQL grant sources agree with the template", () => {
    // EC-3B: a permission lives in three places. The template provisions NEW
    // tenants; these two carry the EXISTING one. All three must name the same
    // holders, or production diverges from the repository silently.
    for (const f of ["supabase/migrations/20260713000001_process_engine.sql", "supabase/seed.sql"]) {
      const sql = code(f);
      const block = sql.slice(sql.indexOf("p.code = 'customs:register'"));
      // Parse the codes; do NOT substring-match them. `CUSTOMS_FINANCE_OFFICER`
      // ENDS in `FINANCE_OFFICER`, so "is FINANCE_OFFICER absent" is a question
      // only an exact set can answer — the two roles this whole phase is about.
      const roleList = block.slice(block.indexOf("r.code in ("), block.indexOf("on conflict"));
      const granted = new Set([...roleList.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
      expect(granted, f).toEqual(new Set(["SYSTEM_ADMIN", "OPS_SUPERVISOR", "CUSTOMS_FINANCE_OFFICER"]));
      expect(granted.has("FINANCE_OFFICER"), `${f}: the plain Finance role`).toBe(false);
      // …and that same role is granted customs:read, so the panel renders.
      const readBlock = sql.slice(sql.indexOf("and r.code = 'CUSTOMS_FINANCE_OFFICER'") - 600);
      expect(readBlock.slice(0, 700), f).toContain("'customs:read'");
    }
  });

  it("FINANCE_OFFICER holds NO customs permission — the reason the other role exists", () => {
    // This is what UAT actually met. It is correct behaviour, and it is why the
    // screenshot showed « Non visible avec vos accès (douane) » in QC4.
    expect(templateBlock("FINANCE_OFFICER")).not.toMatch(/"customs:/);
    expect(templateBlock("CUSTOMS_FINANCE_OFFICER"))
      .toContain("FINANCE_OFFICER holds no customs permission at all");
  });

  it("the Finance customs role gets the act and NOT the declaration authority", () => {
    const b = templateBlock("CUSTOMS_FINANCE_OFFICER");
    expect(b).toContain('"customs:register"');
    expect(b).toContain('"customs:read"');
    for (const denied of ["create", "update", "delete", "release", "validate", "assign"]) {
      expect(b, `customs:${denied}`).not.toContain(`"customs:${denied}"`);
    }
  });

  it("the GAINDE card is gated on customs:register alone", () => {
    const card = gaindeCard();
    expect(card).toMatch(/canRegisterGainde &&/);
    for (const flag of ["canUpdate", "canValidate", "canRelease", "canCreate", "canDelete"]) {
      expect(card, flag).not.toContain(flag);
    }
  });

  it("and every OTHER control on the panel stays behind its own permission", () => {
    // The same viewer — read + register, nothing else — must see a read-only
    // customs panel carrying exactly one action. Each of these is the gate that
    // makes that true; none of them is `canRegisterGainde`.
    const p = code(PANEL);
    expect(p).toMatch(/\(canUpdate \|\| canRelease\) && targets\.length > 0/); // status moves
    expect(p).toMatch(/canUpdate && \(\s*<form onSubmit=\{onSubmit\}/);        // declaration edit
    expect(p).toMatch(/canValidate && !record\.reviewedAt/);                   // PG-1 validation
    const recevabilite = p.slice(p.indexOf("c.receivability.title"));
    expect(recevabilite.slice(0, recevabilite.indexOf("RECEIVABILITY_OUTCOMES"))).toContain("canUpdate &&");
  });

  it("Finance's own workflow surface points at the act", () => {
    // Reachability is not only the dossier page: the queue the official process
    // assigns to this role, and the control tower bucket that routes to it.
    const q = code("lib/process/queues/registry.ts");
    const block = q.slice(q.indexOf('key: "finance_customs"'), q.indexOf('key: "customs_field"'));
    expect(block).toContain('officialRole: "CUSTOMS_FINANCE_OFFICER"');
    expect(block).toMatch(/permission: "process:read"/);
    expect(templateBlock("CUSTOMS_FINANCE_OFFICER")).toContain('"process:read"');
    expect(code("lib/process/queues/control-tower.ts")).toContain('"/queues/finance_customs"');
  });

  it("the evidence contract is reference + date + actor, and the receipt is not here", () => {
    // Step 9's requiredEvidence names four things. Three are captured; the
    // fourth is a DOCUMENT, and the document authority already owns documents.
    const card = gaindeCard();
    expect(card).toContain("record.externalRef");
    expect(card).toContain("record.gaindeRegisteredAt");
    expect(card).toContain("record.gaindeRegisteredByEmail");
    expect(card).not.toMatch(/receipt|recu|reçu/i);
    expect(read(MIGRATION)).toContain("the document authority already owns documents");
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
