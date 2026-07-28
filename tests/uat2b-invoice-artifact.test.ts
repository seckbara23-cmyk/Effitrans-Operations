/**
 * UAT-2B — the official invoice as an immutable accounting artifact.
 *
 * The database invariants are proven on live Postgres by
 * `supabase/tests/rls_invoice_artifact_test.sql`. These tests cover the pure
 * renderer's determinism and the application contracts around it: one artifact,
 * never regenerated, one set of bytes shared by Finance, the portal and email.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  renderOfficialInvoice,
  formatMoney,
  INVOICE_RENDERER_VERSION,
  type InvoiceSnapshot,
} from "@/lib/finance/invoice-pdf";
import { invoiceFileName } from "@/lib/finance/invoice-artifact";
import { invoiceTotals } from "@/lib/finance/calc";
import { documentDoctrine, isInternalArtifact, isClientSafeDocument } from "@/lib/documents/doctrine";
import { artifactFeasibility, isGeneratableArtifact } from "@/lib/documents/artifacts/feasibility";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260728000001_invoice_artifact_and_charge_uniqueness.sql";
const ARTIFACT = "lib/finance/invoice-artifact.ts";
const SEND = "lib/finance/invoice-send.ts";
const ROUTE = "app/api/invoices/[id]/pdf/route.ts";

const SNAP: InvoiceSnapshot = {
  organizationName: "Effitrans SARL",
  invoiceNumber: "EFT-INV-2026-00001",
  issueDate: "2026-07-28",
  dueDate: "2026-08-27",
  currency: "XOF",
  customerName: "SENEGAL DISTRIBUTION DEMO SARL",
  fileNumber: "EFT-IMP-2026-00003",
  lines: [{ description: "Dédouanement et transport", quantity: 1, unitAmount: 750_000, taxRate: 0 }],
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ---------------------------------------------------------------------------
describe("the renderer is deterministic — the hash depends on it", () => {
  it("produces BYTE-IDENTICAL output for the same snapshot", () => {
    expect(sha(renderOfficialInvoice(SNAP))).toBe(sha(renderOfficialInvoice(SNAP)));
  });

  it("carries no clock and no randomness", () => {
    const src = code("lib/finance/invoice-pdf.ts");
    expect(src).not.toMatch(/new Date\(\)|Date\.now\(|Math\.random\(/);
  });

  it("avoids Intl, whose ICU-dependent output would break reproducibility", () => {
    const src = code("lib/finance/invoice-pdf.ts");
    expect(src).not.toContain("Intl.");
    expect(src).not.toContain("toLocaleString");
  });

  it("changes the bytes when any invoice value changes", () => {
    const base = sha(renderOfficialInvoice(SNAP));
    expect(sha(renderOfficialInvoice({ ...SNAP, invoiceNumber: "EFT-INV-2026-00002" }))).not.toBe(base);
    expect(sha(renderOfficialInvoice({ ...SNAP, customerName: "Autre" }))).not.toBe(base);
    expect(sha(renderOfficialInvoice({
      ...SNAP, lines: [{ ...SNAP.lines[0], unitAmount: 750_001 }],
    }))).not.toBe(base);
  });

  it("renders a real PDF", () => {
    const bytes = renderOfficialInvoice(SNAP);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("formats XOF money deterministically", () => {
    expect(formatMoney(750_000, "XOF")).toBe("750 000 XOF");
    expect(formatMoney(0, "XOF")).toBe("0 XOF");
    expect(formatMoney(1234.5, "XOF")).toBe("1 234,50 XOF");
    expect(formatMoney(-500, "XOF")).toBe("-500 XOF");
  });

  it("uses the SAME totals function as Finance and the portal", () => {
    expect(code("lib/finance/invoice-pdf.ts")).toContain("invoiceTotals(");
    expect(invoiceTotals(SNAP.lines.map((l) => ({ ...l }))).total).toBe(750_000);
  });

  it("prints NO payment status — v1 is the invoice AS ISSUED", () => {
    const src = code("lib/finance/invoice-pdf.ts");
    expect(src).not.toMatch(/Payée|amountPaid|balanceDue|paidAmount/);
  });

  it("omits unconfigured legal identity rather than inventing it", () => {
    const bare = renderOfficialInvoice({ ...SNAP, organizationIdentifiers: [], paymentDetails: [] });
    const text = new TextDecoder("latin1").decode(bare);
    for (const invented of ["NINEA", "RC/", "IBAN", "N/A", "XXXX"]) {
      expect(text).not.toContain(invented);
    }
  });
});

// ---------------------------------------------------------------------------
describe("OFFICIAL_INVOICE is strictly separate from COMMERCIAL_INVOICE", () => {
  it("both exist and are different document types", () => {
    expect(documentDoctrine("OFFICIAL_INVOICE")).not.toBeNull();
    expect(documentDoctrine("COMMERCIAL_INVOICE")).not.toBeNull();
  });

  it("the official invoice is an internal artifact; the commercial one is external evidence", () => {
    expect(isInternalArtifact("OFFICIAL_INVOICE")).toBe(true);
    expect(isInternalArtifact("COMMERCIAL_INVOICE")).toBe(false);
  });

  it("they sit at different stages and neither is required evidence", () => {
    expect(documentDoctrine("OFFICIAL_INVOICE")?.earliestStage).toBe("finance");
    expect(documentDoctrine("COMMERCIAL_INVOICE")?.earliestStage).toBe("documentation");
  });

  it("the official invoice is client-safe — the customer is its addressee", () => {
    expect(isClientSafeDocument("OFFICIAL_INVOICE")).toBe(true);
  });

  it("nothing in the artifact path ever falls back to COMMERCIAL_INVOICE", () => {
    for (const f of [ARTIFACT, SEND, ROUTE]) {
      expect(code(f), f).not.toContain("COMMERCIAL_INVOICE");
    }
  });

  it("is generatable, with its source rationale recorded", () => {
    expect(isGeneratableArtifact("OFFICIAL_INVOICE")).toBe(true);
    expect(artifactFeasibility("OFFICIAL_INVOICE")?.verdict).toBe("GENERATABLE_NOW");
  });
});

// ---------------------------------------------------------------------------
describe("generated once, never regenerated", () => {
  it("issuance generates automatically — no separate Generate button", () => {
    const src = code("lib/finance/actions.ts");
    const fn = src.slice(src.indexOf("export async function issueInvoice"), src.indexOf("export async function voidInvoice"));
    expect(fn).toContain("ensureOfficialInvoiceArtifact");
    // …and after the number is allocated, so the PDF carries the official number
    expect(fn.indexOf("ensureOfficialInvoiceArtifact")).toBeGreaterThan(fn.indexOf("next_invoice_number"));
  });

  it("a generation failure does not roll back issuance", () => {
    const src = code("lib/finance/actions.ts");
    expect(src).toMatch(/ensureOfficialInvoiceArtifact\([\s\S]{0,220}\}\)\.catch\(\(\) => null\)/);
  });

  it("the service returns the existing artifact instead of rendering again", () => {
    const src = code(ARTIFACT);
    expect(src).toMatch(/if \(existing\) \{[\s\S]{0,260}already: true,/);
    // the early return happens BEFORE any render
    expect(src.indexOf("if (existing)")).toBeLessThan(src.indexOf("renderOfficialInvoice("));
  });

  it("a DRAFT has no accounting document", () => {
    expect(code(ARTIFACT)).toContain('invoice.status === "DRAFT"');
  });

  it("the database makes a second artifact impossible", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toContain("create unique index uq_document_official_invoice");
    expect(sql).toMatch(/if v_existing is not null then[\s\S]{0,200}'already', true/);
  });

  it("it never supersedes — unlike finalize_generated_artifact", () => {
    const sql = sqlCode(MIGRATION);
    const fn = sql.slice(sql.indexOf("create or replace function public.finalize_official_invoice"));
    expect(fn).not.toContain("superseded_by_id = ");
    expect(fn).not.toContain("SUPERSEDED");
    expect(fn).toContain("'VERIFIED', 1,");
  });

  it("the artifact is immutable and undeletable", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toContain("protect_official_invoice_artifact");
    expect(sql).toMatch(/new\.content_sha256 is distinct from old\.content_sha256/);
    expect(sql).toMatch(/new\.deleted_at is distinct from old\.deleted_at/);
  });

  it("passes ordinary documents through on DELETE (the NEW-is-NULL trap)", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toMatch(/if tg_op = 'DELETE' then\s*\n\s*return old;/);
  });
});

// ---------------------------------------------------------------------------
describe("one artifact, three delivery paths", () => {
  it("Finance, the portal and the email all resolve the same artifact", () => {
    // Finance UI + portal detail both link the protected route…
    expect(code("components/finance/invoice-card.tsx")).toContain("/api/invoices/${invoice.id}/pdf");
    expect(code("app/portal/(app)/invoices/[id]/page.tsx")).toContain("/api/invoices/${inv.id}/pdf");
    // …and the route and the email both go through the same resolver.
    expect(code(ROUTE)).toContain("ensureOfficialInvoiceArtifact");
    expect(code(SEND)).toContain("ensureOfficialInvoiceArtifact");
  });

  it("sending attaches the STORED bytes and never renders", () => {
    const src = code(SEND);
    expect(src).toContain("DOCUMENTS_BUCKET");
    expect(src).toContain(".download(artifact.storagePath)");
    expect(src).not.toContain("renderOfficialInvoice");
  });

  it("the filename is the official number", () => {
    expect(invoiceFileName("EFT-INV-2026-00001")).toBe("EFT-INV-2026-00001.pdf");
    expect(code(ROUTE)).toContain("invoiceFileName(");
  });

  it("resend is permitted and records the delivered hash", () => {
    const src = code(SEND);
    expect(src).toContain("INVOICE_SENT");
    expect(src).toContain("content_sha256: artifact.contentSha256");
    expect(src).toContain("resend");
  });

  it("a failed send is recorded and stays retryable", () => {
    expect(code(SEND)).toContain("INVOICE_SEND_FAILED");
  });

  it("a draft can never be sent", () => {
    expect(code(SEND)).toMatch(/invoice\.status === "DRAFT"[\s\S]{0,80}not_issued/);
  });

  it("email attachments are additive — existing callers are untouched", () => {
    const p = code("lib/comms/provider.ts");
    expect(p).toContain("attachments?: readonly");
    expect(p).toMatch(/email\.attachments && email\.attachments\.length > 0/);
  });
});

// ---------------------------------------------------------------------------
describe("download authorization", () => {
  const r = () => code(ROUTE);

  it("requires a session", () => {
    expect(r()).toMatch(/if \(!staff && !portal\)[\s\S]{0,90}401/);
  });

  it("is tenant-scoped with a uniform 404", () => {
    expect(r()).toContain('.eq("tenant_id", tenantId)');
    expect(r()).toMatch(/if \(!invoice\) return NextResponse\.json\(\{ error: "not_found" \}, \{ status: 404 \}\)/);
  });

  it("staff need finance:read", () => {
    expect(r()).toContain('hasPermission(permissions, "finance:read")');
  });

  it("a portal user may read only their OWN client's invoice", () => {
    expect(r()).toMatch(/invoice\.client_id !== portal\.clientId[\s\S]{0,120}404/);
  });

  it("streams the bytes — no signed URL, no public link", () => {
    const src = r();
    expect(src).toContain(".download(");
    expect(src).not.toContain("createSignedUrl");
    expect(src).toContain('"Cache-Control": "private, no-store"');
  });

  it("stays available after payment, cancellation, closure and archival", () => {
    // The ONLY status refusal is DRAFT.
    const src = r();
    expect(src).toMatch(/invoice\.status === "DRAFT"/);
    for (const s of ["PAID", "VOID", "PARTIALLY_PAID", "CLOSED", "ARCHIVED"]) {
      expect(src).not.toContain(`=== "${s}"`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the customer portal reuses the finance model", () => {
  it("duplicates no money calculation", () => {
    const src = code("lib/portal/docs-service.ts");
    expect(src).toContain("invoiceTotals(");
    expect(src).toContain("paidAmount(");
    expect(src).toContain("balanceDue(");
    // no hand-rolled arithmetic standing in for the calculator
    expect(src).not.toMatch(/total\s*=\s*lines\.reduce/);
  });

  it("no parallel portal invoice model was introduced", () => {
    // UAT-2B nearly added lib/portal/invoices.ts; the existing docs-service
    // already was the model, so the duplicate was removed.
    let exists = true;
    try { read("lib/portal/invoices.ts"); } catch { exists = false; }
    expect(exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("scope discipline", () => {
  it("the renderer version is pinned", () => {
    expect(INVOICE_RENDERER_VERSION).toBe("uat2b-1");
  });

  it("no credit-note implementation was started", () => {
    const all = code(ARTIFACT) + code(SEND) + code("lib/finance/actions.ts");
    expect(all).not.toMatch(/credit_note|creditNote|avoir/i);
  });

  it("reuses the existing PDF primitive rather than a new engine", () => {
    expect(code("lib/finance/invoice-pdf.ts")).toContain('from "@/lib/reports/pdf"');
  });
});
