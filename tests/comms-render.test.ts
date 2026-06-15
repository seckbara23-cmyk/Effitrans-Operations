import { describe, it, expect } from "vitest";
import { escapeHtml, renderTemplate } from "@/lib/comms/render";

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`<script>"x"&'y'`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
  });
});

describe("renderTemplate", () => {
  it("interpolates subject/text (plain) and escapes html values", () => {
    const r = renderTemplate("invoice_issued", {
      clientName: "Dakar Trading",
      invoiceNumber: "EFT-INV-2026-00001",
      total: "100 000 XOF",
      dueDate: "2026-07-01",
      portalLink: "https://app/portal/invoices/1",
    });
    expect(r.subject).toBe("Facture EFT-INV-2026-00001 — Effitrans");
    expect(r.text).toContain("Dakar Trading");
    expect(r.text).toContain("100 000 XOF");
    expect(r.html).toContain("EFT-INV-2026-00001");
    expect(r.html).toContain("Effitrans — Transit"); // brand wrapper
  });

  it("HTML-escapes interpolated values (injection-safe)", () => {
    const r = renderTemplate("document_shared", {
      clientName: '<img src=x onerror=alert(1)>',
      documentType: "BL",
      fileNumber: "EFT-IMP-2026-00001",
      portalLink: "https://app/portal/documents",
    });
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).toContain("&lt;img src=x");
    // text body is plain (not HTML) so it is not escaped
    expect(r.text).toContain("<img src=x");
  });

  it("missing variables render as empty", () => {
    const r = renderTemplate("pod_received", { fileNumber: "EFT-IMP-2026-00001" });
    expect(r.html).toContain("EFT-IMP-2026-00001");
    expect(r.subject).toBe("Preuve de livraison reçue — dossier EFT-IMP-2026-00001");
  });
});
