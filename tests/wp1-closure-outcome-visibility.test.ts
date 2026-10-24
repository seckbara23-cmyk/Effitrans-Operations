/**
 * WP1 closure — R-1, completed (closure security review, MEDIUM).
 *
 * R-1 stopped the EMP-4 attachment lookup from naming a dossier its reader
 * cannot see. The same page — and the conversation page — still linked that
 * dossier through the TRIAGE OUTCOME (`outcomeFileId`): « Dossier rattaché »,
 * « Ouvrir le dossier rattaché ». Both pages now apply the same rule before
 * anything renders. These tests run the two server pages with their
 * collaborators mocked and read the props handed to the components that draw
 * the link: behaviour, not a reading of the source.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  visible: new Set<string>(),
  calls: [] as string[],
  outcomeFileId: "file-X" as string | null,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: "user-1", tenantId: "tenant-A", email: "u@test.local" }),
}));
vi.mock("@/lib/rbac/permissions", () => ({
  getEffectivePermissions: async () => ["communication:inbound:read"],
  hasPermission: (perms: string[], code: string) => perms.includes(code),
}));
vi.mock("@/lib/authz/visibility", () => ({
  isFileVisible: async (userId: string, tenantId: string, fileId: string) => {
    h.calls.push(`visible:${userId}:${tenantId}:${fileId}`);
    return h.visible.has(fileId);
  },
}));
vi.mock("@/lib/workflow/access/roles", () => ({ getUserRoleCodes: async () => [] }));
vi.mock("@/lib/ec/triage/service", () => ({
  getTriageDetail: async (tenantId: string, id: string) => ({
    id,
    messageId: "msg-1",
    status: "RESOLVED",
    outcome: "LINKED_TO_FILE",
    outcomeFileId: h.outcomeFileId,
    subject: "Instruction",
    receivedAt: "2026-10-23T08:00:00Z",
    fromAddress: "client@example.com",
    fromName: null,
    attachments: [],
  }),
  listTriageQueue: async () => [
    { id: "tri-1", messageId: "row-1", status: "RESOLVED", outcome: "LINKED_TO_FILE", outcomeFileId: "file-X", attachmentCount: 0, mailboxAddress: "ops@x" },
    { id: "tri-2", messageId: "row-2", status: "RESOLVED", outcome: "LINKED_TO_FILE", outcomeFileId: "file-Y", attachmentCount: 0, mailboxAddress: "ops@x" },
    { id: "tri-3", messageId: "row-3", status: "NEW", outcome: null, outcomeFileId: null, attachmentCount: 0, mailboxAddress: "ops@x" },
  ],
}));
vi.mock("@/lib/ec/threads/service", () => ({
  getThreadForMessage: async () => ({
    messages: [{ rowId: "row-1", subject: "A" }, { rowId: "row-2", subject: "B" }, { rowId: "row-3", subject: "C" }],
  }),
}));
vi.mock("@/lib/files/service", () => ({ listFiles: async () => [] }));
vi.mock("@/lib/ec/mailboxes/service", () => ({ getCaptureEvidence: async () => null }));
vi.mock("@/lib/unified-timeline/decision-plane", () => ({ readDecisionPlane: async () => ({ entries: [] }) }));
vi.mock("@/lib/ec/ingest/actions", () => ({ lookupIngestedDocument: async () => null }));
vi.mock("@/lib/ec/ingest/message-actions", () => ({
  lookupIngestedMessage: async () => null,
  messageFilingAvailable: async () => false,
}));
vi.mock("@/lib/documents/service", () => ({ listDocumentTypes: async () => [] }));
vi.mock("@/components/ec/triage-studio", () => ({ TriageStudio: () => null }));
vi.mock("@/components/ec/message-evidence", () => ({ MessageEvidence: () => null }));
vi.mock("@/components/ec/attachment-ingest", () => ({ AttachmentIngest: () => null }));
vi.mock("@/components/ec/message-ingest", () => ({ MessageIngest: () => null }));
vi.mock("@/components/ec/thread-view", () => ({ ThreadView: () => null }));

import TriageDetailPage from "@/app/mail/inbox/[id]/page";
import ThreadPage from "@/app/mail/threads/[messageId]/page";
import { TriageStudio } from "@/components/ec/triage-studio";
import { MessageEvidence } from "@/components/ec/message-evidence";
import { ThreadView } from "@/components/ec/thread-view";

/** Every element of `type` in a rendered (not mounted) server-component tree. */
function elementsOf(node: unknown, type: unknown): { props: Record<string, unknown> }[] {
  const out: { props: Record<string, unknown> }[] = [];
  const walk = (n: unknown) => {
    if (n == null || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (el.type === type && el.props) out.push({ props: el.props });
    if (el.props) walk(el.props.children);
  };
  walk(node);
  return out;
}

beforeEach(() => {
  h.visible = new Set();
  h.calls = [];
  h.outcomeFileId = "file-X";
});

describe("inbox message page — the triage outcome names its dossier only to a reader of it", () => {
  it("links the dossier for someone who can see it", async () => {
    h.visible = new Set(["file-X"]);
    const tree = await TriageDetailPage({ params: { id: "tri-1" } });
    const [studio] = elementsOf(tree, TriageStudio);
    const [evidence] = elementsOf(tree, MessageEvidence);
    expect((studio.props.item as { outcomeFileId: string | null }).outcomeFileId).toBe("file-X");
    expect(evidence.props.linkedFileId).toBe("file-X");
    expect(h.calls).toEqual(["visible:user-1:tenant-A:file-X"]);
  });

  it("names it NOWHERE on the page for someone who cannot see it", async () => {
    const tree = await TriageDetailPage({ params: { id: "tri-1" } });
    const [studio] = elementsOf(tree, TriageStudio);
    const [evidence] = elementsOf(tree, MessageEvidence);
    expect((studio.props.item as { outcomeFileId: string | null }).outcomeFileId).toBeNull();
    expect(evidence.props.linkedFileId).toBeNull();
    expect(JSON.stringify(tree)).not.toContain("file-X"); // the whole rendered page
  });

  it("asks nothing when the message was not routed to a dossier", async () => {
    h.outcomeFileId = null;
    const tree = await TriageDetailPage({ params: { id: "tri-1" } });
    expect(elementsOf(tree, MessageEvidence)[0].props.linkedFileId).toBeNull();
    expect(h.calls).toEqual([]);
  });
});

describe("conversation page — same rule, per message", () => {
  it("keeps the dossiers the reader can see and blanks the others", async () => {
    h.visible = new Set(["file-X"]);
    const tree = await ThreadPage({ params: { messageId: "row-1" } });
    const [view] = elementsOf(tree, ThreadView);
    const triage = view.props.triage as { triageId: string; outcomeFileId: string | null }[];
    expect(triage.map((t) => [t.triageId, t.outcomeFileId])).toEqual([
      ["tri-1", "file-X"],
      ["tri-2", null],
      ["tri-3", null],
    ]);
    expect(JSON.stringify(view.props)).not.toContain("file-Y");
    expect(h.calls.sort()).toEqual(["visible:user-1:tenant-A:file-X", "visible:user-1:tenant-A:file-Y"]);
  });
});
