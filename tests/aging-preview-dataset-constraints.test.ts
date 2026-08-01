/**
 * FND-R11-02 — the synthetic aging dataset must satisfy migration 72.
 *
 * During D2 the preview SQL editor rejected `DEMO-INV-0009`:
 * `PLATFORM_NATIVE` + `file_id = null` + a legacy reference — exactly the
 * combination the Q-08 constraint (`invoice_dossier_or_legacy_reference`)
 * exists to forbid. The dataset had been written BEFORE the constraint and was
 * never re-validated against it; the existing dataset test checks safety
 * properties (own tenant, DEMO- prefixes, never in CI) but no row semantics.
 *
 * This suite closes that class: it parses every synthetic invoice row and
 * evaluates it against a transcription of the constraint, plus the stricter
 * house doctrine the rows are meant to demonstrate. If migration 72's
 * constraint text changes shape, the coupling test fails first.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const DATASET = "supabase/demo/aging_preview_dataset.sql";
const MIGRATION = "supabase/migrations/20260729000002_aging_balance_foundation.sql";

type SpecRow = {
  clientId: string;
  fileId: string | null;
  suffix: string;
  provenance: "PLATFORM_NATIVE" | "OPENING_IMPORT";
  legacyRef: string | null;
  currency: string;
};

/** Every synthetic invoice tuple from the dataset's VALUES list. */
function specRows(): SpecRow[] {
  const s = read(DATASET);
  const re =
    /\(\s*'([0-9a-f-]{36})'::uuid,\s*(?:'([0-9a-f-]{36})'::uuid|null),\s*'(\d{4})',\s*(-?\d+),\s*\d+::numeric,\s*'(PLATFORM_NATIVE|OPENING_IMPORT)',\s*(?:'([^']+)'|null(?:::text)?),\s*'([A-Z]{3})',\s*(?:true|false)\)/g;
  const rows: SpecRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    rows.push({
      clientId: m[1],
      fileId: m[2] ?? null,
      suffix: m[3],
      provenance: m[5] as SpecRow["provenance"],
      legacyRef: m[6] ?? null,
      currency: m[7],
    });
  }
  return rows;
}

/** (id → client_id) for every demo dossier the dataset creates. */
function demoDossiers(): Map<string, string> {
  const s = read(DATASET);
  const re =
    /\('([0-9a-f-]{36})', '00000000-0000-0000-0000-00000000de00', 'DEMO-[A-Z]{3}-\d{4}-\d{4}', '\w+', '([0-9a-f-]{36})', '\w+'\)/g;
  const out = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.set(m[1], m[2]);
  return out;
}

function demoClients(): Set<string> {
  const s = read(DATASET);
  const re = /\('([0-9a-f-]{36})', '00000000-0000-0000-0000-00000000de00', 'Client D/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.add(m[1]);
  return out;
}

/** Transcription of invoice_dossier_or_legacy_reference (migration 72). */
function constraintHolds(r: SpecRow): boolean {
  if (r.provenance === "PLATFORM_NATIVE") return r.fileId !== null;
  return r.fileId !== null || r.legacyRef !== null; // OPENING_IMPORT
}

// ---------------------------------------------------------------------------
describe("the dataset parses to the shape the runbook promises", () => {
  const rows = specRows();

  it("finds all 25 invoices", () => {
    expect(rows.length).toBe(25);
    expect(new Set(rows.map((r) => r.suffix)).size).toBe(25);
  });

  it("finds 12 clients and the ten dossiers", () => {
    expect(demoClients().size).toBe(12);
    // 4 original + 2 for Epsilon/Zêta (constraint fix) + 4 for the tail clients
    // (client↔dossier coherence fix) — both under FND-R11-02.
    expect(demoDossiers().size).toBe(10);
  });

  it("keeps exactly four OPENING_IMPORT rows, as the runbook documents", () => {
    const imports = rows.filter((r) => r.provenance === "OPENING_IMPORT");
    expect(imports.map((r) => r.suffix).sort()).toEqual(["0013", "0014", "0015", "0016"]);
  });
});

// ---------------------------------------------------------------------------
describe("every row satisfies migration 72's constraint (FND-R11-02)", () => {
  const rows = specRows();

  it("invoice_dossier_or_legacy_reference holds for all 25 rows", () => {
    const violations = rows.filter((r) => !constraintHolds(r)).map((r) => r.suffix);
    expect(violations).toEqual([]);
  });

  it("PLATFORM_NATIVE rows carry a dossier and NO legacy reference (house doctrine, stricter than the CHECK)", () => {
    for (const r of rows.filter((x) => x.provenance === "PLATFORM_NATIVE")) {
      expect(r.fileId, `DEMO-INV-${r.suffix} must reference a dossier`).not.toBeNull();
      expect(r.legacyRef, `DEMO-INV-${r.suffix} must not carry a legacy reference`).toBeNull();
    }
  });

  it("OPENING_IMPORT rows are dossier-less and carry a preserved DEMO-LEG reference", () => {
    for (const r of rows.filter((x) => x.provenance === "OPENING_IMPORT")) {
      expect(r.fileId, `DEMO-INV-${r.suffix}`).toBeNull();
      expect(r.legacyRef, `DEMO-INV-${r.suffix}`).toMatch(/^DEMO-LEG-/);
    }
  });

  it("the rejected combination can never come back", () => {
    const zombie = rows.filter(
      (r) => r.provenance === "PLATFORM_NATIVE" && r.fileId === null && r.legacyRef !== null,
    );
    expect(zombie).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("referential coherence inside the script", () => {
  const rows = specRows();
  const dossiers = demoDossiers();
  const clients = demoClients();

  it("every referenced dossier is created by the script", () => {
    for (const r of rows) {
      if (r.fileId) expect(dossiers.has(r.fileId), `DEMO-INV-${r.suffix} → ${r.fileId}`).toBe(true);
    }
  });

  it("every referenced client is created by the script", () => {
    for (const r of rows) {
      expect(clients.has(r.clientId), `DEMO-INV-${r.suffix} → ${r.clientId}`).toBe(true);
    }
  });

  it("an invoice's client owns the dossier it bills against", () => {
    for (const r of rows) {
      if (r.fileId) {
        expect(dossiers.get(r.fileId), `DEMO-INV-${r.suffix}: dossier owned by another client`).toBe(r.clientId);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe("the transcription stays coupled to the real constraint", () => {
  it("migration 72 still defines the two branches this suite transcribes", () => {
    const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
    expect(sql).toContain("invoice_dossier_or_legacy_reference");
    expect(sql).toContain("(provenance = 'PLATFORM_NATIVE' and file_id is not null)");
    expect(sql).toContain(
      "(provenance = 'OPENING_IMPORT' and (file_id is not null or legacy_file_reference is not null))",
    );
  });
});
