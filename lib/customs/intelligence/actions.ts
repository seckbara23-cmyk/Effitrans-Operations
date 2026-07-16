"use server";

/**
 * Customs Intelligence — transition + provider-refresh server actions (Phase 7.1B).
 * ---------------------------------------------------------------------------
 * The ONE server-side write path for the canonical lifecycle. It:
 *  - resolves the tenant + actor from the SESSION (never from the browser);
 *  - enforces the existing customs:* permissions (no new permission);
 *  - loads the declaration WITHIN the caller's tenant + dossier visibility;
 *  - validates every transition LOCALLY via the shared state machine / CustomsEngine
 *    (a provider response never drives state on its own);
 *  - persists with COMPARE-AND-SET on intel_version (no stale / concurrent write);
 *  - records the change via the reused CUSTOMS_STATUS_CHANGED audit event (safe metadata).
 *
 * The browser supplies only: the declaration id, the target status, and the version it
 * last saw. Actor id, tenant id, provider credentials, and provider responses are never
 * accepted from the client.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { CustomsEngine, resolveProvider } from "./provider";
import { isDeclarationStatus, type DeclarationStatus } from "./state-machine";
import { transitionAuditPayload } from "./timeline";
import { coerceDeclarationStatus } from "./persistence";
import { mapProviderStatus } from "./status-map";

export type IntelActionResult =
  | { ok: true; status: DeclarationStatus; version: number }
  | { ok: false; error: string };

type Admin = ReturnType<typeof getAdminSupabaseClient>;

const PROVIDER_TIMEOUT_MS = 8000;

/** Bound any provider call so a hung integration can never wedge a request. */
async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type LoadedRow = {
  id: string;
  file_id: string;
  intel_status: string;
  provider_code: string;
  provider_reference: string | null;
  intel_version: number;
  submitted_at: string | null;
  released_at: string | null;
};

async function loadDeclaration(admin: Admin, id: string, tenantId: string): Promise<LoadedRow | null> {
  const { data } = await admin
    .from("customs_record")
    .select("id, file_id, intel_status, provider_code, provider_reference, intel_version, submitted_at, released_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle<LoadedRow>();
  return data ?? null;
}

function revalidate(id: string) {
  revalidatePath("/customs/intelligence");
  revalidatePath(`/customs/intelligence/${id}`);
}

/**
 * Perform an explicit MANUAL canonical transition (operator-driven). Validated locally,
 * persisted with compare-and-set, audited as a MANUAL change (never "provider-confirmed").
 * RELEASED requires customs:release; every other transition requires customs:update.
 */
export async function transitionDeclaration(
  id: string,
  toStatus: string,
  expectedVersion: number,
): Promise<IntelActionResult> {
  if (!isDeclarationStatus(toStatus)) return { ok: false, error: "invalid_status" };
  const needed = toStatus === "RELEASED" ? "customs:release" : "customs:update";
  let user;
  try {
    user = await assertPermission(needed);
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const admin = getAdminSupabaseClient();
  const rec = await loadDeclaration(admin, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const from = coerceDeclarationStatus(rec.intel_status);
  const to = toStatus as DeclarationStatus;
  const engine = new CustomsEngine(resolveProvider(rec.provider_code));
  const verdict = engine.transition(from, to);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const nowIso = new Date().toISOString();
  const patch: {
    intel_status: DeclarationStatus;
    intel_version: number;
    provider_error: null;
    submitted_at?: string;
    provider_reference?: string;
    released_at?: string;
  } = { intel_status: to, intel_version: rec.intel_version + 1, provider_error: null };
  if (to === "SUBMITTED") {
    if (!rec.submitted_at) patch.submitted_at = nowIso;
    if (rec.provider_code === "manual" && !rec.provider_reference) patch.provider_reference = `MANUAL-${rec.id}`;
  }
  if (to === "RELEASED" && !rec.released_at) patch.released_at = nowIso;

  // COMPARE-AND-SET: only the row still at expectedVersion is updated. A stale or
  // concurrent caller matches zero rows and is rejected — no lost update.
  const { data: updated, error } = await admin
    .from("customs_record")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("intel_version", expectedVersion)
    .is("deleted_at", null)
    .select("id, intel_version");
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: "stale_transition" };

  const payload = transitionAuditPayload({ declarationId: id, from, to, provider: rec.provider_code, reason: "manual" });
  await writeAudit({ ...payload, actorId: user.id, tenantId: user.tenantId });

  revalidate(id);
  return { ok: true, status: to, version: rec.intel_version + 1 };
}

/**
 * Refresh a declaration's status from its provider. Provider-configured check first; the
 * provider response is NORMALIZED, then validated against the canonical state machine
 * before anything is persisted. Unknown provider statuses never transition. An unchanged
 * status writes no duplicate timeline event. Provider failures are recorded as a SAFE
 * category (never a raw message). In 7.1B every provider path resolves to not_configured
 * (manual cannot poll; GAINDE is a stub) — recorded honestly, no fabricated status.
 */
export async function refreshDeclaration(id: string): Promise<IntelActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const rec = await loadDeclaration(admin, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const from = coerceDeclarationStatus(rec.intel_status);
  const engine = new CustomsEngine(resolveProvider(rec.provider_code));
  const syncedAt = new Date().toISOString();

  if (!engine.providerConfigured) {
    await recordSync(admin, id, user.tenantId, syncedAt, "not_configured");
    return { ok: false, error: "not_configured" };
  }

  const poll = await withTimeout(engine.poll(from, rec.provider_reference ?? ""), PROVIDER_TIMEOUT_MS, {
    ok: false as const,
    error: "timeout" as const,
  });
  if (!poll.ok) {
    await recordSync(admin, id, user.tenantId, syncedAt, poll.error);
    return { ok: false, error: poll.error };
  }

  const mapped = mapProviderStatus(rec.provider_code, poll.status);
  if (mapped.confidence === "unmapped") {
    // We received a status we do not understand — record it safely, never guess a transition.
    await recordSync(admin, id, user.tenantId, syncedAt, "unavailable");
    return { ok: false, error: "unmapped_status" };
  }
  if (mapped.status === from) {
    // No meaningful change — update the sync marker only; no duplicate timeline event.
    await recordSync(admin, id, user.tenantId, syncedAt, null);
    return { ok: true, status: from, version: rec.intel_version };
  }
  const verdict = engine.transition(from, mapped.status);
  if (!verdict.ok) {
    await recordSync(admin, id, user.tenantId, syncedAt, "unavailable");
    return { ok: false, error: verdict.reason };
  }

  const { data: updated, error } = await admin
    .from("customs_record")
    .update({ intel_status: mapped.status, intel_version: rec.intel_version + 1, provider_synced_at: syncedAt, provider_error: null })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("intel_version", rec.intel_version)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: "stale_transition" };

  const payload = transitionAuditPayload({ declarationId: id, from, to: mapped.status, provider: rec.provider_code, reason: "provider_sync" });
  await writeAudit({ ...payload, actorId: user.id, tenantId: user.tenantId });

  revalidate(id);
  return { ok: true, status: mapped.status, version: rec.intel_version + 1 };
}

/** Record a sync attempt (synced_at + safe error category). Never a raw provider message. */
async function recordSync(admin: Admin, id: string, tenantId: string, syncedAt: string, error: string | null): Promise<void> {
  await admin
    .from("customs_record")
    .update({ provider_synced_at: syncedAt, provider_error: error })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
}
