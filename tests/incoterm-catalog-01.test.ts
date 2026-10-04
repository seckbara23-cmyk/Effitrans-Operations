/**
 * INCOTERM-CATALOG-01 — the Incoterm becomes a governed value, and nothing else.
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG. `shipment.incoterm` had been free text since migration 2, and
 * the dossier form offered a bare `<input>`. Operations could type a lowercase
 * code, a typo or a sentence, and the dossier carried it downstream to Transit as
 * though it were a commercial fact. Its two neighbours on the same table were
 * already governed — `transport_mode` and `cargo_form` each have a CHECK and an
 * application constant — so this is the third coming into line, not a new idea.
 *
 * THE BUSINESS CONTRACT THIS FILE MOSTLY DEFENDS. An Incoterm states the
 * condition between BUYER and SELLER. « Services demandés » states what Effitrans
 * was contracted to perform. They are different facts, and the tempting
 * inference — CIF implies insurance and freight, so surely Effitrans does
 * transport; DDP implies everything, so surely Effitrans does everything — is
 * exactly the inference that must never appear in code. So most of what follows
 * asserts an ABSENCE: no service, step, assignment, handoff, status, permission
 * or responsibility is derived from the Incoterm, anywhere.
 *
 * WHAT IS PROVEN WHERE. The vocabulary's enforcement is a database fact, so the
 * CHECK accepting the eleven and refusing everything else — including the
 * near-misses a real operator produces, `cif`, ` CIF`, `FOBB` — is proven against
 * a REAL database in `supabase/tests/rls_incoterm_catalog_test.sql`, together
 * with the RLS boundary. This file proves the TypeScript half: the catalogue, the
 * validator, the single write path, the read model, the selector and the one
 * display rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  INCOTERMS,
  INCOTERM_LABELS,
  isIncoterm,
  incotermOptionLabel,
  formatIncoterm,
  type Incoterm,
} from "@/lib/files/incoterms";
import { validateFile } from "@/lib/files/validate";
import type { FileInput } from "@/lib/files/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20261011000001_incoterm_catalog.sql";
const VERIFIER = "supabase/verifiers/20261011000001_incoterm_catalog.verify.sql";
const SQL_TEST = "supabase/tests/rls_incoterm_catalog_test.sql";
const FORM = "components/files/file-form.tsx";
const ACTIONS = "lib/files/actions.ts";
const SERVICE = "lib/files/service.ts";
const DETAIL = "app/files/[id]/page.tsx";

/** The eleven Effitrans Transit uses, as ratified. Written out, not derived. */
const RATIFIED = [
  "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DPU", "DAP", "DDP",
] as const;

const file = (over: Partial<FileInput> = {}): FileInput => ({
  type: "IMP",
  clientId: "11111111-1111-1111-1111-111111111111",
  ...over,
}) as FileInput;

// ================================================= A. the canonical eleven ====

describe("A — the catalogue is exactly the ratified eleven", () => {
  it("holds all eleven codes, in Incoterms 2020 order", () => {
    expect([...INCOTERMS]).toEqual([...RATIFIED]);
  });

  it("…and nothing else — no twelfth value crept in", () => {
    expect(INCOTERMS).toHaveLength(11);
    expect(new Set(INCOTERMS).size).toBe(11);
  });

  it("every code carries its official term, so nobody memorises codes", () => {
    for (const c of INCOTERMS) {
      expect(INCOTERM_LABELS[c], c).toBeTruthy();
      expect(INCOTERM_LABELS[c], c).not.toBe(c);
    }
    expect(INCOTERM_LABELS.CIF).toBe("Cost, Insurance and Freight");
    expect(INCOTERM_LABELS.FOB).toBe("Free On Board");
    expect(INCOTERM_LABELS.DAP).toBe("Delivered at Place");
  });

  it("the selector label is « CODE — Term »", () => {
    expect(incotermOptionLabel("CIF")).toBe("CIF — Cost, Insurance and Freight");
    expect(incotermOptionLabel("FOB")).toBe("FOB — Free On Board");
    expect(incotermOptionLabel("DAP")).toBe("DAP — Delivered at Place");
  });

  it("every canonical code passes the validator", () => {
    for (const c of INCOTERMS) {
      expect(validateFile(file({ shipment: { incoterm: c } })), c).toBeNull();
    }
  });
});

// ============================================== B. anything else is refused ====

describe("B — an arbitrary value is refused", () => {
  it.each(["TEST", "XYZ", "FOBB", "DAT", "EXWORKS", "incoterm", "CIF/FOB", "123"])(
    "%s is not an Incoterm",
    (v) => {
      expect(isIncoterm(v)).toBe(false);
      expect(validateFile(file({ shipment: { incoterm: v } }))).toBe("invalid_incoterm");
    },
  );

  it("the near-misses a real operator produces are refused too", () => {
    // Case and padding are the ones that would otherwise reach the database and
    // be rejected there with a constraint error instead of a sentence.
    for (const v of ["cif", "Cif", " CIF", "CIF ", "cif "]) {
      expect(isIncoterm(v), v).toBe(false);
      expect(validateFile(file({ shipment: { incoterm: v } })), v).toBe("invalid_incoterm");
    }
  });

  it("the guard rejects non-strings rather than coercing them", () => {
    for (const v of [null, undefined, 0, 1, true, {}, [], ["CIF"]]) {
      expect(isIncoterm(v)).toBe(false);
    }
  });

  it("the refusal has a French message, so the operator sees a sentence", () => {
    expect(read("lib/i18n.ts")).toContain('invalid_incoterm: "Incoterm invalide."');
  });

  it("the DATABASE refuses it independently — the validator is not the boundary", () => {
    const sql = sqlCode(MIGRATION);
    // THE STATEMENT, NOT A SUBSTRING, AND IT MUST BEGIN ITS OWN LINE. `sqlCode`
    // strips whole-line comments but not trailing ones, so
    // `perform 1; -- alter table … add constraint …` kept every substring this
    // once asserted while creating nothing at all.
    const stmt = /^\s*alter table public\.shipment add constraint shipment_incoterm_check\s*\n\s*check \(([\s\S]*?)\);/m.exec(sql);
    expect(stmt, "the CHECK must be a real statement").toBeTruthy();
    const predicate = stmt![1];
    // and the codes must be in the CHECK, not merely somewhere in the file —
    // the self-assertion block lists them too, which made a lost code invisible.
    for (const c of RATIFIED) expect(predicate, c).toContain(`'${c}'`);
    expect(predicate).toContain("incoterm is null or incoterm in");

    // Exactly one constraint is created, and it is that one: a second CHECK on
    // the free-text place would be a business rule this slice does not invent.
    const created = [...sql.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(["shipment_incoterm_check"]);
    // and the real-database suite exercises the refusal rather than assuming it
    const t = sqlCode(SQL_TEST);
    expect(t).toMatch(/array\['TEST','XYZ','cif',' CIF','CIF ','FOBB','DAT',''\]/);
    expect(t).toContain("exception when others then v_ok := true;");
  });
});

// ======================================== C/D. what is persisted, and where ====

describe("C/D — the code and the place persist, independently", () => {
  const actions = code(ACTIONS);

  it("the ONE write path persists the code and the place", () => {
    expect(actions).toContain("incoterm: s?.incoterm?.trim() || null,");
    expect(actions).toContain("incoterm_place: s?.incotermPlace?.trim() || null,");
  });

  it("…and it is genuinely one path: create and edit share the same builder", () => {
    // A second writer is how two code paths start disagreeing about a fact.
    expect(actions).toContain("insert(shipmentRow(");
    expect(actions).toContain("upsert(shipmentRow(");
    expect((actions.match(/incoterm_place:/g) ?? []).length).toBe(1);
  });

  it("the place is NOT merged into the route or into carriage identity", () => {
    // Each of these is a different fact with its own column; the Incoterm place
    // may equal the destination and still must not share its storage.
    const row = actions.slice(actions.indexOf("function shipmentRow"), actions.indexOf("\n}\n", actions.indexOf("function shipmentRow")));
    for (const sibling of [
      "origin: s?.origin?.trim() || null,",
      "destination: s?.destination?.trim() || null,",
      "carrier_name: s?.carrierName?.trim() || null,",
      "vessel_or_flight: s?.vesselOrFlight?.trim() || null,",
      "bl_awb_ref: s?.blAwbRef?.trim() || null,",
    ]) {
      expect(row, sibling).toContain(sibling);
    }
    // the place reads from its OWN input field, not from any of those
    expect(row).toContain("incoterm_place: s?.incotermPlace?.trim() || null,");
  });

  it("the read model returns both, from the same select", () => {
    const svc = code(SERVICE);
    expect(svc).toContain("transport_mode, incoterm, incoterm_place, origin, destination");
    expect(svc).toContain("incotermPlace: shipment.incoterm_place,");
  });

  it("the migration adds the place as its own nullable column", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toContain("add column if not exists incoterm_place text");
    expect(sql).not.toMatch(/alter column (origin|destination)/i);
    expect(sql).not.toMatch(/drop column/i);
  });
});

// ====================================================== E. both are optional ===

describe("E — nothing became mandatory", () => {
  it("a dossier with no Incoterm is valid", () => {
    expect(validateFile(file())).toBeNull();
    expect(validateFile(file({ shipment: {} }))).toBeNull();
    expect(validateFile(file({ shipment: { incoterm: null } }))).toBeNull();
  });

  it("an EMPTY incoterm is absent, not invalid — that is what the selector sends", () => {
    expect(validateFile(file({ shipment: { incoterm: "" } }))).toBeNull();
  });

  it("the place alone is never a validation error — no location rule is invented", () => {
    expect(validateFile(file({ shipment: { incotermPlace: "Dakar" } }))).toBeNull();
    expect(validateFile(file({ shipment: { incoterm: "CIF", incotermPlace: "Dakar" } }))).toBeNull();
  });

  it("the migration keeps both columns nullable and says so", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toMatch(/incoterm_place[\s\S]{0,120}must stay nullable/);
    expect(sql).toMatch(/incoterm must stay nullable/);
    expect(sql).toContain("incoterm is null or incoterm in");
  });
});

// ======================================================= F. the display rule ===

describe("F — « CIF — Dakar », composed in exactly one place", () => {
  it("code + place reads « CIF — Dakar »", () => {
    expect(formatIncoterm("CIF", "Dakar")).toBe("CIF — Dakar");
    expect(formatIncoterm("FOB", "Shanghai")).toBe("FOB — Shanghai");
  });

  it("code alone reads « CIF » — no location is fabricated", () => {
    expect(formatIncoterm("CIF", null)).toBe("CIF");
    expect(formatIncoterm("CIF", "")).toBe("CIF");
    expect(formatIncoterm("CIF", "   ")).toBe("CIF");
  });

  it("neither returns null, so the surface uses its own absent-value convention", () => {
    expect(formatIncoterm(null, null)).toBeNull();
    expect(formatIncoterm("", "")).toBeNull();
    expect(formatIncoterm(undefined, undefined)).toBeNull();
  });

  it("a place with NO code renders as absent, never as an Incoterm", () => {
    // A location on its own states no commercial condition. Showing it would
    // invent an Incoterm fact out of a town name.
    expect(formatIncoterm(null, "Dakar")).toBeNull();
    expect(formatIncoterm("", "Dakar")).toBeNull();
  });

  it("the dossier detail renders it through that formatter and the « — » convention", () => {
    const d = read(DETAIL);
    expect(d).toContain('import { formatIncoterm } from "@/lib/files/incoterms";');
    expect(d).toMatch(
      /label="Incoterm"[\s\S]{0,160}formatIncoterm\(file\.shipment\?\.incoterm, file\.shipment\?\.incotermPlace\)/,
    );
    // `Fact` already renders "—" for an absent value; no new convention invented.
    expect(d).toContain('{value?.toString().trim() ? value : "—"}');
  });

  it("history is shown as it is: a non-canonical stored code is not hidden", () => {
    // Only possible on rows predating the CHECK. Silently blanking them would
    // destroy the record; the formatter passes them through.
    expect(formatIncoterm("CFR ", "Dakar")).toBe("CFR — Dakar");
    expect(formatIncoterm("legacy-value", null)).toBe("legacy-value");
  });
});

// ======================================================== the selector UI ======

describe("the form offers a governed selector, not free text", () => {
  const form = read(FORM);

  it("the Incoterm field is a select over the catalogue", () => {
    expect(form).toContain('import { INCOTERMS, incotermOptionLabel } from "@/lib/files/incoterms";');
    expect(form).toMatch(
      /<Field label=\{t\.files\.form\.incoterm\}>\s*<select/,
    );
    expect(form).toContain("{INCOTERMS.map((c) => (");
    expect(form).toContain("<option key={c} value={c}>{incotermOptionLabel(c)}</option>");
  });

  it("…and is no longer an input the operator can type into", () => {
    const field = form.slice(
      form.indexOf("<Field label={t.files.form.incoterm}>"),
      form.indexOf("</Field>", form.indexOf("<Field label={t.files.form.incoterm}>")),
    );
    expect(field).not.toContain("<input");
  });

  it("the option VALUE is the bare code, so only the code is persisted", () => {
    expect(form).toContain('<option value="">{t.common.none}</option>');
    expect(form).toContain("value={c}");
  });

  it("the named place has its own French-labelled field", () => {
    expect(read("lib/i18n.ts")).toContain('incotermPlace: "Lieu / port Incoterm"');
    expect(form).toContain("<Field label={t.files.form.incotermPlace}>");
    expect(form).toContain("setIncotermPlace(e.target.value)");
  });

  it("…and the place is dropped when no Incoterm is chosen", () => {
    expect(form).toContain("incotermPlace: incoterm ? incotermPlace : null,");
    expect(form).toContain("disabled={!editable || !incoterm}");
  });

  it("the edit path uses the SAME selector — there is one form component", () => {
    // file-form.tsx serves create and dossier detail/edit (mode: "create"|"edit"),
    // so an arbitrary Incoterm cannot be introduced by editing either.
    expect(form).toContain('mode: "create" | "edit"');
    expect((form.match(/t\.files\.form\.incoterm\}/g) ?? []).length).toBe(1);
  });
});

// ============================= H/I. SEE a fact; derive nothing from it =========

describe("H/I — the Incoterm drives nothing", () => {
  it("no module derives a service, a step or a responsibility from a code", () => {
    // The whole repository: if any file both names an Incoterm code and reaches
    // for the workflow or service vocabulary, that inference exists somewhere.
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? e.name === "node_modules" || e.name === ".next"
            ? []
            : walk(`${dir}/${e.name}`)
          : e.name.endsWith(".ts") || e.name.endsWith(".tsx")
            ? [`${dir}/${e.name}`]
            : [],
      );
    // THE SIGNATURE OF AN INFERENCE IS A DECISION, not a mention. A fixture that
    // merely carries `incoterm: "CIF"` — lib/ai/eval/harness.ts does — proves
    // nothing either way, and co-occurrence with the word "assign" somewhere else
    // in the same file proves less than nothing. What would actually be wrong is
    // BRANCHING on a code, so that is what is detected: a comparison, a switch
    // arm, or a membership test against one of the eleven.
    //
    // Truthiness is deliberately NOT flagged. `incoterm ? incotermPlace : null`
    // asks "was a term chosen", which is a presence question every optional field
    // is entitled to ask; it never asks WHICH term, so it cannot encode an
    // Incoterm-specific rule.
    const CODES = "EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DPU|DAP|DDP";
    const DECIDES: RegExp[] = [
      new RegExp(`[!=]==?\\s*["'\`](${CODES})["'\`]`),
      new RegExp(`["'\`](${CODES})["'\`]\\s*[!=]==?`),
      new RegExp(`case\\s+["'\`](${CODES})["'\`]`),
      new RegExp(`\\[[^\\]]*["'\`](${CODES})["'\`][^\\]]*\\]\\s*\\.(includes|indexOf|some)`),
      /\bincoterm\b\s*(===|!==|==|!=)/,
    ];
    const offenders: string[] = [];
    for (const f of [...walk("lib"), ...walk("app"), ...walk("components")]) {
      if (f.endsWith("incoterms.ts")) continue; // the catalogue itself names them
      const src = code(f);
      if (DECIDES.some((re) => re.test(src))) offenders.push(f);
    }
    expect(offenders.sort()).toEqual([]);
  });

  it("the catalogue module itself reaches nothing — it is pure", () => {
    const src = read("lib/files/incoterms.ts");
    expect(src).not.toContain("import");
    expect(src).not.toContain("server-only");
    expect(src).not.toMatch(/supabase|fetch\(|process\.env/);
  });

  it("the validator treats it as a fact: one check, no cross-field rule", () => {
    const v = code("lib/files/validate.ts");
    expect(v).toContain('if (s?.incoterm && !isIncoterm(s.incoterm)) return "invalid_incoterm";');
    // nothing couples it to services, mode, type or the place
    expect(v).not.toMatch(/incoterm[\s\S]{0,80}(services|transportMode|input\.type)/);
    expect(v).not.toMatch(/incotermPlace[\s\S]{0,60}return/);
  });

  it("the migration touches no policy, function, trigger or workflow table", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(sql).not.toMatch(/create or replace function|create trigger|drop trigger/i);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    for (const t of [
      "process_instance", "process_step_execution", "process_handoff",
      "role_permission", "permission", "user_role", "file_state_transition",
    ]) {
      expect(sql, t).not.toContain(t);
    }
    // The only table it alters is shipment — twice, once for the column and once
    // for the constraint, so the SET of altered tables is the claim, not a count.
    const altered = [...new Set([...sql.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]))];
    expect(altered.sort()).toEqual(["shipment"]);
  });

  it("the real-database suite proves services and workflow are untouched", () => {
    const t = sqlCode(SQL_TEST);
    expect(t).toContain("H Incoterm write changes no service scope");
    expect(t).toContain("H … and a recorded scope is not widened by DDP");
    expect(t).toContain("I Incoterm write creates/advances no workflow step");
    expect(t).toContain("I Incoterm write opens no process instance");
    expect(t).toContain("I Incoterm write creates no handoff");
    expect(t).toContain("I the dossier status is unchanged");
  });
});

// ========================== G. no authorization or tenancy change =============

describe("G — the field broadens no access", () => {
  it("the Coordinator visibility work is untouched", () => {
    // Named explicitly because it was the previous slice and is the thing most
    // likely to be disturbed by accident.
    const sql = sqlCode(MIGRATION);
    for (const forbidden of [
      "file:read:all", "user_readable_file_ids", "can_read_file", "can_read_task",
      "get_user_permissions", "COORDINATOR",
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("the reader stays a user-context client where it already was", () => {
    // This slice adds a column to an existing select; it must not have reached
    // for an admin client to read it.
    // Judged on getFile's OWN body, and on the SHIPMENT read specifically.
    //
    // getFile does hold an admin client, for one pre-existing reason it documents:
    // `app_user` is self-only under RLS, so another staff member's display name
    // cannot be resolved in user context. That read is tenant-scoped, predates
    // this slice and is none of its business. What matters here is that the
    // shipment — the row that grew a column — is still read as the USER, so RLS
    // remains the boundary for the Incoterm exactly as for every other fact on it.
    const svc = code(SERVICE);
    const at = svc.indexOf("export async function getFile(");
    const fn = svc.slice(at, svc.indexOf("export async function", at + 10));
    expect(fn, "getFile is the reader that grew a column").toContain('from("shipment")');
    expect(fn).toContain("const supabase = getServerSupabaseClient();");
    expect(fn, "the shipment is read as the user, not past RLS").toMatch(
      /await supabase\s*\n\s*\.from\("shipment"\)/,
    );
    expect(fn, "the admin client must not have been pointed at the shipment").not.toMatch(
      /await admin\s*\n?\s*\.from\("shipment"\)/,
    );
    // …and the one admin read it does perform is still only the display name.
    const adminUses = [...fn.matchAll(/await admin\s*\n?\s*\.from\("(\w+)"\)/g)].map((m) => m[1]);
    expect(adminUses).toEqual(["app_user"]);
    // …and the permission is still asserted before anything is read.
    expect(fn).toContain('assertPermission("file:read")');
  });

  it("the real-database suite proves an unrelated and a cross-tenant reader see nothing", () => {
    const t = sqlCode(SQL_TEST);
    expect(t).toContain("G unrelated same-tenant reader sees no dossier");
    expect(t).toContain("G … and therefore no shipment/Incoterm");
    expect(t).toContain("G cross-tenant reader sees no shipment/Incoterm");
  });
});

// ============================ J/L. nothing existing was broken ================

describe("J/L — existing dossiers and creation still work", () => {
  it("creation without any shipment block is still valid", () => {
    expect(validateFile(file())).toBeNull();
  });

  it("every pre-existing validation rule still fires", () => {
    expect(validateFile(file({ type: "ZZZ" as never }))).toBe("invalid_type");
    expect(validateFile(file({ clientId: "nope" }))).toBe("client_required");
    expect(validateFile(file({ shipment: { transportMode: "BOAT" as never } }))).toBe("invalid_mode");
    expect(validateFile(file({ shipment: { cargoForm: "PALETTE" } }))).toBe("invalid_cargo_form");
  });

  it("the two Incoterm values production already holds remain valid", () => {
    // Audited read-only before the constraint was written: CIF x4, CIP x1, and
    // nine shipments with none. Every one of those states stays acceptable.
    for (const held of ["CIF", "CIP"]) {
      expect(isIncoterm(held), held).toBe(true);
      expect(validateFile(file({ shipment: { incoterm: held } })), held).toBeNull();
    }
    expect(validateFile(file({ shipment: { incoterm: null } }))).toBeNull();
  });

  it("the migration rewrites no data", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).not.toMatch(/^\s*(update|insert|delete|truncate)\s+/im);
  });

  it("the ledger is bumped and the verifier shipped", () => {
    const build = read("lib/platform/ops/build-info.ts");
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(build).toContain(`LATEST_MIGRATION = "${files.at(-1)!.replace(/\.sql$/, "")}"`);
    expect(build).toContain(`MIGRATION_COUNT = ${files.length}`);
    const v = sqlCode(VERIFIER);
    expect(v).toMatch(/\bok\b/);
    expect(v).toMatch(/\bdetail\b/);
    expect(v).not.toMatch(/\bdo\s+\$\$/i);
    expect(v).not.toMatch(/supabase_migrations/i);
    // THE PREDICATES, NOT THE LABELS. A label survives having its check replaced
    // by `select true` or `def is not null`, and a vacuous verifier reports a
    // migration as verified while proving nothing — so each one is pinned by the
    // expression that does the work.
    expect(v, "the vocabulary must be pinned at exactly eleven, not merely present").toMatch(
      /length\(def\) - length\(replace\(def, '''', ''\)\)\) \/ 2 = 11/,
    );
    for (const c of RATIFIED) {
      expect(v, `the verifier must require ${c}`).toContain(`('${c}')`);
    }
    expect(v).toMatch(/def like '%IS NULL%' from con/);
    expect(v).toMatch(/def not like '%incoterm_place%' from con/);
    // …and the promise that this records a fact rather than driving anything.
    expect(v).toMatch(/from public\.process_step_owning_role\s*\n\s*where step_key like '%incoterm%'/);
    expect(v).toMatch(/column_name in \('incoterm', 'incoterm_place'\)\s*\n\s*and table_name <> 'shipment'/);
  });

  it("the new suite actually runs in CI", () => {
    expect(read(".github/workflows/ci.yml")).toContain("supabase/tests/rls_incoterm_catalog_test.sql");
  });
});
