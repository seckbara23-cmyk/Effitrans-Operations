/**
 * Phase 11.0C — Autorisation de Dépenses: workflow + exact-template PDF.
 * ---------------------------------------------------------------------------
 * Pins what a user of this phase actually depends on:
 *   A. « Montant en lettres » — French orthography, the field a payment document
 *      is legally read from. Exercised against the rules that are easy to get
 *      wrong (70/80/90, cent/vingt plurals, mille invariable).
 *   B. Template geometry — every paper field has a box, boxes tile the frame
 *      without overlap, the visa order is the PRINTED order, A4 at 1:1.
 *   C. The renderer — valid deterministic PDF bytes with exact xref offsets, all
 *      values present, overflow REPORTED not hidden, and the raster slot wired.
 *   D. Draft lifecycle discipline — the save router, derived words, dossier
 *      resolution, template provenance, redaction (asserted on source text, as
 *      importing the server chain is not possible in a unit test).
 *   E. Migration — the attachment table's confinement guarantees.
 *   F. Surfaces — permission gates, no NEW permission, navigation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { amountInWordsFr, integerToFrenchWords } from "@/lib/finance/expense/amount-in-words";
import {
  AUTHORIZATION_FIELDS,
  AUTHORIZATION_VISA_BOXES,
  FRAME,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  fieldSlot,
  geometryIsWellFormed,
  type AuthorizationFieldKey,
} from "@/lib/finance/expense/template-map";
import { buildAuthorizationPdf, activeAuthorizationTemplate, hasTemplateRaster } from "@/lib/finance/expense/pdf";
import { AUTHORIZATION_VISA_STEPS } from "@/lib/finance/expense/types";
import { EXPENSE_TEMPLATES } from "@/lib/finance/expense/templates";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/** Executable SQL only — `--` comments explain intent and must not be asserted on. */
const sql = (s: string) =>
  s
    .split("\n")
    .map((line) => (line.indexOf("--") === -1 ? line : line.slice(0, line.indexOf("--"))))
    .join("\n");

const ACTIONS = read("../lib/finance/expense/actions.ts");
const ATTACHMENTS = read("../lib/finance/expense/attachments.ts");
const READERS = read("../lib/finance/expense/readers.ts");
const MIGRATION = read("../supabase/migrations/20260726000001_expense_attachments.sql");
const LIST_PAGE = read("../app/finance/autorisations-depenses/page.tsx");
const NEW_PAGE = read("../app/finance/autorisations-depenses/nouvelle/page.tsx");
const DETAIL_PAGE = read("../app/finance/autorisations-depenses/[id]/page.tsx");
const PDF_ROUTE = read("../app/api/finance/expense-authorizations/[id]/pdf/route.ts");
const NAV = read("../lib/navigation/build.ts");
const FORM = read("../components/finance/expense/authorization-form.tsx");
const CI = read("../.github/workflows/ci.yml");

// ===================================== A. Montant en lettres (1-12) =========

describe("montant en lettres — French number-to-words", () => {
  it("1 — units, teens and the 17-19 compounds", () => {
    expect(integerToFrenchWords(0)).toBe("zéro");
    expect(integerToFrenchWords(1)).toBe("un");
    expect(integerToFrenchWords(16)).toBe("seize");
    expect(integerToFrenchWords(17)).toBe("dix-sept");
    expect(integerToFrenchWords(19)).toBe("dix-neuf");
  });

  it("2 — « et un » on 21…61, never on 81", () => {
    expect(integerToFrenchWords(21)).toBe("vingt et un");
    expect(integerToFrenchWords(31)).toBe("trente et un");
    expect(integerToFrenchWords(61)).toBe("soixante et un");
    expect(integerToFrenchWords(81)).toBe("quatre-vingt-un");
  });

  it("3 — the 70s are built on soixante, with « et onze » at 71", () => {
    expect(integerToFrenchWords(70)).toBe("soixante-dix");
    expect(integerToFrenchWords(71)).toBe("soixante et onze");
    expect(integerToFrenchWords(72)).toBe("soixante-douze");
    expect(integerToFrenchWords(77)).toBe("soixante-dix-sept");
    expect(integerToFrenchWords(79)).toBe("soixante-dix-neuf");
  });

  it("4 — the 80s/90s are built on quatre-vingt", () => {
    expect(integerToFrenchWords(80)).toBe("quatre-vingts");
    expect(integerToFrenchWords(82)).toBe("quatre-vingt-deux");
    expect(integerToFrenchWords(90)).toBe("quatre-vingt-dix");
    expect(integerToFrenchWords(91)).toBe("quatre-vingt-onze");
    expect(integerToFrenchWords(99)).toBe("quatre-vingt-dix-neuf");
  });

  it("5 — « cent » is invariable at 100 and plural when it ends the number", () => {
    expect(integerToFrenchWords(100)).toBe("cent");
    expect(integerToFrenchWords(101)).toBe("cent un");
    expect(integerToFrenchWords(200)).toBe("deux cents");
    expect(integerToFrenchWords(201)).toBe("deux cent un");
    expect(integerToFrenchWords(999)).toBe("neuf cent quatre-vingt-dix-neuf");
  });

  it("6 — « mille » is invariable and never preceded by « un »", () => {
    expect(integerToFrenchWords(1000)).toBe("mille");
    expect(integerToFrenchWords(1001)).toBe("mille un");
    expect(integerToFrenchWords(2000)).toBe("deux mille");
    expect(integerToFrenchWords(20000)).toBe("vingt mille");
  });

  it("7 — cent/vingt DROP the -s before « mille », KEEP it before a noun scale", () => {
    // The rule that separates a correct cheque from an incorrect one.
    expect(integerToFrenchWords(200000)).toBe("deux cent mille");
    expect(integerToFrenchWords(80000)).toBe("quatre-vingt mille");
    expect(integerToFrenchWords(200_000_000)).toBe("deux cents millions");
    expect(integerToFrenchWords(80_000_000)).toBe("quatre-vingts millions");
  });

  it("8 — millions and milliards take a plural -s as nouns", () => {
    expect(integerToFrenchWords(1_000_000)).toBe("un million");
    expect(integerToFrenchWords(2_000_000)).toBe("deux millions");
    expect(integerToFrenchWords(1_000_000_000)).toBe("un milliard");
    expect(integerToFrenchWords(3_000_000_000)).toBe("trois milliards");
  });

  it("9 — a realistic expense amount reads correctly end to end", () => {
    expect(integerToFrenchWords(1_250_000)).toBe("un million deux cent cinquante mille");
    expect(integerToFrenchWords(1_234_567)).toBe(
      "un million deux cent trente-quatre mille cinq cent soixante-sept",
    );
  });

  it("10 — XOF prints « francs CFA » and spells NO centimes", () => {
    expect(amountInWordsFr(1_250_000, "XOF")).toBe("Un million deux cent cinquante mille francs CFA");
    // XOF has no minor unit in practice — a fractional part is never spelled.
    expect(amountInWordsFr(1500.75, "XOF")).toBe("Mille cinq cents francs CFA");
  });

  it("11 — a decimal currency spells its minor units", () => {
    expect(amountInWordsFr(1234.5, "EUR")).toBe("Mille deux cent trente-quatre euros et cinquante centimes");
    expect(amountInWordsFr(10, "USD")).toBe("Dix dollars US");
  });

  it("12 — an implausible or negative amount yields «» rather than a half-value", () => {
    expect(amountInWordsFr(-1)).toBe("");
    expect(amountInWordsFr(Number.NaN)).toBe("");
    expect(amountInWordsFr(1e12)).toBe("");
    // An unknown code is echoed, never given an invented denomination name.
    expect(amountInWordsFr(5, "ZZZ")).toBe("Cinq ZZZ");
  });
});

// ================================ B. Template geometry (13-19) ==============

describe("template geometry (DEC-C16 coordinate map)", () => {
  it("13 — A4 portrait at 1:1: the map's page IS the engine's page", () => {
    expect(PAGE_WIDTH).toBeCloseTo(595.28, 2);
    expect(PAGE_HEIGHT).toBeCloseTo(841.89, 2);
    // Coordinates are absolute points — the renderer never multiplies them, so a
    // printed copy measures the same as the paper original.
    const src = read("../lib/finance/expense/pdf.ts");
    expect(src).toContain('new PdfDoc({ size: "A4", orientation: "portrait" })');
    expect(src).not.toMatch(/box\.[xywh]\s*\*/);
  });

  it("14 — EVERY paper field of the 11.0A catalog has a box", () => {
    const keys = AUTHORIZATION_FIELDS.map((f) => f.key);
    const required: AuthorizationFieldKey[] = [
      "authorization_number",
      "document_date",
      "account_number",
      "file_number",
      "registration_number",
      "expense_type",
      "weight_kg",
      "beneficiary",
      "amount",
      "currency",
      "agent_name",
      "amount_in_words",
      "reason",
      "attachments",
      "requested_by",
    ];
    for (const k of required) expect(keys, k).toContain(k);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate slot
  });

  it("15 — boxes stay inside the frame and never overlap", () => {
    expect(geometryIsWellFormed()).toBe(true);
  });

  it("16 — the frame fits the page with real margins", () => {
    expect(FRAME.x).toBeGreaterThan(0);
    expect(FRAME.x + FRAME.w).toBeLessThanOrEqual(PAGE_WIDTH);
    expect(FRAME.y + FRAME.h).toBeLessThanOrEqual(PAGE_HEIGHT);
  });

  it("17 — the seven visa boxes carry the PRINTED order of the paper form", () => {
    expect(AUTHORIZATION_VISA_BOXES).toHaveLength(7);
    expect(AUTHORIZATION_VISA_BOXES.map((v) => v.code)).toEqual(AUTHORIZATION_VISA_STEPS.map((s) => s.code));
    expect(AUTHORIZATION_VISA_BOXES.map((v) => v.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("18 — the visa grid fills the frame to its bottom edge", () => {
    const last = AUTHORIZATION_VISA_BOXES[AUTHORIZATION_VISA_BOXES.length - 1];
    expect(last.box.y + last.box.h).toBeCloseTo(FRAME.y + FRAME.h, 1);
  });

  it("19 — fieldSlot resolves a known key and refuses an unknown one", () => {
    expect(fieldSlot("beneficiary")?.label).toBe("BÉNÉFICIAIRE");
    expect(fieldSlot("weight_kg")?.label).toBe("POIDS (KG)");
    expect(fieldSlot("nope" as AuthorizationFieldKey)).toBeNull();
  });
});

// ==================================== C. The renderer (20-28) ===============

describe("exact-template PDF renderer", () => {
  const model = {
    companyName: "Effitrans Operations",
    authorizationNumber: "EFT-AUT-2026-00042",
    statusLabel: "Brouillon",
    documentDate: "26/07/2026",
    accountNumber: "CPT-4471",
    fileNumber: "EFT-2026-0192",
    registrationNumber: "DK-4471-AB",
    expenseType: "Droits de douane",
    weightKg: 12500,
    beneficiary: "Direction Générale des Douanes",
    amount: 1_250_000,
    currency: "XOF",
    amountInWords: "Un million deux cent cinquante mille francs CFA",
    agentName: "A. Diallo",
    reason: "Règlement des droits et taxes à l'importation.",
    attachments: ["facture.pdf", "quittance.pdf"],
    requestedBy: "A. Diallo",
  };

  const latin1 = (b: Uint8Array) => {
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return s;
  };

  /** The 11.0B byte-exactness discipline: every xref offset must land on its object. */
  function assertXrefExact(bytes: Uint8Array): string {
    const s = latin1(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const m = s.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
    expect(m).not.toBeNull();
    const xrefOff = Number(m![1]);
    const lines = s.slice(xrefOff).split("\n");
    const count = Number(lines[1].split(" ")[1]);
    for (let i = 2; i < 2 + count; i++) {
      const line = lines[i] ?? "";
      if (line.includes("65535 f")) continue;
      const off = Number(line.slice(0, 10));
      const objNum = i - 2;
      expect(s.slice(off, off + `${objNum} 0 obj`.length)).toBe(`${objNum} 0 obj`);
    }
    return s;
  }

  it("20 — produces a valid A4 PDF with exact xref offsets", () => {
    const s = assertXrefExact(buildAuthorizationPdf(model).bytes);
    expect(s).toContain("/MediaBox [0 0 595.28 841.89]");
  });

  it("21 — is deterministic: identical input ⇒ byte-identical output", () => {
    const a = buildAuthorizationPdf(model).bytes;
    const b = buildAuthorizationPdf(model).bytes;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("22 — prints every value of the document", () => {
    const s = latin1(buildAuthorizationPdf(model).bytes);
    for (const expected of [
      "EFT-AUT-2026-00042",
      "26/07/2026",
      "CPT-4471",
      "EFT-2026-0192",
      "DK-4471-AB",
      "1 250 000",
      "XOF",
      "12 500",
      "facture.pdf",
    ]) {
      expect(s, expected).toContain(expected);
    }
  });

  it("23 — prints the form's own captions and the seven visa boxes (chrome layer)", () => {
    const s = latin1(buildAuthorizationPdf(model).bytes);
    expect(s).toContain("AUTORISATION DE D"); // accented tail is WinAnsi-encoded
    expect(s).toContain("VISAS ET APPROBATIONS");
    expect(s).toContain("Chef de Transit");
    expect(s).toContain("Coordonnateur");
    expect(s).toContain("DAF");
  });

  it("24 — a draft says so on the face of the document (status is never hidden)", () => {
    const s = latin1(buildAuthorizationPdf({ ...model, statusLabel: "Brouillon" }).bytes);
    expect(s).toContain("BROUILLON");
  });

  it("25 — no watermark machinery ships in 11.0C (DEC-C17 is 11.0D)", () => {
    const src = read("../lib/finance/expense/pdf.ts");
    expect(src).not.toMatch(/rotate|diagonal|watermark\(/i);
  });

  it("26 — an over-long value is reported as overflow, never silently clipped", () => {
    const long = "X".repeat(400);
    const res = buildAuthorizationPdf({ ...model, beneficiary: long });
    expect(res.overflowedFields).toContain("beneficiary");
    // …and the document still renders (the caller decides what to do).
    expect(res.bytes.length).toBeGreaterThan(0);
  });

  it("27 — an ordinary document overflows nothing", () => {
    expect(buildAuthorizationPdf(model).overflowedFields).toEqual([]);
  });

  it("28 — the raster background slot is wired but EMPTY (asset outstanding)", () => {
    expect(hasTemplateRaster()).toBeNull();
    expect(buildAuthorizationPdf(model).usedTemplateRaster).toBe(false);

    // Supplying a raster switches layer 1 on and the drawn chrome off — with the
    // value coordinates unchanged. This is the swap-in the master scan will make.
    const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x7f, 0x80, 0xff, 0x10, 0x00]);
    const withRaster = buildAuthorizationPdf(model, { data: jpeg, width: 2480, height: 3508 });
    expect(withRaster.usedTemplateRaster).toBe(true);
    const s = assertXrefExact(withRaster.bytes);
    expect(s).toContain("/Filter /DCTDecode");
    expect(s).toContain("EFT-AUT-2026-00042"); // values still drawn
    expect(s).not.toContain("VISAS ET APPROBATIONS"); // chrome came from the scan
  });

  it("28b — NOTHING is drawn outside the form frame (the print-fidelity guard)", () => {
    // Parse every text origin out of the content stream and prove it lands inside
    // the ruled frame. A value escaping the form is the defect this catches.
    const s = latin1(buildAuthorizationPdf(model).bytes);
    const origins = [...s.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => ({
      x: Number(m[1]),
      // The engine draws in bottom-left space: y_top = pageHeight - y_pdf.
      y: PAGE_HEIGHT - Number(m[2]),
    }));
    expect(origins.length).toBeGreaterThan(20); // captions + values were emitted

    for (const o of origins) {
      expect(o.x, `x=${o.x}`).toBeGreaterThanOrEqual(FRAME.x - 0.5);
      expect(o.x, `x=${o.x}`).toBeLessThanOrEqual(FRAME.x + FRAME.w + 0.5);
      expect(o.y, `y=${o.y}`).toBeGreaterThanOrEqual(FRAME.y - 0.5);
      expect(o.y, `y=${o.y}`).toBeLessThanOrEqual(FRAME.y + FRAME.h + 0.5);
    }
  });

  it("29 — the template registry version is ACTIVE and page-1 only", () => {
    const t = activeAuthorizationTemplate();
    expect(t?.status).toBe("ACTIVE");
    expect(t?.version).toBe(1);
    expect(EXPENSE_TEMPLATES.filter((x) => x.code === "EXPENSE_VOUCHER")).toHaveLength(0);
  });
});

// ============================ D. Lifecycle + write discipline (30-40) =======

describe("draft lifecycle — save/submit discipline", () => {
  it("30 — saving routes: head-in-place before the first version, versioned after", () => {
    expect(ACTIONS).toContain("export async function saveExpenseAuthorization");
    // The routing predicate IS the rule.
    expect(ACTIONS).toMatch(/if \(row\.current_version_id\) \{[\s\S]*createExpenseAuthorizationVersion\(id, input\)/);
  });

  it("31 — the in-place save is compare-and-set on the status", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function saveExpenseAuthorization"));
    expect(fn).toContain('.eq("status", row.status)');
  });

  it("32 — saving is refused outside the editable statuses", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function saveExpenseAuthorization"));
    expect(fn).toContain("AUTHORIZATION_EDITABLE_STATUSES.includes");
  });

  it("33 — « Montant en lettres » is DERIVED, never accepted from the client", () => {
    expect(ACTIONS).toContain("amountInWordsFr(");
    // The input contract does not expose it at all.
    expect(ACTIONS).not.toMatch(/amountInWords\?: string;[\s\S]{0,200}fileId/);
    expect(FORM).not.toMatch(/set\("amountInWords"/);
    expect(FORM).toContain("amountInWordsFr(");
  });

  it("34 — a re-derived amount cannot leave stale words behind", () => {
    const patch = ACTIONS.slice(ACTIONS.indexOf("function applyAuthorizationPatch"));
    expect(patch).toContain("amount_in_words: amountInWordsFr(amount, currency)");
  });

  it("35 — the typed « N° dossier » is resolved tenant-scoped, and an unknown one FAILS", () => {
    expect(ACTIONS).toContain("async function resolveFileLink");
    const fn = ACTIONS.slice(ACTIONS.indexOf("async function resolveFileLink"));
    expect(fn).toContain('.eq("tenant_id", tenantId)');
    expect(fn).toContain('.eq("file_number", wanted)');
    expect(fn).toContain('return "unknown_file"');
    // "" clears the link (a general administrative expense, DEC-C15).
    expect(fn).toContain("fileId: null");
  });

  it("36 — an explicit null CLEARS the dossier link (`??` alone never could)", () => {
    const patch = ACTIONS.slice(ACTIONS.indexOf("function applyAuthorizationPatch"));
    expect(patch).toContain("input.fileId !== undefined ? input.fileId : row.file_id");
  });

  it("37 — frozen versions record their template provenance", () => {
    const freeze = ACTIONS.slice(ACTIONS.indexOf("async function freezeAuthorizationVersion"));
    expect(freeze).toContain("template_code");
    expect(freeze).toContain("template_version");
    expect(freeze).toContain("activeTemplateVersion");
  });

  it("38 — submission still mints the number and freezes v1 (11.0B behaviour intact)", () => {
    const submit = ACTIONS.slice(ACTIONS.indexOf("export async function submitExpenseAuthorization"));
    expect(submit).toContain("next_expense_authorization_number");
    expect(submit).toContain("freezeAuthorizationVersion");
    expect(submit).toContain('.eq("status", row.status)');
  });

  it("39 — the new audit events exist and stay in the safe-metadata family", () => {
    expect(AuditActions.EXPENSE_AUTHORIZATION_UPDATED).toBe("finance.expense.authorization.updated");
    expect(AuditActions.EXPENSE_ATTACHMENT_ADDED).toBe("finance.expense.attachment.added");
    expect(AuditActions.EXPENSE_ATTACHMENT_RETIRED).toBe("finance.expense.attachment.retired");
    expect(AuditActions.EXPENSE_AUTHORIZATION_PDF_GENERATED).toBe("finance.expense.authorization.pdf_generated");
  });

  it("40 — no audit payload added in 11.0C carries money or beneficiary data", () => {
    const audited = [ACTIONS, ATTACHMENTS, PDF_ROUTE].join("\n");
    const payloads = [...audited.matchAll(/after: \{[^}]*\}/g)].map((m) => m[0]).join("\n");
    expect(payloads).not.toMatch(/\bamount\b|beneficiary|account_number|amount_in_words|registration/);
  });
});

// ================================ E. Attachments + migration (41-49) ========

describe("supporting documents (DEC-C22)", () => {
  it("41 — a DEDICATED table, never the dossier-bound `document`", () => {
    expect(MIGRATION).toMatch(/create table public\.expense_attachment/);
    expect(ATTACHMENTS).not.toMatch(/from\("document"\)/);
  });

  it("42 — its own private bucket, deny-by-default (no authenticated policies)", () => {
    expect(MIGRATION).toContain("'finance-expense', 'finance-expense', false");
    expect(MIGRATION).not.toMatch(/create policy .* on storage\.objects/);
    expect(ATTACHMENTS).toContain('EXPENSE_BUCKET = "finance-expense"');
  });

  it("43 — reuses the existing storage conventions rather than inventing new ones", () => {
    expect(ATTACHMENTS).toContain('from "@/lib/documents/storage"'); // fileExtension
    expect(ATTACHMENTS).toContain('from "@/lib/documents/validate"'); // MIME + size limits
    expect(ATTACHMENTS).toContain("createSignedUrl");
    expect(ATTACHMENTS).toContain("SIGNED_URL_TTL_SECONDS = 60");
  });

  it("44 — RLS: SELECT-only, tenant + finance:expense:read, NO portal policy", () => {
    expect(MIGRATION).toMatch(/create policy expense_attachment_select[\s\S]*for select to authenticated/);
    expect(MIGRATION).toContain("tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read')");
    expect(MIGRATION).toMatch(/grant select on public\.expense_attachment to authenticated;/);
    expect(MIGRATION).not.toMatch(/grant (insert|update|delete) on public\.expense_attachment/);
    // No portal exposure — checked against the SQL, not the prose that explains it.
    expect(sql(MIGRATION)).not.toMatch(/client_user|portal/i);
  });

  it("45 — one parent only, enforced by CHECK, and shaped for the 11.0D voucher", () => {
    expect(MIGRATION).toContain("constraint expense_attachment_one_parent check");
    expect(MIGRATION).toContain("voucher_id");
  });

  it("46 — tenant integrity reuses the 11.0B child trigger + an uploader check", () => {
    expect(MIGRATION).toContain("execute function public.enforce_expense_child_tenant()");
    expect(MIGRATION).toContain("enforce_expense_attachment_actor_tenant");
  });

  it("47 — the table is registered as tenant-scoped (the tenant-scope guard covers it)", () => {
    expect(TENANT_SCOPED_TABLES.has("expense_attachment")).toBe(true);
  });

  it("48 — retire, never delete (the archive-not-delete doctrine)", () => {
    expect(MIGRATION).toContain("retired_at");
    expect(ATTACHMENTS).toContain("export async function retireExpenseAttachment");
    expect(ATTACHMENTS).toMatch(/\.is\("retired_at", null\)/); // CAS on the retire
    // The only delete is the rollback of a failed upload's placeholder row.
    const deletes = [...ATTACHMENTS.matchAll(/\.delete\(\)/g)];
    expect(deletes).toHaveLength(1);
  });

  it("49 — evidence may only change while the document itself may change", () => {
    expect(ATTACHMENTS.match(/AUTHORIZATION_EDITABLE_STATUSES\.includes/g) ?? []).toHaveLength(2);
  });
});

describe("migration hygiene", () => {
  it("50 — the template v1 row is registered in the GLOBAL catalog, checksum NULL", () => {
    expect(MIGRATION).toContain("insert into public.expense_template");
    expect(MIGRATION).toContain("('EXPENSE_AUTHORIZATION', 1, null, 1, 'ACTIVE'");
  });

  it("51 — it modifies no existing table, permission, role or grant", () => {
    expect(MIGRATION).not.toMatch(/alter table public\.expense_authorization\b(?!.*enable)/);
    expect(MIGRATION).not.toMatch(/drop |truncate /i);
    expect(MIGRATION).not.toMatch(/insert into public\.permission\b/);
    expect(MIGRATION).not.toMatch(/insert into public\.role\b/);
    expect(MIGRATION).not.toMatch(/insert into public\.role_permission\b/);
  });

  it("52 — the RLS suite is wired into CI (a suite that never runs proves nothing)", () => {
    expect(CI).toContain("supabase/tests/rls_expense_attachments_test.sql");
  });
});

// ==================================== F. Surfaces (53-62) ===================

describe("routes, permissions and navigation", () => {
  it("53 — the register is gated on finance:expense:read", () => {
    expect(LIST_PAGE).toContain('hasPermission(permissions, "finance:expense:read")');
    expect(LIST_PAGE).toContain("notFound()");
  });

  it("54 — creating requires finance:expense:create at the route AND in the action", () => {
    expect(NEW_PAGE).toContain('hasPermission(permissions, "finance:expense:create")');
    expect(ACTIONS).toContain('guard("finance:expense:create")');
  });

  it("55 — submitting requires finance:expense:submit", () => {
    expect(ACTIONS).toContain('guard("finance:expense:submit")');
    expect(DETAIL_PAGE).toContain('hasPermission(permissions, "finance:expense:submit")');
  });

  it("56 — the PDF route re-checks the permission itself; navigation is never authorization", () => {
    expect(PDF_ROUTE).toContain('hasPermission(permissions, "finance:expense:export")');
    expect(PDF_ROUTE).toContain('return new NextResponse("Forbidden", { status: 403 })');
    expect(PDF_ROUTE).toContain('return new NextResponse("Not found", { status: 404 })');
  });

  it("57 — NO new permission is introduced anywhere in 11.0C", () => {
    const known = [
      "finance:expense:read",
      "finance:expense:create",
      "finance:expense:submit",
      "finance:expense:sign",
      "finance:expense:export",
      "finance:expense:execute",
    ];
    const surfaces = [LIST_PAGE, NEW_PAGE, DETAIL_PAGE, PDF_ROUTE, ACTIONS, ATTACHMENTS, READERS, NAV].join("\n");
    for (const code of [...surfaces.matchAll(/"(finance:expense:[a-z]+)"/g)].map((m) => m[1])) {
      expect(known, code).toContain(code);
    }
    // …and the catalog itself is untouched by this phase's migration.
    expect(MIGRATION).not.toContain("insert into public.permission");
  });

  it("58 — the sidebar entry is gated on the EFFECTIVE permission, not a role code", () => {
    expect(NAV).toContain('can("finance:expense:read")');
    expect(NAV).toContain('href: "/finance/autorisations-depenses"');
    expect(NAV).not.toMatch(/roleCodes.*FINANCE_OFFICER.*autorisations/);
  });

  it("59 — the route lives inside Finance, not at a temporary top level", () => {
    for (const src of [LIST_PAGE, NEW_PAGE, DETAIL_PAGE]) {
      expect(src).toContain('meta="Finance');
    }
    expect(NAV).toContain('href: "/finance/autorisations-depenses"');
  });

  it("60 — the detail page shows the signature section as DISPLAY-ONLY", () => {
    expect(DETAIL_PAGE).toContain("Visas et approbations");
    expect(DETAIL_PAGE).toContain("11.0D");
    // No signing action exists in this phase.
    expect(DETAIL_PAGE).not.toMatch(/signExpense|recordVisa|finance:expense:sign/);
  });

  it("61 — the unbound signers are surfaced honestly, never hidden (BLK-FIN-1/2)", () => {
    expect(DETAIL_PAGE).toContain("isUnboundVisaStep");
    expect(DETAIL_PAGE).toContain("Signataire non configuré");
  });

  it("62 — « Créer le Bon de Dépenses » appears only on APPROVED and stays disabled", () => {
    const actions = read("../components/finance/expense/authorization-actions.tsx");
    expect(actions).toMatch(/status === "APPROVED"[\s\S]{0,400}Créer le Bon de Dépenses/);
    expect(actions).toMatch(/disabled[\s\S]{0,400}Créer le Bon de Dépenses/);
    // Voucher creation itself is untouched by this phase.
    expect(actions).not.toContain("createExpenseVoucherFromAuthorization");
  });
});

describe("readers stay read-only and tenant-scoped", () => {
  it("63 — the new readers perform no mutation", () => {
    expect(READERS).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("64 — every new reader query filters on tenant_id", () => {
    const detail = READERS.slice(READERS.indexOf("getExpenseAuthorizationDetail"));
    const froms = (detail.match(/\.from\(/g) ?? []).length;
    const scoped = (detail.match(/\.eq\("tenant_id", ctx\.tenantId\)/g) ?? []).length;
    expect(scoped).toBeGreaterThanOrEqual(froms - 1); // the attachment reader shares the guard
    expect(READERS).toContain("export async function listExpenseAttachments");
  });

  it("65 — the attachment reader never exposes the storage path", () => {
    const fn = READERS.slice(READERS.indexOf("export async function listExpenseAttachments"));
    expect(fn).not.toContain("storage_path");
  });
});
