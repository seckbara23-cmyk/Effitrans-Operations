/**
 * Where a notification goes when it is clicked. PURE. Client + server safe.
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE. The bell linked only `fileId`, so every task and
 * every message notification opened nothing at all — 128 of the 281 rows in
 * production at the time of the 01A audit. Destination resolution is a RULE,
 * not markup, so it lives here where it can be tested without rendering.
 *
 * TYPE FIRST, THEN THE IDS IT ACTUALLY HAS. A message belongs in its
 * conversation, a task on the task screen, and everything else on its dossier.
 * Each branch still checks that the id it needs is actually present, because a
 * notification may legitimately carry none — and then there is NO link, rather
 * than a link to a route that cannot resolve.
 *
 * THIS GRANTS NOTHING. An href carries only an id the recipient was already
 * notified about, and every target route re-checks permission server-side when
 * it opens. A user who has since lost access gets that route's own refusal,
 * which is why adding links here adds no authority.
 */
import type { NotificationType } from "./types";

/** The part of a notification that decides where it points. */
export type Linkable = {
  type: NotificationType;
  fileId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
};

/** Types whose subject is a conversation. */
const CONVERSATION_TYPES: ReadonlySet<string> = new Set<string>([
  "MESSAGE_RECEIVED",
  "CONVERSATION_ASSIGNED",
]);

/** Types whose subject is a task. */
const TASK_TYPES: ReadonlySet<string> = new Set<string>([
  "TASK_ASSIGNED",
  "TASK_DUE_SOON",
  "TASK_OVERDUE",
]);

/**
 * A usable id, or null.
 *
 * Blank-guarded rather than null-guarded: a column can hold `""` as easily as
 * NULL, and `/files/` is a worse destination than no link at all.
 */
function usableId(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

/**
 * The route this notification should open, or null when it has no destination.
 *
 * `/tasks` is a list rather than `/tasks/{id}` because that is the route this
 * application actually has; pointing at a dynamic segment that does not exist
 * would be a worse answer than the screen where the task can be actioned.
 */
export function notificationHref(n: Linkable): string | null {
  const conversation = usableId(n.conversationId);
  const task = usableId(n.taskId);
  const file = usableId(n.fileId);

  if (CONVERSATION_TYPES.has(n.type) && conversation) return `/messages/${conversation}`;
  if (TASK_TYPES.has(n.type) && task) return "/tasks";

  // FILE_ASSIGNED and every workflow type are about a dossier.
  if (file) return `/files/${file}`;

  // Still better than nothing: send it wherever it can actually go.
  if (conversation) return `/messages/${conversation}`;
  if (task) return "/tasks";
  return null;
}
