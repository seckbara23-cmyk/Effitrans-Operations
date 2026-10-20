/**
 * 01B-B1 / B5 — notification destinations and bell refresh.
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS PINS. The bell linked `fileId` and nothing else, so of the
 * 281 notifications in production at the 01A audit, the 120 TASK_ASSIGNED and
 * 8 MESSAGE_RECEIVED rows — 128 of them — opened nothing at all. They marked
 * themselves read and left the operator where they were.
 *
 * The RULE is pure, so it is tested directly and exhaustively. The COMPONENT's
 * use of it is asserted structurally: rendering the bell would prove nothing
 * here, because its list only exists once a server action has resolved and the
 * popover is open, neither of which happens in static markup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { notificationHref } from "@/lib/notifications/links";
import type { NotificationType } from "@/lib/notifications/types";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const bell = read("components/notifications/notification-bell.tsx");

const FILE = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

/** Every type the application can emit today. */
const ALL_TYPES: NotificationType[] = [
  "TASK_ASSIGNED",
  "TASK_DUE_SOON",
  "TASK_OVERDUE",
  "FILE_ASSIGNED",
  "MESSAGE_RECEIVED",
  "CONVERSATION_ASSIGNED",
];

// ===========================================================================
describe("B1 — a message opens its conversation", () => {
  it("1 — MESSAGE_RECEIVED goes to the conversation, not the dossier", () => {
    // The row carries BOTH ids for a dossier conversation. The message is the
    // subject, so the conversation wins.
    expect(notificationHref({ type: "MESSAGE_RECEIVED", conversationId: CONV, fileId: FILE }))
      .toBe(`/messages/${CONV}`);
  });

  it("2 — CONVERSATION_ASSIGNED does the same", () => {
    expect(notificationHref({ type: "CONVERSATION_ASSIGNED", conversationId: CONV }))
      .toBe(`/messages/${CONV}`);
  });

  it("3 — …but a message with no conversation id falls back rather than breaking", () => {
    expect(notificationHref({ type: "MESSAGE_RECEIVED", conversationId: null, fileId: FILE }))
      .toBe(`/files/${FILE}`);
  });
});

// ===========================================================================
describe("B1 — a task opens the task screen", () => {
  it("4 — every task type goes to /tasks, even when a dossier id is present", () => {
    // Handoff notifications carry both. The task is what the recipient must act
    // on, so the task screen wins.
    for (const type of ["TASK_ASSIGNED", "TASK_DUE_SOON", "TASK_OVERDUE"] as NotificationType[]) {
      expect(notificationHref({ type, taskId: TASK, fileId: FILE }), type).toBe("/tasks");
    }
  });

  it("5 — a task type with no task id falls back to its dossier", () => {
    expect(notificationHref({ type: "TASK_ASSIGNED", taskId: null, fileId: FILE }))
      .toBe(`/files/${FILE}`);
  });
});

// ===========================================================================
describe("B1 — everything else opens its dossier, and FILE_ASSIGNED is unchanged", () => {
  it("6 — FILE_ASSIGNED still goes exactly where it always went", () => {
    // 153 production rows depend on this not regressing.
    expect(notificationHref({ type: "FILE_ASSIGNED", fileId: FILE })).toBe(`/files/${FILE}`);
  });

  it("7 — a FILE_ASSIGNED that also carries a task id still goes to the dossier", () => {
    expect(notificationHref({ type: "FILE_ASSIGNED", fileId: FILE, taskId: TASK }))
      .toBe(`/files/${FILE}`);
  });
});

// ===========================================================================
describe("B1 — a destination it cannot resolve is NO link", () => {
  it("8 — no ids at all ⇒ null, for every type", () => {
    for (const type of ALL_TYPES) {
      expect(notificationHref({ type }), type).toBeNull();
      expect(notificationHref({ type, fileId: null, taskId: null, conversationId: null }), type)
        .toBeNull();
    }
  });

  it("9 — a blank or whitespace id is not an id", () => {
    // `/files/` is a worse destination than none. A column can hold "" as
    // easily as NULL.
    for (const blank of ["", "   ", "\t"]) {
      expect(notificationHref({ type: "FILE_ASSIGNED", fileId: blank }), JSON.stringify(blank))
        .toBeNull();
      expect(notificationHref({ type: "MESSAGE_RECEIVED", conversationId: blank }), JSON.stringify(blank))
        .toBeNull();
    }
  });

  it("10 — an id is never interpolated with surrounding whitespace", () => {
    expect(notificationHref({ type: "FILE_ASSIGNED", fileId: `  ${FILE}  ` }))
      .toBe(`/files/${FILE}`);
  });
});

// ===========================================================================
describe("B1 — the bell actually uses the rule", () => {
  it("11 — it imports the helper and renders its result", () => {
    expect(bell).toContain('from "@/lib/notifications/links"');
    expect(bell).toContain("const href = notificationHref(n);");
    expect(bell).toContain("{href ? (");
  });

  it("12 — the hardcoded dossier-only link is GONE", () => {
    // The whole defect in one assertion.
    expect(bell).not.toContain("{n.fileId ? (");
    expect(bell).not.toContain("href={`/files/${n.fileId}`}");
  });

  it("13 — an item with no destination still marks itself read", () => {
    // It becomes a button, not a dead link: the operator can still clear it.
    expect(bell).toContain("<button onClick={() => onItem(n.id)}");
  });
});

// ===========================================================================
describe("B5 — the bell refreshes itself, and cleans up after itself", () => {
  it("14 — it refreshes on return-to-tab and on focus", () => {
    expect(bell).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(bell).toContain('window.addEventListener("focus", load)');
    expect(bell).toContain('document.visibilityState === "visible"');
  });

  it("15 — it polls a VISIBLE tab only, on a 60-second tick", () => {
    expect(bell).toContain("window.setInterval(");
    expect(bell).toContain("60_000");
    // The guard inside the tick is what stops a parked browser polling forever.
    const tick = bell.slice(bell.indexOf("window.setInterval("));
    expect(tick).toContain('document.visibilityState === "visible"');
  });

  it("16 — every listener and the interval are removed on unmount", () => {
    expect(bell).toContain("window.clearInterval(timer)");
    expect(bell).toContain('document.removeEventListener("visibilitychange", onVisibility)');
    expect(bell).toContain('window.removeEventListener("focus", load)');
  });

  it("17 — overlapping requests are impossible", () => {
    // Focus, visibilitychange and the interval can fire in the same second.
    expect(bell).toContain("const inFlight = useRef(false)");
    expect(bell).toContain("if (inFlight.current) return;");
    expect(bell).toContain("inFlight.current = true;");
    // Released in `finally`, so a rejected fetch cannot wedge the bell shut.
    expect(bell).toContain(".finally(");
  });

  it("18 — mark-read authorization is untouched by this slice", () => {
    // The actions still do the work; the component never writes directly.
    expect(bell).toContain("markNotificationRead(id)");
    expect(bell).toContain("markAllNotificationsRead()");
    expect(bell).not.toContain("getAdminSupabaseClient");
    expect(bell).not.toContain('from("notification")');
  });
});
