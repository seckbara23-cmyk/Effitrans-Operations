/**
 * EMP-2 — RFC 5322 thread resolution. PURE. No I/O, no client, no clock.
 *
 * WHY CONVERSATION IDENTITY IS DERIVED AND NOT STORED
 * ---------------------------------------------------
 * The obvious design is a `thread_id` column on `ec_inbound_message`, backfilled
 * once. It is not available here: EC-1 put `prevent_mutation` on that table, so
 * every UPDATE raises. A backfill is not merely discouraged, it is impossible —
 * and EMP-2's brief independently forbids rewriting historical messages.
 *
 * That constraint turns out to be the right architecture rather than an
 * obstacle. Identity is computed from headers that are themselves immutable, so
 * it satisfies every requirement asked of it without a table:
 *
 *   immutable          — the inputs cannot change, so neither can the output
 *   deterministic      — same message set, same identity, always
 *   survives reprocess — nothing is stored, so nothing can drift out of sync
 *   survives provider  — keyed on RFC headers, never on provider ids
 *   tenant isolated    — computed over a tenant-scoped read; ids never cross
 *   audit friendly     — a pure function, reproducible from the evidence alone
 *
 * WHAT THIS DELIBERATELY WILL NOT DO
 * -----------------------------------
 * Subject, sender and date are never inputs. Subject-based threading is how mail
 * clients put one customer's reply inside another customer's conversation, and
 * in a freight platform that means the wrong shipment. If the headers do not
 * prove a link, there is no link.
 *
 * SPLITTING IS SAFER THAN MERGING
 * --------------------------------
 * Both failure modes are possible; they are not equally bad. A missed link shows
 * two threads where there was one — incomplete, and visibly so. A false link
 * shows unrelated correspondence as a single conversation, which is a
 * correctness and confidentiality failure. Every ambiguous choice below is
 * therefore resolved toward splitting.
 */

/** A message as the resolver needs it — identifiers only, never content. */
export type ThreadInput = {
  /** The database row id. Identity is per-row, so this is what we key results on. */
  rowId: string;
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
};

export type ThreadAssignment = {
  rowId: string;
  /** The conversation this message belongs to. Exactly one, always. */
  threadId: string;
  /**
   * How the message reached its thread — the priority rule that matched.
   * `synthetic` means the message carried no usable RFC identifier at all.
   */
  basis: "message-id" | "in-reply-to" | "references" | "synthetic";
};

/**
 * Normalize one RFC 5322 msg-id.
 *
 * Strips the angle brackets and surrounding whitespace, and NOTHING else. In
 * particular it does not fold case: RFC 5322 makes the local part
 * case-sensitive, and folding it could merge two distinct threads. Per the
 * splitting-is-safer rule, an id that differs only in case is treated as a
 * different id.
 *
 * Returns null for anything that is not a usable identifier, so a malformed
 * header degrades to "no link" rather than to a wrong one.
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Take the first angle-bracketed token when present; some clients append
  // commentary after the id, and the id is the only part that means anything.
  const bracketed = trimmed.match(/<([^<>\s]+)>/);
  const value = (bracketed ? bracketed[1] : trimmed).trim();
  if (!value || value.length > 998) return null; // RFC 5322 line-length sanity
  if (/\s/.test(value)) return null;
  // An RFC 5322 msg-id is `id-left "@" id-right`. Requiring the "@" is a real
  // structural check, not a heuristic, and it is what stops a malformed
  // References header from inventing links: without it a token like "!!!"
  // parsed as an identifier, and two messages that both carried that garbage
  // would have MERGED into one conversation. Splitting is safer than merging,
  // so an unparseable token becomes no link at all.
  if (!value.includes("@")) return null;
  return value;
}

/** Every id in a References header, in order, normalized and de-duplicated. */
export function parseReferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // References is a whitespace-separated list of msg-ids. Split on whitespace
  // and normalize each token; tokens that are not ids simply drop out.
  for (const token of raw.trim().split(/\s+/)) {
    const id = normalizeMessageId(token);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Minimal union-find over string keys. */
class DisjointSet {
  private parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    // Path compression, so repeated lookups stay cheap on long chains.
    let cur = key;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // The smaller id always wins, which is what makes the canonical
    // representative independent of insertion order.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

/**
 * Assign every message to exactly one conversation.
 *
 * The union step links every identifier a message carries — its own Message-ID,
 * its In-Reply-To, and every id in its References chain — because all of them
 * name the same conversation by definition. The PRIORITY in the brief
 * (Message-ID, then In-Reply-To, then References) decides which identifier a
 * message ANCHORS to, and therefore what `basis` reports; the equivalence class
 * is the same either way.
 *
 * A message with no usable identifier gets a synthetic thread keyed on its own
 * row id. That guarantees the two invariants the brief states: never neither
 * (there is always a thread) and never both (a row id is unique, so the
 * synthetic thread can never collide with a real one or with another synthetic).
 */
export function resolveThreads(messages: readonly ThreadInput[]): ThreadAssignment[] {
  const set = new DisjointSet();

  for (const m of messages) {
    const own = normalizeMessageId(m.messageId);
    const parent = normalizeMessageId(m.inReplyTo);
    const refs = parseReferences(m.referencesHeader);

    const anchors = [own, parent, ...refs].filter((x): x is string => x !== null);
    if (anchors.length === 0) continue;

    for (const a of anchors) set.add(a);
    // Union everything this message names — one message is evidence that all
    // the ids it carries belong together.
    for (let i = 1; i < anchors.length; i += 1) set.union(anchors[0], anchors[i]);
  }

  return messages.map((m) => {
    const own = normalizeMessageId(m.messageId);
    const parent = normalizeMessageId(m.inReplyTo);
    const refs = parseReferences(m.referencesHeader);

    if (own) return { rowId: m.rowId, threadId: set.find(own), basis: "message-id" as const };
    if (parent) return { rowId: m.rowId, threadId: set.find(parent), basis: "in-reply-to" as const };
    if (refs.length > 0) return { rowId: m.rowId, threadId: set.find(refs[0]), basis: "references" as const };
    // No identifier at all. Its own row id is the thread, and it is alone in it.
    return { rowId: m.rowId, threadId: `row:${m.rowId}`, basis: "synthetic" as const };
  });
}

/**
 * Every identifier that could pull more messages into a seed's conversation.
 *
 * The thread service uses this to expand a candidate set one hop at a time
 * instead of loading a tenant's entire mailbox to answer a question about one
 * conversation.
 */
export function linkedIdentifiers(m: ThreadInput): string[] {
  const ids = [normalizeMessageId(m.messageId), normalizeMessageId(m.inReplyTo), ...parseReferences(m.referencesHeader)];
  return [...new Set(ids.filter((x): x is string => x !== null))];
}

/**
 * The conversation identity for one message within a resolved set.
 * Exactly one assignment exists per row, so a miss is a programming error
 * rather than a state to render.
 */
export function threadIdOf(assignments: readonly ThreadAssignment[], rowId: string): string | null {
  return assignments.find((a) => a.rowId === rowId)?.threadId ?? null;
}
