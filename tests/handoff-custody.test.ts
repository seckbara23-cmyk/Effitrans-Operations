/**
 * UAT-WF-HANDOFF-01B — custody is asserted, not assumed.
 * ---------------------------------------------------------------------------
 * The audit found two holes in the Operations → Transit transfer.
 *
 * A step that promotion made REACHABLE was WORKABLE without the transfer ever
 * having happened. The engine refused work only while a handoff was still SENT,
 * so with no handoff at all there was nothing to refuse and Transit could begin
 * on a dossier Operations had never handed over.
 *
 * And `process:handoff:send` is generic — fourteen roles hold it, each for their
 * own route — so holding it said nothing about being entitled to perform THIS
 * custody transfer. A Finance officer or a Déclarant could formally transmit a
 * dossier from Operations to Transit.
 *
 * The ratified sequence, now enforced server-side:
 *
 *   step 3 COMPLETED → step 4 reachable, NOT workable
 *     → Operations transmits            → handoff SENT
 *     → Transit receives                → handoff RECEIVED
 *     → step 4 workable: Démarrer, then Terminer
 *
 * What must never drift:
 *   * reception UNLOCKS step 4 — it never starts or completes it;
 *   * the two custody facts stay distinct codes, because they need different acts;
 *   * step 14 / T9 stays parallel and is never subject to customs custody;
 *   * the display says where custody stands instead of calling it progress;
 *   * routes Effitrans has not ruled on keep exactly today's behaviour.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HANDOFF_ROUTES,
  routeTo,
  routeFor,
  maySendRoute,
  custodyStateFor,
  custodyRefusal,
} from "@/lib/process/handoff-routes";
import { deriveTransitStages } from "@/lib/process/transit";
import { getStep } from "@/lib/process/effitrans-process";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NL = String.fromCharCode(10);

const engineActions = strip(read("lib/process/engine/actions.ts"));
const routesSrc = strip(read("lib/process/handoff-routes.ts"));
const transitSrc = strip(read("lib/process/transit.ts"));
const dossierPage = strip(read("app/files/[id]/page.tsx"));
const processPage = strip(read("app/files/[id]/process/page.tsx"));

const STEP4 = "coordinator_reception";
const sent = [{ toStepKey: STEP4, status: "SENT" }];
const received = [{ toStepKey: STEP4, status: "RECEIVED" }];

const fnSlice = (name: string) => {
  const i = engineActions.indexOf(`export async function ${name}`);
  const rest = engineActions.slice(i);
  const j = rest.indexOf(NL + "export ", 1);
  return j > 0 ? rest.slice(0, j) : rest;
};

// ═══════════ the custody rule ══════════════════════════════════════════════

describe("UAT-WF-HANDOFF-01B — reachable is not held", () => {
  it("step 3 complete and nothing transmitted → step 4 refuses, naming the missing act", () => {
    expect(custodyStateFor(STEP4, [])).toBe("awaiting_transmission");
    expect(custodyRefusal(STEP4, [])).toBe("handoff_not_sent");
  });

  it("transmitted but not received → step 4 still refuses, with the OTHER code", () => {
    expect(custodyStateFor(STEP4, sent)).toBe("awaiting_reception");
    expect(custodyRefusal(STEP4, sent)).toBe("handoff_reception_required");
  });

  it("received → custody is held and the step is workable", () => {
    expect(custodyStateFor(STEP4, received)).toBe("received");
    expect(custodyRefusal(STEP4, received)).toBeNull();
  });

  it("a rejected or cancelled transfer is not custody — it awaits transmission again", () => {
    for (const status of ["REJECTED", "CANCELLED"]) {
      expect(custodyStateFor(STEP4, [{ toStepKey: STEP4, status }])).toBe("awaiting_transmission");
    }
  });

  it("a handoff to ANOTHER step never affects this one", () => {
    const elsewhere = [{ toStepKey: "collections", status: "SENT" }];
    expect(custodyStateFor(STEP4, elsewhere)).toBe("awaiting_transmission");
  });

  it("steps no governed route targets are unaffected — custody is not a concept for them", () => {
    for (const key of ["transport_assignment", "am_dossier_opening", "customs_preparation", "pickup"]) {
      expect(routeTo(key), key).toBeNull();
      expect(custodyStateFor(key, []), key).toBe("not_applicable");
      expect(custodyRefusal(key, []), key).toBeNull();
    }
  });

  it("routes Effitrans has not ruled on keep TODAY's rule exactly", () => {
    // Only the Operations → Transit route requires reception. The other three
    // governed routes are refused while a transfer is outstanding, as before,
    // and never for never having been sent.
    for (const r of HANDOFF_ROUTES) {
      if (r.toStepKey === STEP4) continue;
      expect(r.requiresReception, r.toStepKey).toBe(false);
      expect(custodyRefusal(r.toStepKey, []), r.toStepKey).toBeNull();
      expect(custodyRefusal(r.toStepKey, [{ toStepKey: r.toStepKey, status: "SENT" }]), r.toStepKey)
        .toBe("handoff_reception_required");
    }
  });
});

// ═══════════ enforced at both doors, server-side ═══════════════════════════

describe("UAT-WF-HANDOFF-01B — the server is the boundary", () => {
  it.each(["activateStep", "submitStep"])("%s asks the custody question", (name) => {
    expect(fnSlice(name)).toContain("custodyRefusal(stepKey, st.snapshot!.handoffs)");
  });

  it("activateStep asks BEFORE the pickup gate, which writes audit rows", () => {
    const a = fnSlice("activateStep");
    expect(a.indexOf("custodyRefusal")).toBeLessThan(a.indexOf("PROCESS_GATE_BLOCKED"));
  });

  it("submitStep asks BEFORE evidence — you are not told what is missing from work you have not accepted", () => {
    const s = fnSlice("submitStep");
    expect(s.indexOf("custodyRefusal")).toBeLessThan(s.indexOf("evidence_unauthorized"));
  });

  it("reception UNLOCKS the step — it never starts or completes it", () => {
    const r = fnSlice("receiveHandoff");
    expect(r).toContain('state: "AVAILABLE"');
    expect(r, "reception must never claim the step").not.toContain('state: "ACTIVE"');
    expect(r, "reception must never complete the step").not.toContain('state: "COMPLETED"');
    expect(r).toContain("received_from_user_id");
  });

  it("the custody rule is PURE and writes nothing", () => {
    expect(routesSrc).not.toMatch(/getAdminSupabaseClient|createClient|"use server"|\.update\(|\.insert\(|writeAudit/);
  });
});

// ═══════════ route-scoped authorization ════════════════════════════════════

describe("UAT-WF-HANDOFF-01B — this transfer is Operations', not everyone's", () => {
  const route = routeFor("am_dossier_opening", STEP4)!;
  const perms = (r: string) =>
    TENANT_ROLE_TEMPLATES.find((t) => t.key === r)!.permissions as readonly string[];

  it("Operations Supervisor may send it", () => {
    expect(maySendRoute(route, ["OPS_SUPERVISOR"])).toBe(true);
  });

  it("SYSTEM_ADMIN keeps break-glass", () => {
    expect(maySendRoute(route, ["SYSTEM_ADMIN"])).toBe(true);
  });

  it.each(["ACCOUNT_MANAGER", "CHIEF_OF_TRANSIT", "COORDINATOR", "FINANCE_OFFICER",
           "TRANSPORT_OFFICER", "CUSTOMS_DECLARANT", "BILLING_OFFICER", "COURIER"])(
    "%s may NOT send it, even holding the generic permission",
    (role) => {
      expect(maySendRoute(route, [role])).toBe(false);
    },
  );

  it("the generic permission is NOT removed from anyone — other routes still need it", () => {
    // Scoping the ROUTE, not the capability: these roles keep the permission and
    // keep sending their own handoffs.
    for (const role of ["ACCOUNT_MANAGER", "COORDINATOR", "FINANCE_OFFICER", "BILLING_OFFICER"]) {
      expect(perms(role), role).toContain("process:handoff:send");
    }
    for (const r of HANDOFF_ROUTES) {
      if (r.toStepKey === STEP4) continue;
      expect(maySendRoute(r, ["COORDINATOR"]), r.toStepKey).toBe(true);
      expect(maySendRoute(r, ["BILLING_OFFICER"]), r.toStepKey).toBe(true);
    }
  });

  it("it is enforced inside sendHandoff, so no call site can opt out", () => {
    const s = fnSlice("sendHandoff");
    expect(s).toContain("maySendRoute(routeFor(fromStepKey, toStepKey), c.roles)");
    expect(s).toContain('return fail("not_authorized_sender")');
    // …and before the idempotency lookup, so an unentitled caller learns nothing.
    expect(s.indexOf("maySendRoute")).toBeLessThan(s.indexOf("alreadyOpen"));
  });

  it("both surfaces stop offering the button to someone the server will refuse", () => {
    for (const [name, src] of [["dossier", dossierPage], ["process", processPage]] as const) {
      expect(src, name).toContain('maySendRoute(routeFor("am_dossier_opening", "coordinator_reception")');
    }
  });

  it("reception authority is unchanged — routed receiver, server-side", () => {
    const r = fnSlice("receiveHandoff");
    expect(r).toContain('guard("process:handoff:receive", fileId)');
    expect(r).toContain('return fail("not_eligible_receiver")');
  });
});

// ═══════════ presentation ══════════════════════════════════════════════════

describe("UAT-WF-HANDOFF-01B — the display says where custody stands", () => {
  const stagesFor = (state: string, handoffs: { toStepKey: string; status: string }[] = []) =>
    deriveTransitStages([{ stepKey: STEP4, state: state as never }], handoffs);
  const t1 = (state: string, h: { toStepKey: string; status: string }[] = []) =>
    stagesFor(state, h).find((s) => s.key === "T1")!.status;

  it("AVAILABLE with nothing transmitted → « À transmettre », never « En cours »", () => {
    expect(t1("AVAILABLE")).toBe("awaiting_transmission");
  });

  it("AVAILABLE and transmitted → « En attente de réception »", () => {
    expect(t1("AVAILABLE", sent)).toBe("awaiting_reception");
  });

  it("AVAILABLE and received → « Disponible »", () => {
    expect(t1("AVAILABLE", received)).toBe("available");
  });

  it("ACTIVE → « En cours »; COMPLETED → « Terminé »", () => {
    expect(t1("ACTIVE", received)).toBe("active");
    expect(t1("COMPLETED", received)).toBe("done");
  });

  it("the panel has a label and a tone for every status the derivation can emit", () => {
    const panel = strip(read("components/process/transit-panel.tsx"));
    for (const status of ["done", "active", "available", "awaiting_transmission",
                          "awaiting_reception", "blocked", "pending"]) {
      expect(panel, status).toContain(`${status}:`);
    }
    expect(panel).toContain('"À transmettre au Transit"');
    expect(panel).toContain('"En attente de réception"');
    expect(panel).toContain('"Disponible"');
  });

  it("the dossier page badge reads the SAME custody facts as the guard", () => {
    expect(processPage).toContain("custodyStateFor(s.stepKey, handoffViews)");
    expect(processPage).toContain('"À transmettre"');
    expect(processPage).toContain('"En attente de réception"');
  });

  it("the roll-up is fed real handoff rows, not an assumption", () => {
    const t = strip(read("lib/process/engine/transit-actions.ts"));
    expect(t).toContain("deriveTransitStages(");
    expect(t).toContain("toStepKey: h.to_step_key, status: h.status");
  });
});

// ═══════════ nothing else moved ════════════════════════════════════════════

describe("UAT-WF-HANDOFF-01B — parallelism, ownership and the graph are untouched", () => {
  it("step 14 / T9 still opens from step 3 and never waits on Transit custody", () => {
    expect(getStep("transport_assignment")!.prerequisites).toEqual(["am_dossier_opening"]);
    expect(routeTo("transport_assignment")).toBeNull();
    const stages = deriveTransitStages(
      [{ stepKey: "transport_assignment", state: "AVAILABLE" as never }],
      [],
    );
    // Open, unclaimed, no custody concept: available — not blocked by the
    // customs branch, and not falsely « En cours » either.
    expect(stages.find((s) => s.key === "T9")!.status).toBe("available");
  });

  it("the canonical 26-step dependency graph is unchanged", () => {
    expect(getStep(STEP4)!.prerequisites).toEqual(["am_dossier_opening"]);
    expect(getStep("am_dossier_opening")!.prerequisites).toEqual(["operations_intake"]);
    expect(getStep("transit_declarant_assignment")!.prerequisites).toEqual([STEP4]);
  });

  it("neither transmission nor reception touches ownership or the dossier status", () => {
    const send = fnSlice("sendHandoff");
    const recv = fnSlice("receiveHandoff");
    for (const [name, src] of [["send", send], ["receive", recv]] as const) {
      expect(src, name).not.toContain("account_manager_id");
      expect(src, name).not.toContain("owner_user_id:");
      expect(src, name).not.toContain('from("operational_file")');
    }
  });

  it("no migration was added for this slice", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe("20260929000001_ops_supervisor_file_update.sql");
  });

  it("the UAT dossier is named nowhere in the slice", () => {
    for (const src of [routesSrc, transitSrc, processPage, dossierPage, engineActions]) {
      expect(src).not.toMatch(/EFT-IMP-2026-0001\d/);
    }
  });
});
