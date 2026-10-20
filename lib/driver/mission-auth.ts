/**
 * Driver mission authorization + dispatcher notify (Phase 3.4C-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Shared helpers for the driver write actions: resolve the DRIVER caller, load a
 * transport ONLY if it is assigned to them (driver_user_id = caller), find the
 * current live session, and notify the dossier's dispatch owners. Trusted
 * associations are always derived server-side — never taken from the browser.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { createNotifications } from "@/lib/notifications/create";
import type { NotificationType } from "@/lib/notifications/types";
import { isDriver } from "./auth";
import { isLiveSession, sessionBlock, type SessionBlock } from "./mission-gates";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export async function driverContext(): Promise<CurrentUser | null> {
  const u = await getCurrentUser();
  return u && isDriver(u) ? u : null;
}

export type AssignedTransport = { id: string; file_id: string; status: string };

export async function loadAssignedTransport(supabase: Admin, user: CurrentUser, transportId: string): Promise<AssignedTransport | null> {
  const { data } = await supabase
    .from("transport_record")
    .select("id, file_id, status, driver_user_id")
    .eq("id", transportId)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data || data.driver_user_id !== user.id) return null;
  return { id: data.id, file_id: data.file_id, status: data.status };
}

export type LiveSession = { id: string; status: string; file_id: string };

export type LiveSessionLookup =
  | { ok: true; session: LiveSession }
  | { ok: false; error: SessionBlock };

/**
 * The live session to record against — or the REASON there is none.
 *
 * UAT-TRANSPORT-POD-FIX-01. This matched ACTIVE|PAUSED and returned null,
 * which cost the 2026-10-10 UAT its delivery twice over: a session on the
 * RETURN leg counted as no session at all, and "none" and "already finished"
 * reached the driver as one sentence. RETURNING is a live session now (see
 * ./mission-gates), and a finished one is reported as finished, so the screen
 * can tell her to call the office instead of to start a mission that is over.
 *
 * Still ONE query, still tenant- and transport-scoped. A live row wins even
 * when a finished one is newer, so a stray extra row cannot mask a mission
 * that is still under way.
 */
export async function liveSessionOrError(
  supabase: Admin,
  user: CurrentUser,
  transportId: string,
): Promise<LiveSessionLookup> {
  const { data } = await supabase
    .from("tracking_session")
    .select("id, status, file_id")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", transportId)
    .order("started_at", { ascending: false })
    .limit(5);
  const rows = data ?? [];
  const live = rows.find((r) => isLiveSession(r.status));
  if (live) return { ok: true, session: { id: live.id, status: live.status, file_id: live.file_id } };
  return { ok: false, error: sessionBlock(rows[0]?.status ?? null) ?? "no_session" };
}

/** Notify the dossier's dispatch owners (account manager / coordinator / creator). */
/**
 * Tell the office. The recipient set is resolved server-side from the dossier's
 * own people — account manager, coordinator, creator — and de-duplicated.
 *
 * 01B — `type` is a parameter so a caller can say what actually happened
 * instead of every alert arriving labelled FILE_ASSIGNED. It defaults to
 * FILE_ASSIGNED so the existing delay and incident callers are unchanged.
 */
export async function notifyDispatchers(
  supabase: Admin,
  tenantId: string,
  fileId: string,
  title: string,
  body: string,
  type: NotificationType = "FILE_ASSIGNED",
): Promise<void> {
  const { data: file } = await supabase
    .from("operational_file")
    .select("account_manager_id, coordinator_id, created_by")
    .eq("id", fileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!file) return;
  const targets = new Set<string>(
    [file.account_manager_id, file.coordinator_id, file.created_by].filter((x): x is string => Boolean(x)),
  );
  // Bounded concurrency, every target attempted — see 01B-B2 in
  // lib/notifications/create.ts.
  await createNotifications(
    [...targets].map((uid) => ({ tenantId, userId: uid, type, fileId, title, body })),
  );
}
