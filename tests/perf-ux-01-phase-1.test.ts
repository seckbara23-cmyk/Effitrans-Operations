/**
 * PERF-UX-01 Phase 1 — faster by construction, and provably nothing else.
 * ---------------------------------------------------------------------------
 * 1. `loadBatch` runs independent loaders together, never more than its limit
 *    at once, and fails the way the sequential code did.
 * 2. The dossier page: the RLS dossier gate still runs first and alone; the
 *    batch reads only the dossier and the permissions; every loader keeps the
 *    gate it had; the four dependent reads wait for what they depend on.
 * 3. `getCurrentUser` issues the role read beside the profile read, and still
 *    decides everything on the profile first.
 * 4. `resolveActorNames` takes the tenant from `getCurrentUser()`.
 * 5. EVERY removed `router.refresh()` is backed by proof that each success
 *    return of each action behind it revalidates the dossier route — and every
 *    kept one says why it is kept. A later edit that breaks the proof fails here.
 * 6. Phase 1B: the success paths that write nothing (an empty transport patch,
 *    re-assigning the same driver, unassigning nobody) revalidate too, and still
 *    write, audit and notify nothing — so TransportPanel and DriverAssign no
 *    longer refresh at all.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBatch } from "@/lib/perf/batch";
import { formatPerfLine } from "@/lib/perf/trace";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, "utf8").replace(/\r\n/g, "\n");
/** Source without comments: prose may mention a call, code may not. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/ .*$/gm, "");

/** The text of `export async function name(` up to the next top-level export. */
function exported(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`no export ${name}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

/** From an opening `{` at `open`, the text through its matching `}`. */
function block(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("unbalanced");
}

/** Every success return in `body`, with the two non-blank lines just above it. */
function successReturns(body: string): { line: string; above: string; above2: string }[] {
  const lines = body.split("\n");
  const out: { line: string; above: string; above2: string }[] = [];
  lines.forEach((line, i) => {
    if (!/return \{ ok: true/.test(line)) return;
    const prior = lines.slice(0, i).map((l) => l.trim()).filter(Boolean);
    out.push({ line: line.trim(), above: prior[prior.length - 1] ?? "", above2: prior[prior.length - 2] ?? "" });
  });
  return out;
}

/** Every .tsx file under app/ and components/ whose source matches `re`. */
function hostsOf(re: RegExp): string[] {
  const hosts: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name) && re.test(read(p))) hosts.push(p);
    }
  };
  walk("app");
  walk("components");
  return hosts.sort();
}

/** The names a file imports from `module`, in source order. */
function importedFrom(src: string, module: string): string[] {
  const end = src.indexOf(`} from "${module}"`);
  if (end < 0) throw new Error(`no import from ${module}`);
  return src
    .slice(src.lastIndexOf("import {", end), end)
    .replace(/import \{/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ===========================================================================
describe("loadBatch", () => {
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("returns every result under its own name", async () => {
    const out = await loadBatch("t", 3, {
      a: async () => 1,
      b: async () => "two",
      c: async () => ({ three: 3 }),
    });
    expect(out).toEqual({ a: 1, b: "two", c: { three: 3 } });
  });

  it("runs loaders together, never more than the limit at once", async () => {
    let open = 0;
    let most = 0;
    const loader = async () => {
      open++;
      most = Math.max(most, open);
      await tick(10);
      open--;
      return true;
    };
    const started = Date.now();
    await loadBatch("t", 3, { a: loader, b: loader, c: loader, d: loader, e: loader, f: loader });
    expect(most).toBe(3);
    // Six 10 ms loaders, three at a time: two rounds, not six.
    expect(Date.now() - started).toBeLessThan(55);
  });

  it("rejects with the first failure and starts nothing after it", async () => {
    const started: string[] = [];
    const boom = new Error("refused");
    const run = (name: string, fail = false) => async () => {
      started.push(name);
      await tick(5);
      if (fail) throw boom;
      return name;
    };
    await expect(
      loadBatch("t", 1, { a: run("a"), b: run("b", true), c: run("c"), d: run("d") }),
    ).rejects.toBe(boom);
    expect(started).toEqual(["a", "b"]);
  });

  it("a limit wider than the batch, or below one, is clamped", async () => {
    expect(await loadBatch("t", 50, { a: async () => 1 })).toEqual({ a: 1 });
    expect(await loadBatch("t", 0, { a: async () => 1, b: async () => 2 })).toEqual({ a: 1, b: 2 });
  });
});

// ===========================================================================
describe("the dossier page — order, independence and gates", () => {
  const page = code("app/files/[id]/page.tsx");
  const render = page.slice(page.indexOf("async function renderFileDetailPage("), page.indexOf("const cards = (section"));
  const dossierAt = render.indexOf('loadBatch("dossier", 6, {');
  const dossierBatch = block(render, render.indexOf("{", dossierAt));
  const dependentAt = render.indexOf('loadBatch("dependent", 4, {');
  const dependentBatch = block(render, render.indexOf("{", dependentAt));

  it("the permission check, then the RLS dossier gate, come before any section read", () => {
    const readCheck = render.indexOf('if (!hasPermission(permissions, "file:read"))');
    const gate = render.indexOf('await perfStage("file", () => getFile(params.id))');
    const notFound = render.indexOf("if (!file) {");
    expect(readCheck).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(readCheck);
    expect(notFound).toBeGreaterThan(gate);
    expect(dossierAt).toBeGreaterThan(notFound);
  });

  it("the only statement-level awaits are identity, permissions, the gate and the two batches", () => {
    const outside = render.replace(dossierBatch, "{}").replace(dependentBatch, "{}");
    const awaits = outside.match(/\bawait\b[^;]*/g) ?? [];
    expect(awaits.map((a) => a.replace(/\s+/g, " "))).toEqual([
      "await requireUser()",
      "await getEffectivePermissions(user.id)",
      'await perfStage("file", () => getFile(params.id))',
      'await loadBatch("dossier", 6, {})',
      'await loadBatch("dependent", 4, {})',
    ]);
  });

  it("no loader in the first batch reads another loader's result", () => {
    for (const result of ["customsRecord", "transportRecord", "canonical", "lifecycle", "documents.", "intakeState", "workView"]) {
      // The loaders may NAME a result as their own key, never read one.
      const readsIt = new RegExp(`[^\\w]${result.replace(".", "\\.")}(\\.|\\s*\\?|\\s*&&|\\s*!==|\\s*\\))`).test(
        dossierBatch.replace(new RegExp(`\\n\\s*${result.replace(".", "")}:`, "g"), "\n"),
      );
      expect(readsIt, result).toBe(false);
    }
  });

  it("the dependent batch holds exactly the four reads that need a loaded value, after the canonical check", () => {
    const keys = [...dependentBatch.matchAll(/\n\s{4}(\w+): (?:async )?\(\) =>/g)].map((m) => m[1]);
    expect(keys).toEqual(["customsAwaitingRevalidation", "missionTracking", "assignableDrivers", "sla"]);
    expect(dependentAt).toBeGreaterThan(render.indexOf("if (!canonical) return null;"));
  });

  it.each([
    ["clients", 'hasPermission(permissions, "client:read")'],
    ["parentOptions", "canUpdate ? await listParentCandidates(file.id) : []"],
    ["fleetOptions", 'hasPermission(permissions, "transport:assign")'],
    ["providerOptions", 'hasPermission(permissions, "transport:assign")'],
    ["assignableStaff", "canAssign || canAssignCommercial ? await listAssignableStaff() : []"],
    ["geo", 'canUpdate && hasPermission(permissions, "transport:read")'],
    ["tasks", "canReadTasks ? await listTasks({ fileId: file.id }) : []"],
    ["eligible", "canUpdateTasks"],
    ["documents", "canReadDocs ? await listDocuments(file.id) : []"],
    ["docTypes", "canReadDocs ? await listDocumentTypes() : []"],
    ["missingDocs", "canReadDocs ? await getMissingRequiredDocuments(file.id, file.type) : []"],
    ["customsRecord", "canReadCustoms ? await getCustomsRecord(file.id) : null"],
    ["missingCustomsDocs", "canReadCustoms ? await getMissingCustomsDocuments(file.id) : []"],
    ["transportRecord", "canReadTransport ? await getTransportRecord(file.id) : null"],
    ["carriage", "canReadTransport && file.shipment"],
    ["trackingEvents", "trackingOn && canReadTracking ? await getTrackingTimeline(file.id) : []"],
    ["finance", "canReadFinance ? await getFinanceForFile(file.id) : null"],
    ["communications", "canReadComms ? await listCommunicationsForFile(file.id) : []"],
    ["artifactItems", "canReadDocs ? await getArtifactPanel(file.id) : []"],
    ["customsControlVerdicts", "canReadCustoms"],
  ])("loader %s keeps its gate", (name, gate) => {
    const at = dossierBatch.indexOf(`\n    ${name}: `);
    expect(at, name).toBeGreaterThan(-1);
    const next = dossierBatch.slice(at + 1).search(/\n {4}\w+: /);
    const entry = dossierBatch.slice(at, next < 0 ? undefined : at + 1 + next);
    expect(entry.replace(/\s+/g, " ")).toContain(gate);
  });

  it("the gates are derived from the viewer's permissions exactly as before", () => {
    for (const line of [
      'const canUpdate = hasPermission(permissions, "file:update");',
      'const canAssign = hasPermission(permissions, "file:assign");',
      'const canAssignCommercial = hasPermission(permissions, "file:assign:commercial");',
      'const canReadTasks = hasPermission(permissions, "task:read");',
      'const canUpdateTasks = hasPermission(permissions, "task:update");',
      'const canReadDocs = hasPermission(permissions, "document:read");',
      'const canReadCustoms = hasPermission(permissions, "customs:read");',
      'const canReadTransport = hasPermission(permissions, "transport:read");',
      'const canReadTracking = hasPermission(permissions, "tracking:read");',
      'const canAssignDriver = hasPermission(permissions, "transport:assign");',
      'const canReadFinance = hasPermission(permissions, "finance:read");',
      'const canReadComms = hasPermission(permissions, "communication:read");',
    ]) {
      expect(render).toContain(line);
    }
  });

  it("the dependent reads keep their gates", () => {
    const flat = dependentBatch.replace(/\s+/g, " ");
    expect(flat).toContain("canReadCustoms && customsRecord !== null && customsRecord.reviewedAt === null");
    expect(flat).toContain("transportRecord ? await getMissionTracking(transportRecord.id) : null");
    expect(flat).toContain("canAssignDriver && transportRecord ? await listAssignableDrivers() : []");
    expect(flat).toContain("getDossierStage(file.id, lifecycle.currentDepartment, lifecycle.currentStep).catch(() => null)");
  });

  it("every stage name the page logs is a valid trace name", () => {
    const names = [
      ...[...dossierBatch.matchAll(/\n\s{4}(\w+): /g)].map((m) => `dossier.${m[1]}`),
      ...[...dependentBatch.matchAll(/\n\s{4}(\w+): /g)].map((m) => `dependent.${m[1]}`),
      "file",
      "dossier",
      "dependent",
    ];
    expect(names.length).toBeGreaterThan(30);
    const line = formatPerfLine({
      label: "files/[id]", kind: "document", region: "dub1", totalMs: 1, outcome: "ok",
      calls: 0, callMs: 0, maxInFlight: 0, stages: names.map((name) => ({ name, ms: 1 })),
    });
    expect(line).not.toContain("invalid");
  });
});

// ===========================================================================
describe("getCurrentUser — the role read no longer waits for the profile", () => {
  const src = code("lib/auth/current-user.ts");
  const fn = src.slice(src.indexOf("export const getCurrentUser"), src.indexOf("export const getStaffTenantBlockReason"));

  it("issues the role request before awaiting the profile, keyed on the authenticated id", () => {
    const roles = fn.indexOf("const rolesRequest = Promise.resolve(");
    const profile = fn.indexOf('.from("app_user")');
    expect(roles).toBeGreaterThan(fn.indexOf("await supabase.auth.getUser()"));
    expect(roles).toBeLessThan(profile);
    expect(fn.slice(roles, profile)).toContain('.eq("user_id", user.id)');
    expect(fn).toContain("rolesRequest.catch(() => undefined);");
  });

  it("every refusal is decided on the profile before any role is used", () => {
    const rolesUsed = fn.indexOf("await Promise.all([rolesRequest, seen])");
    for (const check of [
      "if (!profile) return null;",
      'if (profile.status !== "active") return null;',
      "if (tenantBlockReason(org.lifecycle_status, org.trial_ends_at, Date.now()) !== null) {",
    ]) {
      expect(fn.indexOf(check), check).toBeGreaterThan(-1);
      expect(fn.indexOf(check), check).toBeLessThan(rolesUsed);
    }
    expect(fn.match(/\.from\("user_role"\)/g)).toHaveLength(1);
    expect(fn.match(/\.from\("app_user"\)/g)).toHaveLength(1);
  });
});

describe("resolveActorNames — one identity, the authoritative one", () => {
  const src = code("lib/workflow/events/readers.ts");
  const fn = exported(src, "resolveActorNames");

  it("reads the tenant from getCurrentUser and never re-verifies the session itself", () => {
    expect(fn).not.toContain("auth.getUser");
    expect(fn).toContain("const me = await getCurrentUser();");
    expect(fn).toContain("if (!me) return out;");
    expect(fn).toContain('.eq("tenant_id", me.tenantId)');
    // Still a tenant-scoped admin read of names only.
    expect(fn).toContain('.select("id, name")');
    expect(fn.match(/\.from\("app_user"\)/g)).toHaveLength(1);
  });
});

// ===========================================================================
describe("removed router.refresh() — each one proven", () => {
  const engine = code("lib/process/engine/actions.ts");
  const customs = code("lib/customs/actions.ts");
  const files = code("lib/files/actions.ts");
  const transport = code("lib/transport/actions.ts");

  const revalidateHelper = (src: string) => block(src, src.indexOf("{", src.indexOf("function revalidate(fileId: string)")));

  it("the helpers revalidate the dossier route", () => {
    expect(revalidateHelper(engine)).toContain("revalidatePath(`/files/${fileId}`);");
    expect(revalidateHelper(engine)).toContain("revalidatePath(`/files/${fileId}/process`);");
    expect(revalidateHelper(customs)).toContain("revalidatePath(`/files/${fileId}`);");
    expect(revalidateHelper(transport)).toContain("revalidatePath(`/files/${fileId}`);");
  });

  it("StepActions: both engine actions revalidate before every success return", () => {
    expect(code("components/process/step-actions.tsx")).not.toMatch(/router|useRouter/);
    for (const name of ["activateStep", "submitStep"]) {
      const returns = successReturns(exported(engine, name));
      expect(returns.length, name).toBeGreaterThan(0);
      for (const r of returns) expect(r.above, `${name}: ${r.line}`).toBe("revalidate(fileId);");
    }
    const queues = code("lib/process/queues/actions.ts");
    expect(exported(queues, "queueStartStep")).toContain("await activateStep(fileId, stepKey)");
    expect(exported(queues, "queueSubmitStep")).toContain("await submitStep(fileId, stepKey)");
  });

  it("StepActions renders only on the two dossier routes those actions revalidate", () => {
    expect(hostsOf(/<(StepActions|ContextualStepCard|DossierWorkSummary)\b/)).toEqual([
      "app/files/[id]/page.tsx",
      "app/files/[id]/process/page.tsx",
      "components/process/contextual-step-card.tsx",
      "components/process/dossier-work-summary.tsx",
    ]);
  });

  it("CustomsPanel: every action it calls revalidates /files/<id> before every success return", () => {
    const panel = code("components/customs/customs-panel.tsx");
    expect(panel).not.toMatch(/router|useRouter/);
    const imported = importedFrom(panel, "@/lib/customs/actions");
    expect(imported.length).toBe(11);
    for (const name of imported) {
      const target = name === "releaseCustoms" ? "recordCustomsRelease" : name;
      if (name === "releaseCustoms") expect(exported(customs, name)).toContain("return recordCustomsRelease(id, baeReference);");
      const returns = successReturns(exported(customs, target));
      expect(returns.length, target).toBeGreaterThan(0);
      for (const r of returns) {
        expect(["revalidate(fileId);", "revalidate(rec.file_id);"], `${target}: ${r.line}`).toContain(r.above);
      }
    }
    expect([...read("app/files/[id]/page.tsx").matchAll(/<CustomsPanel\b/g)]).toHaveLength(1);
  });

  it("FileForm: the edit save no longer refreshes, and updateFile revalidates /files/<id> first", () => {
    const form = code("components/files/file-form.tsx");
    expect(form).toContain("run(() => updateFile(fileId, payload()));");
    expect(form).not.toContain("router.refresh");
    // The create path still navigates to the new dossier.
    expect(form).toContain('run(() => createFile(payload()), (r) => router.push(r.id ? `/files/${r.id}` : "/files"));');
    const returns = successReturns(exported(files, "updateFile"));
    expect(returns).toHaveLength(1);
    expect(returns[0].above).toBe("revalidatePath(`/files/${id}`);");
  });

  it("TransportPanel: no refresh at all — every action it calls revalidates /files/<id> before every success return", () => {
    const panel = code("components/transport/transport-panel.tsx");
    expect(panel).not.toMatch(/router|useRouter/);
    expect(panel).toContain("function run(fn: () => Promise<ActionResult>) {");
    const imported = importedFrom(panel, "@/lib/transport/actions");
    expect([...imported].sort()).toEqual([
      "assignTransport",
      "changeTransportStatus",
      "createTransport",
      "deleteTransport",
      "requestTransport",
      "updateTransport",
    ]);
    const flat = panel.replace(/\s+/g, " ");
    for (const name of imported) {
      // Every call goes through run(), which has no refresh of its own…
      const calls = flat.match(new RegExp(`\\b${name}\\(`, "g")) ?? [];
      expect(calls.length, name).toBeGreaterThan(0);
      expect(flat.split(`run(() => ${name}(`).length - 1, name).toBe(calls.length);
      // …and every success the action can return has just revalidated the dossier.
      const returns = successReturns(exported(transport, name));
      expect(returns.length, name).toBeGreaterThan(0);
      for (const r of returns) expect(["revalidate(fileId);", "revalidate(rec.file_id);"], `${name}: ${r.line}`).toContain(r.above);
    }
  });

  it("Phase 1B — updateTransport/assignTransport: the empty-patch success revalidates, and still writes nothing", () => {
    for (const name of ["updateTransport", "assignTransport"]) {
      const fn = exported(transport, name);
      const at = fn.indexOf("if (isEmptyPatch(patch)) {");
      expect(at, name).toBeGreaterThan(-1);
      // The branch is exactly: revalidate this dossier, report success.
      expect(block(fn, fn.indexOf("{", at)).replace(/\s+/g, " "), name).toBe("{ revalidate(rec.file_id); return { ok: true, id }; }");
      // After every gate; before the compare-and-set write and the audit.
      expect(at, name).toBeGreaterThan(fn.indexOf("isFileVisible(user.id, user.tenantId, rec.file_id)"));
      expect(at, name).toBeLessThan(fn.indexOf("casUpdate("));
      expect(at, name).toBeLessThan(fn.indexOf("writeAudit("));
    }
    // assignTransport: before the assigner is stamped and the provider name is read.
    const assign = exported(transport, "assignTransport");
    const at = assign.indexOf("if (isEmptyPatch(patch)) {");
    expect(at).toBeLessThan(assign.indexOf("patch.assigned_by = user.id;"));
    expect(at).toBeLessThan(assign.indexOf('.from("transport_provider")'));
  });

  it("DriverAssign: no refresh — both driver actions revalidate /files/<id> before every success return, the no-ops included", () => {
    const panel = code("components/transport/driver-assign.tsx");
    expect(panel).not.toMatch(/router|useRouter/);
    expect(importedFrom(panel, "@/lib/transport/driver-actions")).toEqual(["assignDriverUser", "unassignDriverUser"]);
    const flat = panel.replace(/\s+/g, " ");
    expect(flat.match(/\bassignDriverUser\(/g)).toHaveLength(1);
    expect(flat.match(/\bunassignDriverUser\(/g)).toHaveLength(1);
    expect(flat).toContain("run(() => assignDriverUser(transportId, selected))");
    expect(flat).toContain("run(() => unassignDriverUser(transportId))");

    const drivers = code("lib/transport/driver-actions.ts");
    for (const name of ["assignDriverUser", "unassignDriverUser"]) {
      const returns = successReturns(exported(drivers, name));
      // The no-op success and the success after the write — nothing else.
      expect(returns, name).toHaveLength(2);
      for (const r of returns) {
        expect([r.above2, r.above], `${name}: ${r.line}`).toEqual(["revalidatePath(`/files/${rec.file_id}`);", 'revalidatePath("/transport");']);
      }
    }
  });

  it("Phase 1B — the driver no-ops revalidate, and still write, audit and notify nothing", () => {
    const drivers = code("lib/transport/driver-actions.ts");
    const noop = '{ revalidatePath(`/files/${rec.file_id}`); revalidatePath("/transport"); return { ok: true, id: transportId }; }';

    const assign = exported(drivers, "assignDriverUser");
    const same = assign.indexOf("if (rec.driver_user_id === driverUserId) {");
    expect(same).toBeGreaterThan(assign.indexOf("isTenantDriver(supabase, user.tenantId, driverUserId)"));
    expect(block(assign, assign.indexOf("{", same)).replace(/\s+/g, " ")).toBe(noop);
    for (const later of [".update(", "writeAudit(", "createNotification("]) expect(same, later).toBeLessThan(assign.indexOf(later));

    const unassign = exported(drivers, "unassignDriverUser");
    const nobody = unassign.indexOf("if (!rec.driver_user_id) {");
    expect(nobody).toBeGreaterThan(unassign.indexOf("isFileVisible(user.id, user.tenantId, rec.file_id)"));
    expect(block(unassign, unassign.indexOf("{", nobody)).replace(/\s+/g, " ")).toBe(noop);
    for (const later of [".update(", "writeAudit("]) expect(nobody, later).toBeLessThan(unassign.indexOf(later));
  });

  it("TransportPanel and DriverAssign render only on /files/[id], each with that dossier's own transport record", () => {
    expect(hostsOf(/<(TransportPanel|DriverAssign)\b/)).toEqual(["app/files/[id]/page.tsx"]);
    const page = code("app/files/[id]/page.tsx").replace(/\s+/g, " ");
    expect(page).toContain("<TransportPanel fileId={file.id} record={transportRecord}");
    expect(page).toContain("<DriverAssign transportId={transportRecord.id}");
    // The record is read by this dossier's id, so the rec.file_id an action
    // loads for it IS the page the action was called from.
    const reader = exported(code("lib/transport/service.ts"), "getTransportRecord");
    expect(reader).toContain('.eq("tenant_id", user.tenantId)');
    expect(reader).toContain('.eq("file_id", fileId)');
  });

  it("TransitPanel keeps its refresh: the proof does not hold for it", () => {
    // The transit actions revalidate no path of their own; the panel lives on
    // /files/<id>/process and its refresh is the only re-render some of them get.
    expect(code("lib/process/engine/transit-actions.ts")).not.toContain("revalidatePath(");
    expect(code("components/process/transit-panel.tsx")).toContain("router.refresh();");
  });

  it("the framework link every removal relies on: a revalidating action returns the re-rendered page itself", () => {
    const next = (p: string) => read(`node_modules/next/dist/${p}`);
    // revalidatePath marks the action's request as having revalidated…
    expect(next("server/web/spec-extension/revalidate.js")).toContain("store.pathWasRevalidated = true;");
    // …which is the condition under which a fetch action's response carries the rendered page…
    expect(next("server/app-render/action-handler.js")).toContain(
      "skipFlight: !staticGenerationStore.pathWasRevalidated || actionWasForwarded",
    );
    // …and the client router installs that page as its new tree, as a refresh would.
    const reducer = next("client/components/router-reducer/reducers/server-action-reducer.js");
    expect(reducer).toContain("mutable.cache = cache;");
    expect(reducer).toContain("mutable.prefetchCache = new Map();");
  });

  it("pending still disables every control those panels draw while an action runs", () => {
    for (const file of [
      "components/process/step-actions.tsx",
      "components/customs/customs-panel.tsx",
      "components/files/file-form.tsx",
      "components/transport/transport-panel.tsx",
      "components/transport/driver-assign.tsx",
    ]) {
      const src = code(file);
      expect(src, file).toMatch(/useTransition\(\)/);
      expect(src, file).toMatch(/disabled=\{pending/);
    }
  });

  it("Phase 1B — every button in the two transport panels is disabled while the one transition is pending", () => {
    for (const file of ["components/transport/transport-panel.tsx", "components/transport/driver-assign.tsx"]) {
      const src = code(file);
      const buttons = src.split("<button").slice(1).map((b) => b.slice(0, b.indexOf("</button>")));
      expect(buttons.length, file).toBeGreaterThan(0);
      for (const b of buttons) expect(b, `${file}: <button${b.slice(0, 80)}`).toMatch(/disabled=\{pending\b/);
      // Every action runs inside the single transition that owns `pending`.
      expect(src.match(/startTransition\(/g), file).toHaveLength(1);
    }
  });
});
