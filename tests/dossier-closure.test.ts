/**
 * Dossier closure — navigation and the server-side guard.
 *
 * Two defects, one small and one serious:
 *
 *   * the archive stage's "Ouvrir →" resolved to `/files/{id}` — the page the
 *     operator was already on — because `ANCHOR.archive` was an empty string;
 *
 *   * `DELIVERED → CLOSED` checked ONLY customs. The lifecycle DISPLAYED an
 *     `await_payment` gate, but nothing enforced it, so a dossier with an
 *     unpaid invoice — or a payment recorded but never verified — closed
 *     without complaint. A displayed gate the server does not enforce is a
 *     suggestion, not a control.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  closureBlockers,
  canCloseDossier,
  closureRefusalFr,
  CLOSURE_BLOCKER_LABEL_FR,
  type ClosureFactsInput,
} from "@/lib/files/closure";
import { t } from "@/lib/i18n";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** EFT-IMP-2026-00003 as validated in production: closable. */
const READY: ClosureFactsInput = {
  fileType: "IMP",
  customs: { status: "RELEASED", required: true },
  transport: { status: "POD_RECEIVED" },
  invoices: [{ status: "PAID", balance: 0 }],
  payments: [{ verified: true }],
};
const with_ = (o: Partial<ClosureFactsInput>): ClosureFactsInput => ({ ...READY, ...o });

// ---------------------------------------------------------------------------
describe("closure requirements", () => {
  it("a delivered, settled, verified dossier CAN close", () => {
    expect(closureBlockers(READY)).toEqual([]);
    expect(canCloseDossier(READY)).toBe(true);
  });

  it("an unpaid invoice BLOCKS closure", () => {
    expect(closureBlockers(with_({ invoices: [{ status: "ISSUED", balance: 750_000 }] })))
      .toContain("invoice_outstanding");
  });

  it("a partially paid invoice BLOCKS closure", () => {
    expect(closureBlockers(with_({ invoices: [{ status: "PARTIALLY_PAID", balance: 250_000 }] })))
      .toContain("invoice_outstanding");
  });

  it("a DRAFT invoice BLOCKS closure even at zero balance", () => {
    expect(closureBlockers(with_({ invoices: [{ status: "DRAFT", balance: 0 }] })))
      .toContain("invoice_outstanding");
  });

  it("an UNVERIFIED payment BLOCKS closure — maker-checker is part of settlement", () => {
    // Balance is zero, so money arrived; but nobody checked it.
    expect(closureBlockers(with_({ payments: [{ verified: false }] })))
      .toContain("payment_unverified");
  });

  it("one unverified payment among several still blocks", () => {
    expect(closureBlockers(with_({ payments: [{ verified: true }, { verified: false }] })))
      .toContain("payment_unverified");
  });

  it("required customs not released BLOCKS closure", () => {
    for (const status of ["NOT_STARTED", "DECLARED", "INSPECTION"]) {
      expect(closureBlockers(with_({ customs: { status, required: true } })), status)
        .toContain("customs_not_released");
    }
  });

  it("waived or cancelled customs does NOT block", () => {
    expect(closureBlockers(with_({ customs: { status: "DECLARED", required: false } }))).toEqual([]);
    expect(closureBlockers(with_({ customs: { status: "CANCELLED", required: true } }))).toEqual([]);
  });

  it("customs is only checked for IMP/EXP", () => {
    expect(closureBlockers(with_({ fileType: "HND", customs: { status: "DECLARED", required: true } })))
      .toEqual([]);
  });

  it("incomplete delivery BLOCKS closure", () => {
    for (const status of ["NOT_STARTED", "PLANNED", "PICKED_UP", "IN_TRANSIT"]) {
      expect(closureBlockers(with_({ transport: { status } })), status).toContain("delivery_incomplete");
    }
  });

  it("DELIVERED, POD_RECEIVED and CANCELLED transport all satisfy delivery", () => {
    for (const status of ["DELIVERED", "POD_RECEIVED", "CANCELLED"]) {
      expect(closureBlockers(with_({ transport: { status } })), status).toEqual([]);
    }
  });

  it("a dossier with no invoice at all BLOCKS closure", () => {
    expect(closureBlockers(with_({ invoices: [], payments: [] }))).toContain("no_invoice");
  });

  it("VOID invoices do not count as billable", () => {
    expect(closureBlockers(with_({ invoices: [{ status: "VOID", balance: 999 }], payments: [] })))
      .toContain("no_invoice");
  });

  it("reports EVERY unmet requirement, not just the first", () => {
    const b = closureBlockers({
      fileType: "IMP",
      customs: { status: "DECLARED", required: true },
      transport: { status: "IN_TRANSIT" },
      invoices: [{ status: "ISSUED", balance: 500 }],
      payments: [{ verified: false }],
    });
    expect(b).toEqual(expect.arrayContaining([
      "customs_not_released", "delivery_incomplete", "invoice_outstanding", "payment_unverified",
    ]));
  });
});

// ---------------------------------------------------------------------------
describe("the operator is told WHY", () => {
  it("every blocker has a French message", () => {
    for (const codeKey of Object.keys(CLOSURE_BLOCKER_LABEL_FR)) {
      expect(CLOSURE_BLOCKER_LABEL_FR[codeKey as keyof typeof CLOSURE_BLOCKER_LABEL_FR].length)
        .toBeGreaterThan(15);
    }
  });

  it("every blocker code is translated in the file errors map", () => {
    const errors = t.files.errors as Record<string, string>;
    for (const codeKey of Object.keys(CLOSURE_BLOCKER_LABEL_FR)) {
      expect(errors[codeKey], codeKey).toBeTruthy();
    }
  });

  it("never returns a generic failure when a specific reason exists", () => {
    expect(closureRefusalFr(closureBlockers(with_({ payments: [{ verified: false }] }))))
      .toContain("vérifié");
    expect(closureRefusalFr([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("the server enforces the SAME rule the UI displays", () => {
  const actions = () => code("lib/files/actions.ts");

  it("transitionFile calls the shared closure rule", () => {
    const s = actions();
    expect(s).toContain("closureBlockers({");
    expect(s).toMatch(/if \(toStatus === "CLOSED"\)/);
  });

  it("returns the specific blocker, not a generic error", () => {
    expect(actions()).toContain("if (blockers.length > 0) return { ok: false, error: blockers[0] };");
  });

  it("no longer relies on the customs-only guard alone", () => {
    const s = actions();
    // the old single check is gone
    expect(s).not.toMatch(/return \{ ok: false, error: "customs_not_released" \};/);
  });

  it("cannot be bypassed by the client — the guard is in the server action", () => {
    const s = actions();
    const fn = s.slice(s.indexOf("export async function transitionFile"));
    // permission first, then the closure gate, before any write
    // Ratified 2026-07-28: transitioning is `file:transition`, not `file:update`.
    const perm = fn.indexOf('assertPermission("file:transition")');
    const gate = fn.indexOf("closureBlockers({");
    const write = fn.indexOf('.from("operational_file")\n    .update(');
    expect(perm).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(perm);
    if (write > -1) expect(write).toBeGreaterThan(gate);
  });

  it("computes money with the finance calculator, not its own arithmetic", () => {
    const s = actions();
    expect(s).toContain("invoiceTotals(");
    expect(s).toContain("paidAmount(");
    expect(s).toContain("balanceDue(");
  });

  it("ignores reversed payments when judging settlement", () => {
    expect(actions()).toMatch(/reversed_at == null/);
  });
});

// ---------------------------------------------------------------------------
describe("archive-stage navigation", () => {
  it("ANCHOR.archive points at the closure control", () => {
    expect(code("lib/files/lifecycle.ts")).toContain('archive: "#closure"');
  });

  it("the closure control carries that anchor and a clear heading", () => {
    const w = code("components/files/file-workflow.tsx");
    expect(w).toContain('id="closure"');
    expect(w).toContain("Clôture du dossier");
  });

  it("no separate archive route was created", () => {
    let exists = true;
    try { read("app/files/[id]/archive/page.tsx"); } catch { exists = false; }
    expect(exists).toBe(false);
  });

  it("the closure control is gated on file:transition, not file:update", () => {
    // Editing master data and advancing the ladder are independent authorities.
    expect(code("components/files/file-workflow.tsx"))
      .toMatch(/\{canTransitionStatus && next\.length > 0 &&/);
    expect(code("app/files/[id]/page.tsx"))
      .toContain('hasPermission(permissions, "file:transition")');
  });
});

// ---------------------------------------------------------------------------
describe("terminology", () => {
  it("the pending final stage reads « Clôture », not « Archivé »", () => {
    expect(t.lifecycle.steps.archived).toBe("Clôture");
  });

  it("no ARCHIVED file status was introduced", () => {
    const s = code("lib/files/status.ts");
    expect(s).not.toMatch(/"ARCHIVED"/);
    expect(s).toContain('DELIVERED: ["CLOSED"]');
    expect(s).toContain("CLOSED: []");
  });
});
