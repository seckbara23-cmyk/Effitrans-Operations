/**
 * The claimant label on the process page — UAT-00011.
 * ---------------------------------------------------------------------------
 * THE DEFECT. On EFT-IMP-2026-00011 step 3, Account Manager Demo held the step
 * — `assigned_user_id` equalled their own user id — and the page told them
 * « En cours : une autre personne ».
 *
 * The lookup selected `app_user.full_name`. That column does not exist; the
 * column is `name`. PostgREST refused the request, the result was cast with
 * `as { id; full_name; email }[]` so the typed client could not object, the
 * error was never read, and the empty map fell through a `?? "une autre
 * personne"` for EVERY claimed step including the reader's own.
 *
 * Three failures stacked: a wrong column, a cast that hid it, and a swallowed
 * error. The column and the cast are now caught at build time — reintroducing
 * `full_name` without a cast is a TypeScript error naming the column. What
 * cannot be caught by the compiler is the third one: what the page SAYS when
 * the lookup genuinely fails. That is what these tests hold.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assigneeLabelMap, resolveAssigneeLabel, type AssigneeRow } from "@/lib/process/assignee-label";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
/** Source with comments stripped — assertions about code must not match prose. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PAGE = "app/files/[id]/process/page.tsx";
const LOADER = "lib/process/contextual/facts.ts";
const LOADER_SRC = read(LOADER);
const AM = "87706794-e98f-4448-90d9-1f3ca42b86c7"; // the real claimant on 00011

const rows = (...r: AssigneeRow[]) => r;

describe("claimant label — the name resolves", () => {
  it("01 — a claimant with a name is shown by name", () => {
    // The exact 00011 shape: app_user.name = "Account Manager Demo".
    const names = assigneeLabelMap(rows({ id: AM, name: "Account Manager Demo", email: "account.manager.demo@effitrans.sn" }));
    expect(resolveAssigneeLabel({ assignedUserId: AM, names, lookupFailed: false }))
      .toBe("Account Manager Demo");
  });

  it("02 — the reader's OWN claim is named, not reported as somebody else", () => {
    // The whole complaint. Nothing about the label depends on who is reading:
    // a resolved claim renders the claimant, and on 00011 that reader IS them.
    const names = assigneeLabelMap(rows({ id: AM, name: "Account Manager Demo", email: "x@y.z" }));
    const label = resolveAssigneeLabel({ assignedUserId: AM, names, lookupFailed: false });
    expect(label).not.toBe("une autre personne");
    expect(label).toBe("Account Manager Demo");
  });

  it("03 — nothing claimed renders no label at all", () => {
    expect(resolveAssigneeLabel({ assignedUserId: null, names: new Map(), lookupFailed: false })).toBeNull();
  });
});

describe("claimant label — the email fallback", () => {
  it("04 — a null name falls back to the email", () => {
    const names = assigneeLabelMap(rows({ id: "u1", name: null, email: "courier.demo@effitrans.sn" }));
    expect(names.get("u1")).toBe("courier.demo@effitrans.sn");
    expect(resolveAssigneeLabel({ assignedUserId: "u1", names, lookupFailed: false }))
      .toBe("courier.demo@effitrans.sn");
  });

  it("05 — an empty or whitespace name is not a name either", () => {
    // `name || email` already covers "", but not "   " — which would render an
    // empty « En cours : » and read as a broken page rather than as a person.
    for (const blank of ["", "   ", "\t"]) {
      const names = assigneeLabelMap(rows({ id: "u2", name: blank, email: "fallback@effitrans.sn" }));
      expect(names.get("u2"), JSON.stringify(blank)).toBe("fallback@effitrans.sn");
    }
  });

  it("06 — a name that exists is trimmed, not padded into the sentence", () => {
    const names = assigneeLabelMap(rows({ id: "u3", name: "  Chef Transit Demo  ", email: "x@y.z" }));
    expect(names.get("u3")).toBe("Chef Transit Demo");
  });
});

describe("claimant label — a failed lookup is not disguised as another person", () => {
  it("07 — lookup FAILED renders a distinct label, never « une autre personne »", () => {
    // The regression proper. Before the fix these two states were identical:
    // both produced an empty map, and both said somebody else held the step.
    const label = resolveAssigneeLabel({ assignedUserId: AM, names: new Map(), lookupFailed: true });
    expect(label).not.toBe("une autre personne");
    expect(label).toBe("nom indisponible");
  });

  it("08 — lookup SUCCEEDED but the row is absent still means another person", () => {
    // Not the same fact, and deliberately not the same sentence: the query
    // worked, so the claimant is real and simply not nameable to this reader.
    expect(resolveAssigneeLabel({ assignedUserId: AM, names: new Map(), lookupFailed: false }))
      .toBe("une autre personne");
  });

  it("09 — a failure never turns a resolved name into a fallback", () => {
    // Partial data must survive: if some rows came back before the failure flag
    // was raised, the names we DO have are still the truth about those steps.
    const names = assigneeLabelMap(rows({ id: AM, name: "Account Manager Demo", email: "x@y.z" }));
    expect(resolveAssigneeLabel({ assignedUserId: AM, names, lookupFailed: true }))
      .toBe("Account Manager Demo");
  });
});

describe("claimant label — the page wiring", () => {
  // Slice 5 (GAINDE-04) — the lookup moved OFF the page and into the one
  // loader every step surface reads. The three properties below are unchanged
  // and are now asserted where the query actually lives; asserting them on the
  // page would only prove that the page no longer does it.
  it("10 — the lookup selects the column that exists, with no cast to hide it", () => {
    expect(LOADER_SRC).toContain('.select("id, name, email")');
    // Read CODE, not prose: the block explains in its own comment which column
    // does not exist, so a raw text search matches the explanation and would
    // have to be relaxed — leaving it unable to catch the real thing.
    expect(code(LOADER)).not.toContain("full_name");
    expect(LOADER_SRC).not.toMatch(/as \{ id: string; [a-z_]*name: string \| null; email: string \}\[\]/);
  });

  it("11 — the query error is read, not swallowed", () => {
    expect(LOADER_SRC).toMatch(/if \(res\.error\)/);
    expect(LOADER_SRC).toContain("failed: true");
    // …and the failure reaches the label decision rather than dying in a log.
    expect(LOADER_SRC).toMatch(/lookupFailed: failed/);
  });

  it("12 — the label comes from the shared resolver, not a second inline rule", () => {
    expect(LOADER_SRC).toContain("resolveAssigneeLabel({");
    // No inline `?? "une autre personne"` survives anywhere to disagree with it.
    for (const p of [LOADER, PAGE]) {
      expect(read(p), p).not.toMatch(/\?\?\s*"une autre personne"/);
    }
  });

  it("13 — and the page reads the resolved label instead of resolving one", () => {
    // The regression that matters for this surface: a second inline rule
    // appearing beside the loader's.
    const page = code(PAGE);
    expect(page).toContain("loadContextualStepFacts(");
    expect(page).not.toContain("assigneeLabelMap(");
    expect(page).not.toContain("resolveAssigneeLabel(");
  });

  it("13 — the resolver decides nothing but the label", () => {
    // Guard against this display helper drifting into authority. Claim
    // semantics stay in the engine and in evaluateStepAction.
    const src = read("lib/process/assignee-label.ts");
    for (const forbidden of ["permission", "canSubmit", "canStart", "assertPermission", "supabase", "from("]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });
});
