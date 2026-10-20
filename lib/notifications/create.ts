/**
 * Notification creation (Phase 1.6). SERVER-ONLY (internal).
 * ---------------------------------------------------------------------------
 * Not a server action — called from within other server actions (e.g. assignTask)
 * via the service-role admin client. Best-effort: a failed notification must
 * NEVER fail the parent business action, so errors are swallowed (logged).
 * After persisting, hands off to the dispatch stub (no external provider yet).
 *
 * 01B-B2 — THE OUTCOME IS NOW OBSERVABLE WITHOUT BEING FATAL. This returned
 * `void`, so a swallowed failure was indistinguishable from a delivered
 * notification to every caller and to anyone reading the logs afterwards. It
 * now returns `{ ok }`. Nobody is obliged to check it; nothing throws if they
 * do not. The contract that matters is unchanged: the parent action still
 * cannot fail because of a notification.
 *
 * 01B-B2 — AND FAN-OUT IS BOUNDED, NOT CAPPED. `createNotifications` runs a
 * list of recipients in chunks so a role with twenty members is no longer
 * twenty sequential round trips on an operator's critical path. Concurrency is
 * bounded; the RECIPIENT LIST IS NOT. Every authorized recipient is attempted,
 * because silently telling fewer people than the workflow requires would be a
 * worse defect than the latency it saved.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { dispatchNotification } from "./dispatch";
import type { NotificationType } from "./types";

export type CreateNotificationInput = {
  tenantId: string;
  userId: string; // recipient
  type: NotificationType;
  taskId?: string | null;
  fileId?: string | null;
  conversationId?: string | null;
  title: string;
  body?: string | null;
};

/** What a creation attempt did. `ok: false` means nothing was persisted. */
export type CreateNotificationResult = { ok: boolean };

/**
 * How many inserts are in flight at once during a fan-out.
 *
 * Five is chosen to be unremarkable: enough that a departmental role stops
 * being a serial queue, small enough that a fan-out cannot monopolise the
 * connection pool a dossier transaction is also using.
 */
export const NOTIFICATION_FANOUT_CONCURRENCY = 5;

export async function createNotification(
  input: CreateNotificationInput,
): Promise<CreateNotificationResult> {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("notification")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      type: input.type,
      task_id: input.taskId ?? null,
      file_id: input.fileId ?? null,
      conversation_id: input.conversationId ?? null,
      title: input.title,
      body: input.body ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Best-effort: never break the parent action. Reported, and now also
    // RETURNED, so a caller fanning out can count what did not land.
    console.error(`[notifications] create failed: ${error?.message ?? "unknown"}`);
    return { ok: false };
  }

  await dispatchNotification({
    id: data.id,
    tenantId: input.tenantId,
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
  });

  return { ok: true };
}

/** What a fan-out managed to do. Reported, never thrown. */
export type FanOutResult = { attempted: number; created: number; failed: number };

/**
 * Create one notification per recipient, with bounded concurrency.
 *
 * ERROR ISOLATION IS STRUCTURAL: `allSettled` means one recipient's failure
 * cannot abort the rest, and the whole fan-out cannot throw into the business
 * action that called it. Order is not preserved and does not matter — these are
 * independent per-recipient rows with no relationship to each other.
 */
export async function createNotifications(
  inputs: readonly CreateNotificationInput[],
): Promise<FanOutResult> {
  let created = 0;
  let failed = 0;

  for (let i = 0; i < inputs.length; i += NOTIFICATION_FANOUT_CONCURRENCY) {
    const chunk = inputs.slice(i, i + NOTIFICATION_FANOUT_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((input) => createNotification(input)));
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value.ok) created += 1;
      else failed += 1;
    }
  }

  if (failed > 0) {
    // The one thing worse than a lost notification is a lost notification
    // nobody can see was lost.
    console.error(
      `[notifications] fan-out incomplete: ${failed}/${inputs.length} not created`,
    );
  }

  return { attempted: inputs.length, created, failed };
}
