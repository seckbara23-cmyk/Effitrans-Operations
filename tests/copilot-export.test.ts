import { describe, it, expect } from "vitest";
import { wrapText, answerToPdfBytes, answerToRtf, answerToEml, exportFilename } from "@/lib/copilot/export";

describe("wrapText", () => {
  it("keeps a short line intact", () => {
    expect(wrapText("un deux trois", 1000, 10)).toEqual(["un deux trois"]);
  });
  it("preserves explicit newlines including blank lines", () => {
    expect(wrapText("Ligne A\n\nLigne B", 1000, 10)).toEqual(["Ligne A", "", "Ligne B"]);
  });
  it("wraps when the content exceeds the width", () => {
    const lines = wrapText("mot ".repeat(60).trim(), 120, 10);
    expect(lines.length).toBeGreaterThan(1);
    // no wrapped line should be blank in the middle
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });
});

describe("answerToPdfBytes", () => {
  it("produces a valid PDF byte stream", () => {
    const bytes = answerToPdfBytes("Résumé du dossier.\nLivraison non planifiée.", { title: "Réponse" });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 8));
    expect(head).toContain("%PDF");
    const tail = new TextDecoder("latin1").decode(bytes.slice(-8));
    expect(tail).toContain("%%EOF");
  });
});

describe("answerToRtf", () => {
  it("emits an RTF document with an escaped accented character", () => {
    const rtf = answerToRtf("Café livré à Dakar.", { title: "Réponse" });
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(rtf).toContain("\\u233"); // é
    expect(rtf.trimEnd().endsWith("}")).toBe(true);
  });
  it("converts newlines to \\par", () => {
    expect(answerToRtf("a\nb")).toContain("\\par");
  });
});

describe("answerToEml", () => {
  it("emits an unsent plain-text draft with UTF-8 content", () => {
    const eml = answerToEml("Bonjour,\nVotre dossier avance.", { subject: "Mise à jour" });
    expect(eml).toContain("X-Unsent: 1");
    expect(eml).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(eml).toContain("Content-Transfer-Encoding: 8bit");
    // Non-ASCII subject is RFC 2047 encoded.
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(eml).toContain("Votre dossier avance.");
    // CRLF line endings in the body.
    expect(eml).toContain("Bonjour,\r\nVotre dossier avance.");
  });
  it("leaves an ASCII subject unencoded", () => {
    expect(answerToEml("x", { subject: "Update" })).toContain("Subject: Update");
  });
});

describe("exportFilename", () => {
  it("builds a safe stem", () => {
    expect(exportFilename("EFT-IMP-2099-00001")).toBe("copilote-EFT-IMP-2099-00001");
    expect(exportFilename(null)).toBe("copilote-dossier");
    expect(exportFilename("a b/c")).toBe("copilote-a-b-c");
  });
});
