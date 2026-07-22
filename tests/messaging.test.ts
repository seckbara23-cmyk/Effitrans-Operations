/**
 * Effitrans Messaging Center — regression suite (Phase 8.7).
 * ---------------------------------------------------------------------------
 * Pure-logic tests exercise the real access/attachment rules directly (no
 * database needed). Everything that requires a live Supabase (RLS, cross-tenant
 * insertion, cross-customer isolation) is asserted structurally here — the
 * SOURCE is scanned for the exact guard, matching this repo's established
 * convention (see tests/user-creation.test.ts, tests/customer-identity-routing.
 * test.ts) — and is additionally proven at the SQL level by
 * supabase/tests/rls_messaging_test.sql, which CI runs against a real Postgres
 * (this environment has no Docker/psql, so it cannot run locally — see
 * docs/messaging/security.md).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  MESSAGING_DEPARTMENTS,
  isValidMessagingDepartment,
  messagingDepartmentPermission,
  validateMessageBody,
  validateRedactionReason,
  canCloseConversation,
  canReopenConversation,
  canMessageConversation,
  nextStatusOnStaffReply,
  nextStatusOnCustomerReply,
  countUnreadPerConversation,
} from "@/lib/messaging/access";
import { CONTACT_DEPARTMENTS } from "@/lib/portal/self-service";
import {
  validateAttachmentUpload,
  sanitizeAttachmentFilename,
  ALLOWED_ATTACHMENT_MIME,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/messaging/attachments";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const migration = read("../supabase/migrations/20260722000001_messaging_center.sql");
const staffActions = code("../lib/messaging/actions.ts");
const portalActions = code("../lib/portal/messaging-actions.ts");
const serviceCode = code("../lib/messaging/service.ts");
const swjs = read("../public/sw.js");
const notify = code("../lib/messaging/notify.ts");

// -------------------------------------------------- 5/15: department routing ----

describe("department vocabulary is REUSED from lib/portal/self-service.ts, never duplicated", () => {
  it("MESSAGING_DEPARTMENTS is literally CONTACT_DEPARTMENTS (same array, not a parallel copy)", () => {
    expect(MESSAGING_DEPARTMENTS).toBe(CONTACT_DEPARTMENTS);
  });

  it("validates department codes and rejects unknown ones", () => {
    expect(isValidMessagingDepartment("customs")).toBe(true);
    expect(isValidMessagingDepartment("general")).toBe(true);
    expect(isValidMessagingDepartment("maritime")).toBe(false); // not a real department code
    expect(isValidMessagingDepartment("")).toBe(false);
  });

  it("the DB check constraint carries the exact same 5 codes", () => {
    for (const dep of CONTACT_DEPARTMENTS) expect(migration).toContain(`'${dep}'`);
  });

  it("each department's read permission follows messaging:read:<dept>", () => {
    for (const dep of CONTACT_DEPARTMENTS) {
      expect(messagingDepartmentPermission(dep)).toBe(`messaging:read:${dep}`);
    }
  });
});

// -------------------------------------------------- 3: department conversation access ----

describe("department-level access is permission-based, matching RLS exactly", () => {
  it("the RLS predicate concatenates the SAME 'messaging:read:' prefix the TS helper uses", () => {
    expect(migration).toContain("has_permission('messaging:read:' || c.department_code)");
  });

  it("loadConversationForStaff (server actions) uses messagingDepartmentPermission, not a hand-rolled string", () => {
    expect(staffActions).toContain("messagingDepartmentPermission(conv.department_code)");
  });
});

// -------------------------------------------------- 2/18: message + moderation validation ----

describe("message body validation", () => {
  it("rejects empty and rejects over-long bodies", () => {
    expect(validateMessageBody("")).toBe("message_required");
    expect(validateMessageBody("   ")).toBe("message_required");
    expect(validateMessageBody("a".repeat(4001))).toBe("message_too_long");
    expect(validateMessageBody("Bonjour, ceci est un message valide.")).toBeNull();
  });
});

describe("redaction reason validation (governance)", () => {
  it("requires a real reason, capped in length", () => {
    expect(validateRedactionReason("")).toBe("reason_required");
    expect(validateRedactionReason("ok")).toBe("reason_required"); // below REDACTION_REASON_MIN
    expect(validateRedactionReason("a".repeat(501))).toBe("reason_too_long");
    expect(validateRedactionReason("Contenu inapproprié signalé par le client")).toBeNull();
  });
});

// -------------------------------------------------- 18: closed conversation state ----

describe("conversation status state machine", () => {
  it("a closed conversation accepts no new messages from anyone", () => {
    expect(canMessageConversation("closed")).toBe(false);
    for (const s of ["open", "waiting_customer", "waiting_effitrans", "resolved"] as const) {
      expect(canMessageConversation(s)).toBe(true);
    }
  });

  it("close/reopen are only legal from the states that make sense", () => {
    expect(canCloseConversation("closed")).toBe(false);
    expect(canCloseConversation("open")).toBe(true);
    expect(canReopenConversation("closed")).toBe(true);
    expect(canReopenConversation("resolved")).toBe(true);
    expect(canReopenConversation("open")).toBe(false);
  });

  it("a staff reply flips a customer_support thread to waiting_customer; a customer reply flips it back", () => {
    expect(nextStatusOnStaffReply("open")).toBe("waiting_customer");
    expect(nextStatusOnStaffReply("waiting_effitrans")).toBe("waiting_customer");
    expect(nextStatusOnCustomerReply("waiting_customer")).toBe("waiting_effitrans");
  });

  it("neither reply direction ever auto-reopens a closed or resolved thread", () => {
    expect(nextStatusOnStaffReply("closed")).toBe("closed");
    expect(nextStatusOnStaffReply("resolved")).toBe("resolved");
    expect(nextStatusOnCustomerReply("closed")).toBe("closed");
    expect(nextStatusOnCustomerReply("resolved")).toBe("resolved");
  });

  it("sendMessage (staff) and sendPortalMessage (customer) both gate on canMessageConversation before inserting", () => {
    expect(staffActions).toContain("canMessageConversation(conv.status as ConversationStatus)");
    expect(portalActions).toContain("canMessageConversation(conv.status as never)");
  });
});

// -------------------------------------------------- 11/12: unread + read state ----

describe("unread count derivation (participant.last_read_at, no per-message receipts)", () => {
  it("a message after last_read_at is unread; a message before or at it is not", () => {
    const counts = countUnreadPerConversation(
      [
        { conversationId: "c1", createdAt: "2026-07-22T10:00:00Z" },
        { conversationId: "c1", createdAt: "2026-07-22T11:00:00Z" },
      ],
      new Map([["c1", "2026-07-22T10:30:00Z"]]),
    );
    expect(counts.get("c1")).toBe(1); // only the 11:00 message is after last_read_at
  });

  it("a conversation never opened (no participant row / null last_read_at) counts EVERY message unread", () => {
    const counts = countUnreadPerConversation(
      [{ conversationId: "c2", createdAt: "2026-07-22T09:00:00Z" }],
      new Map(),
    );
    expect(counts.get("c2")).toBe(1);
  });

  it("opening a thread (markStaffConversationRead / markPortalConversationRead) touches last_read_at via a shared helper, not raw upsert", () => {
    // NOT .upsert() — the real unique constraint is a PARTIAL index (WHERE removed_at IS
    // NULL) supabase-js's onConflict cannot target; see touchStaffParticipant's own comment.
    expect(staffActions).toContain("touchStaffParticipant");
    expect(staffActions).not.toMatch(/conversation_participant"\)\s*\.upsert/);
    expect(portalActions).toContain("touchPortalParticipant");
    expect(portalActions).not.toMatch(/conversation_participant"\)\s*\.upsert/);
  });
});

// -------------------------------------------------- 14: sender identity is server-derived ----

describe("sender identity can never be forged from the client", () => {
  it("every staff message insert sets sender_user_id from the resolved session user, never from input", () => {
    expect(staffActions).toContain("sender_user_id: user.id");
    expect(staffActions).not.toMatch(/sender_user_id:\s*input\./);
  });

  it("every portal message insert sets sender_client_user_id from the resolved session user, never from input", () => {
    expect(portalActions).toContain("sender_client_user_id: user.id");
    expect(portalActions).not.toMatch(/sender_client_user_id:\s*input\./);
  });

  it("neither action file's public function signatures accept a senderId/senderType parameter at all", () => {
    expect(staffActions).not.toMatch(/senderId|senderType/i);
    expect(portalActions).not.toMatch(/senderId|senderType/i);
  });

  it("the schema backstops this too: a message's sender_type is structurally tied to which identity column is set", () => {
    expect(migration).toContain("sender_type = 'staff' and sender_user_id is not null and sender_client_user_id is null");
    expect(migration).toContain("sender_type = 'customer' and sender_client_user_id is not null and sender_user_id is null");
  });
});

// -------------------------------------------------- 15: cross-tenant / cross-customer isolation ----

describe("tenant and customer isolation — no client-supplied tenant_id/client_id is ever trusted", () => {
  it("every messaging table has RLS enabled with SELECT-ONLY policies (deny-by-default writes, matching every other module)", () => {
    for (const table of ["conversation", "conversation_participant", "message", "message_attachment"]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
    }
    expect(migration).not.toMatch(/create policy \w+ on public\.(conversation|message)\w* for (insert|update|delete)/);
  });

  it("the staff conversation-access loader re-derives tenant_id from the loaded row, never trusts a caller-supplied one", () => {
    expect(staffActions).toContain("if (!conv || conv.tenant_id !== tenantId) return null;");
  });

  it("portal actions verify BOTH tenant_id and client_id match the resolved session before any write", () => {
    expect(portalActions).toMatch(/conv\.tenant_id !== user\.tenantId \|\| conv\.client_id !== user\.clientId/);
  });

  it("the portal conversation SELECT policy scopes by the caller's own client_id (auth_portal_client_id), not an input value", () => {
    expect(migration).toContain("client_id = public.auth_portal_client_id()");
  });
});

// -------------------------------------------------- 8: internal notes never reach the customer ----

describe("internal staff notes are never customer-visible", () => {
  it("the message RLS policy for portal requires visibility = 'shared'", () => {
    expect(migration).toContain('visibility = \'shared\' and public.messaging_portal_can_access_conversation(conversation_id)');
  });

  it("a customer can never author an internal message (schema check)", () => {
    expect(migration).toContain("check (visibility = 'shared' or sender_type in ('staff', 'system', 'ai'))");
  });

  it("the portal service reader additionally filters to visibility='shared' for the list preview (defense in depth)", () => {
    expect(serviceCode).toContain('.eq("visibility", "shared") // portal never sees internal notes, even for the preview');
  });

  it("sendMessage lets staff choose internal visibility; sendPortalMessage accepts no visibility input at all (always hardcoded 'shared')", () => {
    expect(staffActions).toContain('visibility?: "shared" | "internal"');
    const sendPortal = portalActions.slice(
      portalActions.indexOf("export async function sendPortalMessage"),
      portalActions.indexOf("export async function markPortalConversationRead"),
    );
    // The function's own INPUT type never mentions visibility — only its outgoing
    // insert literally hardcodes "shared".
    expect(sendPortal).toMatch(/input:\s*\{\s*conversationId:\s*string;\s*body:\s*string\s*\}/);
    expect(sendPortal).toContain('visibility: "shared"');
  });
});

// -------------------------------------------------- 4/5: customer support request routing ----

describe("customer support requests are correctly modeled and routed", () => {
  it("createSupportConversation always sets type='customer_support' and the caller's own client_id", () => {
    expect(portalActions).toContain('type: "customer_support"');
    expect(portalActions).toContain("client_id: user.clientId");
  });

  it("a dossier may optionally be attached, but ownership is verified first (file.client_id must equal the caller's)", () => {
    expect(portalActions).toMatch(/file\.client_id !== user\.clientId/);
  });

  it("the DB requires customer_support conversations to carry a department AND a client", () => {
    expect(migration).toContain("check (type <> 'customer_support' or client_id is not null)");
    expect(migration).toContain("check (type not in ('department', 'customer_support') or department_code is not null)");
  });

  it("eligible staff are notified via the real role_permission grant, not a hardcoded list", () => {
    expect(portalActions).toContain("resolveStaffWithPermission(admin, user.tenantId, messagingDepartmentPermission(department))");
  });
});

// -------------------------------------------------- 16/17: attachments ----

describe("attachment validation — MIME allow-list + real byte-signature check, not just file.type", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK.. (zip)
  const notReallyPng = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

  it("accepts every allow-listed type when the signature genuinely matches", () => {
    expect(validateAttachmentUpload({ sizeBytes: 100, mimeType: "image/png", headerBytes: png })).toBeNull();
    expect(validateAttachmentUpload({ sizeBytes: 100, mimeType: "image/jpeg", headerBytes: jpeg })).toBeNull();
    expect(validateAttachmentUpload({ sizeBytes: 100, mimeType: "application/pdf", headerBytes: pdf })).toBeNull();
    expect(
      validateAttachmentUpload({
        sizeBytes: 100,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headerBytes: docx,
      }),
    ).toBeNull();
  });

  it("REJECTS a file whose declared MIME type does not match its actual byte signature (a renamed .exe, say)", () => {
    expect(validateAttachmentUpload({ sizeBytes: 100, mimeType: "image/png", headerBytes: notReallyPng })).toBe("invalid_signature");
  });

  it("rejects a disallowed MIME type outright, before even checking bytes", () => {
    expect(
      validateAttachmentUpload({ sizeBytes: 100, mimeType: "application/x-msdownload", headerBytes: png }),
    ).toBe("invalid_mime");
    expect((ALLOWED_ATTACHMENT_MIME as readonly string[]).includes("application/x-msdownload")).toBe(false);
  });

  it("enforces the size limit and rejects an empty file", () => {
    expect(validateAttachmentUpload({ sizeBytes: 0, mimeType: "image/png", headerBytes: png })).toBe("file_required");
    expect(validateAttachmentUpload({ sizeBytes: MAX_ATTACHMENT_BYTES + 1, mimeType: "image/png", headerBytes: png })).toBe("file_too_large");
  });

  it("sanitizes filenames — strips path components and disallowed characters, never trusts the client name raw", () => {
    expect(sanitizeAttachmentFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeAttachmentFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeAttachmentFilename("rapport final (v2).pdf")).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(sanitizeAttachmentFilename("")).toBe("fichier");
  });

  it("upload actions validate BEFORE upload, and both staff and portal versions check conversation access first", () => {
    const staffUpload = staffActions.slice(staffActions.indexOf("export async function uploadMessageAttachment"));
    expect(staffUpload.indexOf("loadConversationForStaff")).toBeLessThan(staffUpload.indexOf("validateAttachmentUpload"));
    const portalUpload = portalActions.slice(portalActions.indexOf("export async function uploadPortalMessageAttachment"));
    expect(portalUpload.indexOf("conv.client_id !== user.clientId")).toBeLessThan(portalUpload.indexOf("validateAttachmentUpload"));
  });

  it("attachment RLS follows the SAME visibility+access rule as its parent message, for both staff and portal", () => {
    expect(migration).toMatch(/message_attachment_staff_select[\s\S]*?messaging_staff_can_access_conversation/);
    expect(migration).toMatch(/message_attachment_portal_select[\s\S]*?m\.visibility = 'shared'/);
  });
});

// -------------------------------------------------- 19/20: revoked / inactive users ----

describe("revoked or inactive identities are denied, reusing the SAME gates as the rest of the app", () => {
  it("every portal messaging action checks status === 'ACTIVE' before doing anything (a DISABLED client_user is denied)", () => {
    for (const fn of [
      "createSupportConversation",
      "sendPortalMessage",
      "markPortalConversationRead",
      "uploadPortalMessageAttachment",
    ]) {
      const body = portalActions.slice(portalActions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 300), fn).toContain('user.status !== "ACTIVE"');
    }
  });

  it("every staff messaging action gates through assertPermission, which already denies a non-active app_user (getCurrentUser)", () => {
    for (const fn of ["sendMessage", "createDirectConversation", "createDossierConversation", "uploadMessageAttachment"]) {
      const body = staffActions.slice(staffActions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 400), fn).toContain('assertPermission("messaging:');
    }
  });
});

// -------------------------------------------------- 21: notifications ----

describe("notifications are created once per message, reusing the existing two notification tables", () => {
  it("the portal notification dedup_key is keyed by the message id — globally unique, so exactly one row per message", () => {
    expect(notify).toContain("dedup_key: `messaging:${input.messageId}`");
  });

  it("no THIRD notification table is introduced — only notification (staff) and client_notification (portal)", () => {
    expect(notify).toContain('.from("client_notification")');
    expect(notify).not.toMatch(/from\("messaging_notification/);
  });

  it("staff notification type extends the existing catalog additively (MESSAGE_RECEIVED, CONVERSATION_ASSIGNED)", () => {
    const notifTypes = code("../lib/notifications/types.ts");
    expect(notifTypes).toContain('"MESSAGE_RECEIVED"');
    expect(notifTypes).toContain('"CONVERSATION_ASSIGNED"');
  });
});

// -------------------------------------------------- 22/23: PWA / mobile ----

describe("PWA cache allowlist is unchanged — messaging is never cached, network-only like every other authenticated route", () => {
  it("the service worker's cacheable-static allowlist still covers ONLY the three pre-existing patterns", () => {
    expect(swjs).toMatch(/pathname\.startsWith\("\/_next\/static\/"\)/);
    expect(swjs).toMatch(/pathname\.startsWith\("\/icons\/"\)/);
    expect(swjs).toMatch(/pathname === "\/favicon\.ico"/);
    expect(swjs).not.toMatch(/\/messages|\/portal\/messages|messaging-attachments/);
  });

  it("navigations (every page, including /messages and /portal/messages) are network-only and never written to any cache", () => {
    const navBlock = swjs.slice(swjs.indexOf('request.mode === "navigate"'), swjs.indexOf("if (!cacheableStatic"));
    expect(navBlock).not.toMatch(/cache\.put/);
  });
});

// -------------------------------------------------- rollout flag ----

describe("messaging rollout is independent of the process-engine rollout, fails closed", () => {
  it("uses its OWN table/env var, not tenant_process_rollout's ROLLOUT_FEATURES", () => {
    expect(migration).toContain("create table public.tenant_messaging_rollout");
    const rolloutCode = code("../lib/messaging/rollout.ts");
    expect(rolloutCode).toContain("EFFITRANS_MESSAGING_CENTER_ENABLED");
  });

  it("a missing tenant row or a query error resolves to disabled, never enabled", () => {
    const rolloutCode = code("../lib/messaging/rollout.ts");
    expect(rolloutCode).toContain("if (error || !data) return false; // fail closed");
  });
});
