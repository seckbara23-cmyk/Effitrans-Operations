/**
 * WP1 closure hardening — the two findings left open by the independent
 * re-review of PR #51, fixed before inbound-mail access can be granted
 * (DEC-CEO-20 stays pending; nothing here grants it).
 *
 *   N-1  the inbound e-mail reduction was super-linear on hostile input, and
 *        read the whole stored body first. It is now linear and bounded.
 *   R-1  the EMP-4 attachment lookup named the dossier an attachment was filed
 *        on to anyone holding the inbox permission. It now names it only to
 *        someone who can see that dossier — the rule F-5 gave the message lookup.
 *   #162 audit_log refuses TRUNCATE (statement trigger + REVOKE). Its behaviour
 *        is proved by supabase/tests/rls_audit_log_truncate_test.sql; these pins
 *        keep the migration, its verifier and the CI step in the shape that
 *        test and the verifier-robustness rule rely on.
 *   walk the promotion walk's baseline always leaves a migration to promote.
 *
 * The lookups are exercised for real, with their collaborators mocked: the
 * negative cases are behaviour, not a reading of the source.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  user: { id: "user-1", tenantId: "tenant-A", email: "u@test.local" },
  permissions: ["communication:inbound:read"] as string[],
  visible: true,
  probe: true,
  attachment: null as { id: string; fileId: string } | null,
  message: null as { id: string; fileId: string } | null,
  calls: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => h.user }));
vi.mock("@/lib/rbac/permissions", () => ({
  getEffectivePermissions: async () => h.permissions,
  hasPermission: (perms: string[], code: string) => perms.includes(code),
}));
vi.mock("@/lib/authz/visibility", () => ({
  isFileVisible: async (userId: string, tenantId: string, fileId: string) => {
    h.calls.push(`visible:${userId}:${tenantId}:${fileId}`);
    return h.visible;
  },
}));
vi.mock("@/lib/audit/log", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabaseClient: () => ({}) }));
vi.mock("@/lib/ec/ingest/service", () => ({
  loadAttachment: async () => null,
  ingestAttachment: async () => ({ ok: false, error: "not_found" }),
  findIngestedDocument: async (tenantId: string, attachmentId: string) => {
    h.calls.push(`findAttachment:${tenantId}:${attachmentId}`);
    return h.attachment;
  },
}));
vi.mock("@/lib/ec/ingest/message-service", () => ({
  INSTRUCTION_TYPE_CODE: "ORDRE_DE_TRANSIT",
  loadInboundMessage: async () => null,
  ingestMessage: async () => ({ ok: false, error: "not_found" }),
  findIngestedMessageDocument: async (tenantId: string, messageId: string) => {
    h.calls.push(`findMessage:${tenantId}:${messageId}`);
    return h.message;
  },
}));
vi.mock("@/lib/ec/ingest/message-provenance-160", () => ({ messageProvenanceStored: async () => h.probe }));

const { lookupIngestedDocument } = await import("@/lib/ec/ingest/actions");
const { lookupIngestedMessage } = await import("@/lib/ec/ingest/message-actions");
const {
  MAX_BODY_CHARS,
  MAX_SOURCE_CHARS,
  MESSAGE_RENDERER_VERSION,
  bodyFor,
  htmlToText,
  normalizeText,
} = await import("@/lib/ec/ingest/message-render");

beforeEach(() => {
  h.permissions = ["communication:inbound:read"];
  h.visible = true;
  h.probe = true;
  h.attachment = { id: "doc-1", fileId: "file-X" };
  h.message = { id: "doc-2", fileId: "file-Y" };
  h.calls = [];
});

describe("R-1 — the attachment lookup names the dossier only to someone who can see it", () => {
  it("names it to a reader of the dossier", async () => {
    await expect(lookupIngestedDocument("att-1")).resolves.toEqual({ id: "doc-1", fileId: "file-X" });
    expect(h.calls).toEqual(["findAttachment:tenant-A:att-1", "visible:user-1:tenant-A:file-X"]);
  });

  it("does NOT name it to someone who cannot see the dossier — only that it was filed", async () => {
    h.visible = false;
    await expect(lookupIngestedDocument("att-1")).resolves.toEqual({ id: "doc-1", fileId: null });
  });

  it("answers nothing without the inbox permission, and never looks", async () => {
    h.permissions = ["document:create"];
    await expect(lookupIngestedDocument("att-1")).resolves.toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("asks visibility only about a dossier that exists, and only within the caller's tenant", async () => {
    h.attachment = null;
    await expect(lookupIngestedDocument("att-1")).resolves.toBeNull();
    expect(h.calls).toEqual(["findAttachment:tenant-A:att-1"]);
  });
});

describe("F-5 — the message lookup, same rule (regression)", () => {
  it("names the dossier to a reader, hides it from anyone else", async () => {
    await expect(lookupIngestedMessage("msg-1")).resolves.toEqual({ id: "doc-2", fileId: "file-Y" });
    h.visible = false;
    await expect(lookupIngestedMessage("msg-1")).resolves.toEqual({ id: "doc-2", fileId: null });
  });

  it("answers nothing without the permission or before migration #160", async () => {
    h.permissions = [];
    await expect(lookupIngestedMessage("msg-1")).resolves.toBeNull();
    h.permissions = ["communication:inbound:read"];
    h.probe = false;
    await expect(lookupIngestedMessage("msg-1")).resolves.toBeNull();
    expect(h.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------- N-1 --

/** The wp1d-2 reducer, verbatim: the linear one must give the same text on well-formed HTML. */
const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", eacute: "é", egrave: "è", ecirc: "ê",
  agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", euml: "ë",
  Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", laquo: "«", raquo: "»", euro: "€", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", bull: "•",
};
function referenceHtmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(script|style|head|noscript|template)\b[^>]*\/?>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|ul|ol)\s*>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "• ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n < 0x20 || n > 0x10ffff) return " ";
      return String.fromCodePoint(n);
    }
    return ENTITIES[code] ?? m;
  });
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

describe("N-1 — the inbound e-mail reduction is linear and bounded", () => {
  it("gives the same text as before on well-formed HTML (seeded generated corpus)", () => {
    let seed = 20261023;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
    const WORDS = ["Bonjour", "dédouanement", "MSKU1234567", "&amp;", "&eacute;t&eacute;", "&#233;", "&#x20AC;",
      "&nbsp;", "PO-4500123", "«&nbsp;urgent&nbsp;»", "a &lt; b", "x > y", "  ", "\t", "🙂", "日本",
      // « İ » lower-cases to TWO code units: the corpus that missed the
      // index-drift defect had none (closure security review, HIGH)
      "İstanbul", "DİYARBAKIR", "İİİ", "ǅ", "ẞ"];
    const text = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(pick([" ", "", "\n"]));
    const el = (depth: number): string => {
      if (depth > 3 || rnd() < 0.3) return text(1 + Math.floor(rnd() * 6));
      const kind = pick(["p", "div", "span", "b", "a", "li", "ul", "table", "tr", "td", "h1", "h3", "blockquote",
        "br", "img", "script", "style", "comment", "head", "noscript", "template", "STYLE", "Script"] as const);
      const kids = () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => el(depth + 1)).join("");
      switch (kind) {
        case "br": return pick(["<br>", "<br/>", "<br />", "<BR>"]);
        case "img": return `<img src="https://x.example/p.png" alt="logo">`;
        case "comment": return `<!-- ${text(3)} -->`;
        case "script": case "Script": return `<${kind} type="text/javascript">var a = 1 < 2;</${kind.toLowerCase()} >`;
        case "style": case "STYLE": return `<${kind}>p { color: red } /* <b> */</${kind}>`;
        case "head": case "noscript": case "template": return `<${kind}><title>${text(2)}</title></${kind}>`;
        default: return `<${kind} class="c${Math.floor(rnd() * 9)}">${kids()}</${kind}>`;
      }
    };
    for (let n = 0; n < 400; n++) {
      const html = `<html><body>${Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => el(0)).join("\n")}</body></html>`;
      expect(htmlToText(html)).toBe(referenceHtmlToText(html));
    }
  });

  it("keeps a literal '<' that opens no tag (« a < b », « <3 ») — the old reducer deleted up to the next '>'", () => {
    expect(htmlToText("<p>montant a < b et c > d</p><p>fin</p>")).toBe("montant a < b et c > d\nfin");
    expect(htmlToText("<div><3 merci</div>")).toBe("<3 merci");
  });

  it("never shifts a cut on a character whose lower case is longer (« İ », U+0130)", () => {
    expect(htmlToText("İstanbul <style>p{}</style>Bonjour tout le monde")).toBe("İstanbul Bonjour tout le monde");
    expect(htmlToText("İ".repeat(10) + "<script>x</script><p>Texte</p>")).toBe("İ".repeat(10) + "Texte");
    // with the drift, the tail of the script body surfaced as prose and « gras » was lost
    expect(htmlToText("İ".repeat(30) + "<script>a(1)</script><b>gras</b> fin")).toBe("İ".repeat(30) + "gras fin");
    for (const k of [1, 7, 200]) {
      const html = "İ".repeat(k) + "<STYLE>.x{}</style>" + "phrase cachée? non: visible";
      expect(htmlToText(html)).toBe("İ".repeat(k) + "phrase cachée? non: visible");
      expect(htmlToText(html)).toBe(referenceHtmlToText(html));
    }
  });

  it("no code point, in any number, moves a cut: every BMP character before a raw-text element", () => {
    // The property the HIGH finding broke: the folded copy searched for closing
    // tags must index the original exactly. Checked end to end, not on a helper.
    const bad: string[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      const c = String.fromCharCode(cp);
      // mixed markers: no character repeated three times can spell one
      const out = htmlToText(c.repeat(3) + "<style>Qw7</style><Script>Rv8</SCRIPT>Zy9");
      if (out.includes("Qw7") || out.includes("Rv8") || !out.endsWith("Zy9")) bad.push(cp.toString(16));
    }
    expect(bad).toEqual([]);
  });

  it("at the source cap: an element closed past the cut is removed, one never closed is kept", () => {
    // a well-formed script straddling the cut: its body is not prose
    const straddling = "<p>vu</p><script>" + "s".repeat(MAX_SOURCE_CHARS) + "</script><p>après</p>";
    expect(bodyFor({ textBody: null, htmlBody: straddling })).toMatchObject({ text: "vu", truncated: true });
    // the closing tag split by the cut itself
    const split = "<p>vu</p><script>" + "x".repeat(MAX_SOURCE_CHARS - 22) + "</scr" + "ipt><p>après</p>";
    expect(split.slice(0, MAX_SOURCE_CHARS).endsWith("</scr")).toBe(true);
    expect(bodyFor({ textBody: null, htmlBody: split }).text).toBe("vu");
    // never closed anywhere: the evidence rule keeps the text (only the tag goes)
    const never = "<p>vu</p><script>" + "texte ".repeat(MAX_SOURCE_CHARS / 6 + 10);
    expect(bodyFor({ textBody: null, htmlBody: never }).text.startsWith("vu\ntexte texte")).toBe(true);
    // under the cap nothing changes: an unclosed element loses only its tag
    expect(htmlToText("<p>vu</p><script>reste visible")).toBe("vu\nreste visible");
  });

  it("at the source cap: the unread rest is searched too, not only the seam", () => {
    // the closing tag lies far past the cut — outside the 32-character seam —
    // so only the search of the rest can find it (re-review: this branch was
    // untested, and a mutant that skipped it passed)
    const far = "<p>vu</p><script>" + "s".repeat(MAX_SOURCE_CHARS) + "t".repeat(5_000) + "</script><p>après</p>";
    expect(bodyFor({ textBody: null, htmlBody: far }).text).toBe("vu");
    const farStyle = "<p>vu</p><STYLE>" + "s".repeat(MAX_SOURCE_CHARS) + "t".repeat(5_000) + "</Style ><p>après</p>";
    expect(bodyFor({ textBody: null, htmlBody: farStyle }).text).toBe("vu");
    // a closing tag of ANOTHER element in the rest does not count
    const other = "<p>vu</p><script>" + "texte ".repeat(MAX_SOURCE_CHARS / 6 + 10) + "</style>";
    expect(bodyFor({ textBody: null, htmlBody: other }).text.startsWith("vu\ntexte texte")).toBe(true);
  });

  it("reads end tags as the HTML tokenizer does: `</style x>` closes, `</stylex>` and NBSP do not", () => {
    // `</style x>` closes the element in every browser, so the prose after it
    // is visible mail; the old rule `</name\s*>` hid it up to the next `</style>`
    expect(htmlToText("<style>.a{}</style x><p>Instruction : payer 5000</p><style>b{}</style>fin")).toBe(
      "Instruction : payer 5000\nfin",
    );
    expect(htmlToText("<script>a()</script/><p>visible</p>")).toBe("visible");
    expect(htmlToText("<script>a()</script\t\n>visible")).toBe("visible");
    // not end tags of the element: the content runs on to the real one
    expect(htmlToText("<style>a</stylex>b</style>c")).toBe("c");
    expect(htmlToText("<style>a</style >b</style>c")).toBe("c");
  });

  it("at the source cap: a comment closed past the cut goes; one never closed stays as text", () => {
    const far = "<p>vu</p><!--" + "s".repeat(MAX_SOURCE_CHARS) + "-->" + "<p>après</p>";
    expect(bodyFor({ textBody: null, htmlBody: far }).text).toBe("vu");
    const split = "<p>vu</p><!--" + "x".repeat(MAX_SOURCE_CHARS - 13 - 1) + "-->" + "<p>après</p>";
    expect(split.slice(0, MAX_SOURCE_CHARS).endsWith("-")).toBe(true);
    expect(bodyFor({ textBody: null, htmlBody: split }).text).toBe("vu");
    const never = "<p>vu</p><!-- " + "texte ".repeat(MAX_SOURCE_CHARS / 6 + 10);
    expect(bodyFor({ textBody: null, htmlBody: never }).text.startsWith("vu\n<!-- texte texte")).toBe(true);
    // a comment that ran to the cut must not let the raw-text rule read a seam
    // that is no longer at the cut: "</sc" (before the comment) + "ript>" (after
    // the cut) is not a closing tag in the message — the old reducer, on the
    // whole body, kept "a()</sc" too
    const both = "<p>vu</p><script>a()</sc" + "<!--" + "z".repeat(MAX_SOURCE_CHARS - 28) + "ript>-->";
    expect(both.slice(MAX_SOURCE_CHARS)).toBe("ript>-->");
    expect(bodyFor({ textBody: null, htmlBody: both }).text).toBe("vu\na()</sc");
  });

  it("stays linear when many unclosed openers meet a large unread rest", () => {
    const rep = (u: string, n: number) => u.repeat(Math.ceil(n / u.length)).slice(0, n);
    for (const [name, html] of [
      ["'<script ' × cap + 3 MB rest", rep("<script ", MAX_SOURCE_CHARS) + "y".repeat(3_000_000)],
      ["'<STYLE ' × cap + whitespace rest", rep("<STYLE ", MAX_SOURCE_CHARS) + "</style" + " ".repeat(2_000_000)],
      ["'İ<style ' × cap", rep("İ<style ", MAX_SOURCE_CHARS) + "</style>"],
    ] as const) {
      const t0 = performance.now();
      bodyFor({ textBody: null, htmlBody: html });
      expect(performance.now() - t0, name).toBeLessThan(500);
    }
  });

  it("is linear on every hostile shape, up to the source cap", () => {
    const rep = (u: string, n: number) => u.repeat(Math.ceil(n / u.length)).slice(0, n);
    const N = 200_000;
    const shapes: [string, string][] = [
      ["unclosed '<'", rep("<a", N)],
      ["unclosed '<script '", rep("<script ", N)],
      ["unclosed '<!--'", rep("<!-- x", N)],
      ["unclosed '<br'", rep("<br ", N)],
      ["unclosed '<li'", rep("<li ", N)],
      ["closing-tag lookalikes", "<script>" + rep("</script x", N)],
      ["closing tag + whitespace runs", "<script>" + rep("</script" + " ".repeat(50), N)],
    ];
    for (const [name, html] of shapes) {
      const t0 = performance.now();
      htmlToText(html);
      // the quadratic version took ~3 s for 100 KB of unclosed '<' (measured)
      expect(performance.now() - t0, name).toBeLessThan(500);
    }
    const t1 = performance.now();
    normalizeText(" ".repeat(N) + "x");
    expect(performance.now() - t1, "whitespace run").toBeLessThan(500);
  });

  it("trims trailing whitespace exactly as before (trimEnd ≡ \\s+$)", () => {
    for (const line of ["a  ", "a\t\t", "a   ", "  ", "a　", "x  "]) {
      expect(normalizeText(line)).toBe(line.replace(/\s+$/g, "").trim());
    }
  });

  it("reads at most MAX_SOURCE_CHARS of the stored body, and says so", () => {
    const html = "<p>" + "x".repeat(MAX_SOURCE_CHARS * 2) + "</p>";
    const b = bodyFor({ textBody: null, htmlBody: html });
    expect(b.truncated).toBe(true);
    expect(b.text.length).toBe(MAX_BODY_CHARS);
    const short = bodyFor({ textBody: null, htmlBody: "<p>court</p>" + " ".repeat(MAX_SOURCE_CHARS) });
    expect(short.truncated).toBe(true); // the source was cut even though the text is short
    expect(bodyFor({ textBody: "court", htmlBody: null }).truncated).toBe(false);
    expect(MESSAGE_RENDERER_VERSION).toBe("wp1d-3");
  });
});

const ROOT = join(__dirname, "..");
const readRepo = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

describe("#162 — audit_log refuses TRUNCATE without touching its write path", () => {
  const M = "supabase/migrations/20261023000001_audit_log_truncate_guard.sql";
  const V = "supabase/verifiers/20261023000001_audit_log_truncate_guard.verify.sql";
  const T = "supabase/tests/rls_audit_log_truncate_test.sql";

  it("installs a BEFORE TRUNCATE statement trigger on prevent_mutation()", () => {
    const sql = stripSqlComments(readRepo(M));
    expect(sql).toMatch(
      /create or replace trigger trg_audit_log_no_truncate\s+before truncate on public\.audit_log\s+for each statement execute function public\.prevent_mutation\(\);/,
    );
    expect(readRepo(M).split("\n")[0]).toBe("-- migrate:executor db-query");
    // the lightest lock that installs a trigger on a hot table: never DROP it first
    expect(sql).not.toMatch(/drop trigger/i);
  });

  it("revokes TRUNCATE and nothing else — INSERT and SELECT stay where they are", () => {
    const sql = stripSqlComments(readRepo(M));
    const revokes = sql.match(/\brevoke\b[^;]*;/gi) ?? [];
    expect(revokes).toEqual(["revoke truncate on public.audit_log from public, anon, authenticated, service_role;"]);
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into\s+)?public\.audit_log\b/i);
    expect(sql).not.toMatch(/\bdisable\s+(row level security|trigger)\b/i);
  });

  it("the verifier asserts the trigger, never the absence of a grant (CI-REPAIR-02)", () => {
    const sql = stripSqlComments(readRepo(V));
    expect(sql).toContain("trg_audit_log_no_truncate");
    expect(sql).toContain("prevent_mutation");
    expect(sql).not.toMatch(/has_table_privilege/i);
  });

  it("CI runs the behavioural test, and the test reaches the trigger through CASCADE", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    expect(ci).toContain("-f supabase/tests/rls_audit_log_truncate_test.sql");
    // after the WP1 suite, before the journey fixture grants service_role DML
    expect(ci.indexOf("rls_audit_log_truncate_test.sql")).toBeGreaterThan(ci.indexOf("rls_wp1_opening_test.sql"));
    expect(ci.indexOf("rls_audit_log_truncate_test.sql")).toBeLessThan(ci.indexOf("journey_identities.sql"));
    const test = stripSqlComments(readRepo(T));
    // expense_visa's foreign key refuses a plain TRUNCATE before any trigger
    // runs, so only CASCADE proves the guard
    expect(test).toMatch(/truncate public\.audit_log cascade;/);
    expect(test).toMatch(/^begin;/m);
    expect(test).toMatch(/^rollback;/m);
  });

  it("build-info names #162 as the latest migration", () => {
    const info = readRepo("lib/platform/ops/build-info.ts");
    expect(info).toContain('LATEST_MIGRATION = "20261023000001_audit_log_truncate_guard"');
    expect(info).toContain("MIGRATION_COUNT = 162");
  });
});

describe("walk — the promotion walk always has a migration to promote", () => {
  it("names a real repository migration strictly older than the newest one", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    const m = ci.match(/migration-promotion-walk\.mjs[\s\S]*?--baseline (\d{14})/);
    expect(m).not.toBeNull();
    const baseline = m![1];
    const versions = readdirSync(join(ROOT, "supabase", "migrations"))
      .map((f) => /^(\d{14})_.*\.sql$/.exec(f)?.[1])
      .filter((v): v is string => !!v)
      .sort();
    expect(versions).toContain(baseline);
    expect(baseline < versions[versions.length - 1]).toBe(true);
  });

  it("the policy says when it moves: in the PR that adds a migration, not after a deploy", () => {
    const policy = readRepo("docs/migration-policy.md");
    expect(policy).toContain("advance the promotion walk in the PR that adds a migration");
    expect(policy).toContain("Do not advance the promotion walk’s baseline after a deploy");
  });
});
