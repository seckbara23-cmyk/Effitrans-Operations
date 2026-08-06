/**
 * EMP-2 — RFC 5322 thread correlation.
 *
 * Unlike EMP-1, the heart of this phase is an ALGORITHM, so most of these are
 * behavioural tests over the pure resolver. The structural checks that remain
 * guard the properties source alone can prove: no migration, no second model,
 * no write path, no outbound.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeMessageId, parseReferences, resolveThreads, linkedIdentifiers, threadIdOf,
  type ThreadInput,
} from "@/lib/ec/threads/resolve";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RESOLVE = "lib/ec/threads/resolve.ts";
const SERVICE = "lib/ec/threads/service.ts";
const VIEW = "components/ec/thread-view.tsx";
const PAGE = "app/communications/threads/[messageId]/page.tsx";

const msg = (p: Partial<ThreadInput> & { rowId: string }): ThreadInput => ({
  messageId: null, inReplyTo: null, referencesHeader: null, ...p,
});

// ---------------------------------------------------------------------------
// 1. Normalization — conservative by design
// ---------------------------------------------------------------------------
describe("normalizeMessageId", () => {
  it("strips angle brackets and whitespace", () => {
    expect(normalizeMessageId("  <abc@example.com>  ")).toBe("abc@example.com");
    expect(normalizeMessageId("abc@example.com")).toBe("abc@example.com");
  });

  it("takes the id when a client appends commentary", () => {
    expect(normalizeMessageId("<abc@ex.com> (added by relay)")).toBe("abc@ex.com");
  });

  it("does NOT fold case — folding could merge two distinct threads", () => {
    expect(normalizeMessageId("<ABC@ex.com>")).toBe("ABC@ex.com");
    expect(normalizeMessageId("<ABC@ex.com>")).not.toBe(normalizeMessageId("<abc@ex.com>"));
  });

  it("degrades to null rather than to a wrong id", () => {
    for (const bad of [null, undefined, "", "   ", "not an id with spaces", "no-at-sign"]) {
      expect(normalizeMessageId(bad)).toBeNull();
    }
  });

  it("rejects absurdly long values", () => {
    expect(normalizeMessageId(`<${"x".repeat(1200)}@e.com>`)).toBeNull();
  });
});

describe("parseReferences", () => {
  it("returns every id in order, de-duplicated", () => {
    expect(parseReferences("<a@x> <b@x> <a@x> <c@x>")).toEqual(["a@x", "b@x", "c@x"]);
  });

  it("survives ragged whitespace and newlines (folded headers)", () => {
    expect(parseReferences("<a@x>\r\n\t<b@x>   <c@x>")).toEqual(["a@x", "b@x", "c@x"]);
  });

  it("drops unusable tokens instead of inventing links", () => {
    expect(parseReferences("garbage <b@x> !!!")).toEqual(["b@x"]);
    expect(parseReferences(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. The invariants the brief states: exactly one thread, never both, never neither
// ---------------------------------------------------------------------------
describe("every message resolves to exactly one thread", () => {
  it("assigns one thread per message, for every message", () => {
    const input = [
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", messageId: "<b@x>", inReplyTo: "<a@x>" }),
      msg({ rowId: "3" }),
    ];
    const out = resolveThreads(input);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((o) => o.rowId)).size).toBe(3);
    for (const a of out) expect(a.threadId).toBeTruthy();
  });

  it("gives a message with no RFC identifier its own isolated thread", () => {
    const out = resolveThreads([msg({ rowId: "r1" }), msg({ rowId: "r2" })]);
    expect(out[0].basis).toBe("synthetic");
    expect(out[0].threadId).toBe("row:r1");
    // Two identifier-less messages are NOT one conversation.
    expect(out[0].threadId).not.toBe(out[1].threadId);
  });
});

// ---------------------------------------------------------------------------
// 3. The resolution rules and their priority
// ---------------------------------------------------------------------------
describe("thread resolution follows Message-ID → In-Reply-To → References", () => {
  it("joins a reply to its parent via In-Reply-To", () => {
    const out = resolveThreads([
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", messageId: "<b@x>", inReplyTo: "<a@x>" }),
    ]);
    expect(out[0].threadId).toBe(out[1].threadId);
  });

  it("joins a deep chain through References", () => {
    const out = resolveThreads([
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", messageId: "<b@x>", inReplyTo: "<a@x>", referencesHeader: "<a@x>" }),
      msg({ rowId: "3", messageId: "<c@x>", inReplyTo: "<b@x>", referencesHeader: "<a@x> <b@x>" }),
    ]);
    expect(new Set(out.map((o) => o.threadId)).size).toBe(1);
  });

  it("REPAIRS the gap in the stored thread_key: a reply that omits References", () => {
    // deriveThreadKey would key this reply on <b@x> and the root on <a@x>,
    // splitting one conversation in two. Full resolution joins them.
    const out = resolveThreads([
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", messageId: "<b@x>", inReplyTo: "<a@x>", referencesHeader: "<a@x>" }),
      msg({ rowId: "3", messageId: "<c@x>", inReplyTo: "<b@x>" }), // no References
    ]);
    expect(new Set(out.map((o) => o.threadId)).size).toBe(1);
  });

  it("reports the basis that matched", () => {
    const out = resolveThreads([
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", inReplyTo: "<a@x>" }),
      msg({ rowId: "3", referencesHeader: "<a@x>" }),
      msg({ rowId: "4" }),
    ]);
    expect(out.map((o) => o.basis)).toEqual(["message-id", "in-reply-to", "references", "synthetic"]);
  });

  it("prefers the message's own id as its anchor when it has one", () => {
    const out = resolveThreads([msg({ rowId: "1", messageId: "<a@x>", inReplyTo: "<b@x>" })]);
    expect(out[0].basis).toBe("message-id");
  });
});

// ---------------------------------------------------------------------------
// 4. What must NEVER define a thread
// ---------------------------------------------------------------------------
describe("subject, sender and date never define a thread", () => {
  it("two messages sharing only a subject are two conversations", () => {
    // The resolver has no subject input at all — the strongest possible form of
    // this guarantee. Same-subject messages with distinct ids stay separate.
    const out = resolveThreads([
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", messageId: "<b@x>" }),
    ]);
    expect(out[0].threadId).not.toBe(out[1].threadId);
  });

  it("the resolver accepts no subject, sender or date field", () => {
    const src = code(RESOLVE);
    for (const forbidden of ["subject", "fromAddress", "from_address", "receivedAt", "received_at", "sender"]) {
      expect(src).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism and immutability of the derived identity
// ---------------------------------------------------------------------------
describe("conversation identity is deterministic and order-independent", () => {
  const conversation = [
    msg({ rowId: "1", messageId: "<a@x>" }),
    msg({ rowId: "2", messageId: "<b@x>", inReplyTo: "<a@x>", referencesHeader: "<a@x>" }),
    msg({ rowId: "3", messageId: "<c@x>", inReplyTo: "<b@x>", referencesHeader: "<a@x> <b@x>" }),
  ];

  it("produces the same identity regardless of arrival order", () => {
    const forward = resolveThreads(conversation);
    const reversed = resolveThreads([...conversation].reverse());
    const shuffled = resolveThreads([conversation[1], conversation[2], conversation[0]]);
    const id = forward[0].threadId;
    for (const set of [reversed, shuffled]) {
      for (const a of set) expect(a.threadId).toBe(id);
    }
  });

  it("is stable across repeated resolution — reprocessing changes nothing", () => {
    const a = resolveThreads(conversation);
    const b = resolveThreads(conversation);
    expect(a).toEqual(b);
  });

  it("keeps identity when a LATER reply arrives (history is not rewritten)", () => {
    const before = resolveThreads(conversation);
    const after = resolveThreads([
      ...conversation,
      msg({ rowId: "4", messageId: "<d@x>", inReplyTo: "<c@x>", referencesHeader: "<a@x> <b@x> <c@x>" }),
    ]);
    expect(threadIdOf(after, "1")).toBe(threadIdOf(before, "1"));
    expect(threadIdOf(after, "4")).toBe(threadIdOf(before, "1"));
  });

  it("merges two apparent threads when a bridging message proves they are one", () => {
    // They were always one conversation; the platform merely lacked the evidence.
    const split = resolveThreads([
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", messageId: "<b@x>" }),
    ]);
    expect(split[0].threadId).not.toBe(split[1].threadId);

    const bridged = resolveThreads([
      msg({ rowId: "1", messageId: "<a@x>" }),
      msg({ rowId: "2", messageId: "<b@x>" }),
      msg({ rowId: "3", messageId: "<c@x>", inReplyTo: "<a@x>", referencesHeader: "<a@x> <b@x>" }),
    ]);
    expect(new Set(bridged.map((o) => o.threadId)).size).toBe(1);
  });

  it("derives identity from headers only — never a provider or row id", () => {
    const out = resolveThreads([msg({ rowId: "row-uuid-1", messageId: "<a@x>" })]);
    expect(out[0].threadId).toBe("a@x");
    expect(out[0].threadId).not.toContain("row-uuid-1");
  });
});

describe("linkedIdentifiers", () => {
  it("returns every id the message names, de-duplicated", () => {
    expect(
      linkedIdentifiers(msg({ rowId: "1", messageId: "<b@x>", inReplyTo: "<a@x>", referencesHeader: "<a@x> <z@x>" })),
    ).toEqual(["b@x", "a@x", "z@x"]);
  });

  it("is empty when the message carries nothing usable", () => {
    expect(linkedIdentifiers(msg({ rowId: "1" }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. No duplicate architecture, no migration, no write path
// ---------------------------------------------------------------------------
describe("EMP-2 extends EC and builds nothing parallel", () => {
  it("adds no migration — the chain still ends at 86", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe("20260810000001_decision_plane_emitters.sql");
    expect(files).toHaveLength(86);
  });

  it("stores nothing: the resolver and service never write", () => {
    for (const f of [RESOLVE, SERVICE, PAGE, VIEW]) {
      const src = code(f);
      for (const w of [".insert(", ".update(", ".upsert(", ".delete(", "writeAudit"]) {
        expect(src).not.toContain(w);
      }
    }
  });

  it("introduces no conversation, chat or messaging model", () => {
    for (const f of [RESOLVE, SERVICE, PAGE, VIEW]) {
      const src = code(f);
      for (const forbidden of ["conversation_participant", "from(\"conversation\")", "from(\"message\")", "messaging"]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it("reads only the existing capture table", () => {
    const src = code(SERVICE);
    expect(src).toContain('from("ec_inbound_message")');
    for (const t of ["conversation", "ec_thread", "thread"]) {
      expect(src).not.toContain(`from("${t}")`);
    }
  });

  it("emits no timeline event and creates no second journal", () => {
    for (const f of [RESOLVE, SERVICE, PAGE, VIEW]) {
      const src = code(f);
      expect(src).not.toContain("emit_business_event");
      expect(src).not.toContain('from("business_event")');
      expect(src).not.toContain("emitBusinessEvent");
    }
  });

  it("consumes the Unified Timeline through the existing reader", () => {
    expect(code(PAGE)).toContain("readDecisionPlane");
  });

  it("reuses the existing triage reader for routing outcomes", () => {
    expect(code(PAGE)).toContain("listTriageQueue");
  });
});

// ---------------------------------------------------------------------------
// 7. Security envelope, unchanged from EMP-1
// ---------------------------------------------------------------------------
describe("EMP-2 security envelope", () => {
  it("reads through RLS, never the admin client", () => {
    expect(code(SERVICE)).toContain("getServerSupabaseClient");
    expect(code(SERVICE)).not.toContain("getAdminSupabaseClient");
  });

  it("gates the thread view on communication:inbound:read", () => {
    expect(code(PAGE)).toContain('hasPermission(permissions, "communication:inbound:read")');
  });

  it("scopes every read by tenant", () => {
    const src = code(SERVICE);
    const reads = src.match(/\.from\("ec_inbound_message"\)/g) ?? [];
    const scopes = src.match(/\.eq\("tenant_id", tenantId\)/g) ?? [];
    expect(scopes.length).toBe(reads.length);
  });

  it("grants SYSTEM_ADMIN nothing", () => {
    for (const f of [RESOLVE, SERVICE, PAGE, VIEW]) expect(code(f)).not.toContain("SYSTEM_ADMIN");
  });

  it("never reads a message body", () => {
    for (const f of [SERVICE, PAGE, VIEW]) {
      const src = code(f);
      expect(src).not.toContain("text_body_path");
      expect(src).not.toContain("html_body_path");
    }
  });

  it("sanitizes ids before they reach a PostgREST filter expression", () => {
    expect(code(SERVICE)).toContain('replace(/[%,()]/g, "")');
  });
});

// ---------------------------------------------------------------------------
// 8. Out of scope — pinned
// ---------------------------------------------------------------------------
describe("EMP-2 ships nothing from a later phase", () => {
  it("has no compose, reply, outbound, template or AI surface", () => {
    for (const f of [RESOLVE, SERVICE, PAGE, VIEW]) {
      const src = code(f).toLowerCase();
      for (const forbidden of ["sendemail", "queueandsend", "communication_message", "smtp", "imap", "pop3",
        "nodemailer", "resend", "répondre", "rédiger", "openai", "anthropic"]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it("creates no customer-facing surface", () => {
    for (const f of [SERVICE, PAGE, VIEW]) {
      const src = code(f);
      expect(src).not.toContain("portal");
      expect(src).not.toContain("clientSafe");
    }
  });

  it("the view is read-only — no form, action or mutation", () => {
    const src = code(VIEW);
    expect(src).not.toContain("<form");
    expect(src).not.toContain("useTransition");
    expect(src).not.toContain('"use client"');
  });
});

// ---------------------------------------------------------------------------
// 9. Honesty in the view
// ---------------------------------------------------------------------------
describe("the view explains rather than asserts", () => {
  it("states that identity is computed, not stored", () => {
    expect(read(VIEW)).toMatch(/calculée/);
    expect(read(VIEW)).toMatch(/jamais stockée/);
  });

  it("states that subject never correlates", () => {
    expect(read(VIEW)).toMatch(/objet/i);
    expect(read(VIEW)).toMatch(/ne forment pas une conversation/);
  });

  it("shows the correlation basis for every message", () => {
    const src = read(VIEW);
    expect(src).toContain("BASIS_FR");
    for (const b of ["message-id", "in-reply-to", "references", "synthetic"]) {
      expect(src).toContain(b);
    }
  });

  it("declares a truncated conversation instead of presenting it as whole", () => {
    expect(read(VIEW)).toMatch(/partielle/);
    expect(code(SERVICE)).toContain("truncated");
  });

  it("routes by message row id, since a derived thread id is not a stable URL", () => {
    expect(existsSync(join(root, "app/communications/threads/[messageId]/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "app/communications/threads/[threadId]"))).toBe(false);
  });
});
