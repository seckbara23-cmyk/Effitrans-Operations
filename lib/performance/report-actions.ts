"use server";

/**
 * The management report lifecycle: BROUILLON → PRÊT POUR REVUE → PUBLIÉ.
 * ---------------------------------------------------------------------------
 * AUTHORITY. Drafting runs on `performance:report:create`, held by
 * PERFORMANCE_MANAGEMENT. Publishing runs on `performance:report:publish`, held
 * ONLY by the PERFORMANCE_PUBLISHER role — reading the indicators must not
 * imply making a set of numbers the company's official record of a period.
 *
 * TIME. Every timestamp is written by the database (`now()` column defaults and
 * the RPC), never by this process and never by a browser. A user with a wrong
 * clock cannot move a publication date.
 *
 * ONE ENGINE. The snapshot is built from `lib/performance/read.ts` — the same
 * service the dashboards read. There is deliberately no second ICTD formula
 * for reporting, and a test asserts this file contains no arithmetic of its own.
 */
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { uploadObject, sha256Hex } from "@/lib/documents/storage";

import {
  collaboratorPerformance,
  ictdDossiers,
  loadCalendar,
  INDICATOR_READINESS,
} from "./read";
import { resolvePeriod } from "./period";
import { buildSnapshot, PARAMETER_SET_VERSION, PERFORMANCE_ENGINE_VERSION } from "./report";
import { renderPerformanceReport, PERFORMANCE_REPORT_RENDERER_VERSION } from "./report-pdf";
import type { ReportActionResult } from "./report-types";
import type { Json } from "@/lib/db/types";

/** Assemble the snapshot from the shared read service. No arithmetic here. */
async function snapshotFor(
  tenantId: string,
  periodParams: { type?: string; anchor?: string; from?: string; to?: string },
) {
  const period = resolvePeriod(periodParams);
  const [collaborators, dossiers, calendar] = await Promise.all([
    collaboratorPerformance(tenantId, period),
    ictdDossiers(tenantId, period),
    loadCalendar(tenantId, period),
  ]);

  const admin = getAdminSupabaseClient();
  const clientIds = [...new Set(dossiers.map((d) => d.clientId).filter((v): v is string => !!v))];
  const clientNames = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data } = await admin
      .from("client")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", clientIds);
    for (const c of data ?? []) clientNames.set(c.id as string, c.name as string);
  }

  return {
    period,
    snapshot: buildSnapshot({
      period,
      collaborators,
      dossiers,
      clientNames,
      calendarDays: calendar.size,
      unavailable: INDICATOR_READINESS,
    }),
  };
}

export async function createReport(input: {
  title: string;
  periodType?: string;
  anchor?: string;
  from?: string;
  to?: string;
  executiveSummary?: string;
}): Promise<ReportActionResult> {
  let user;
  try {
    user = await assertPermission("performance:report:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const title = input.title?.trim() ?? "";
  if (!title) return { ok: false, error: "title_required" };

  const { period } = await snapshotFor(user.tenantId, {
    type: input.periodType,
    anchor: input.anchor,
    from: input.from,
    to: input.to,
  });

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("performance_report")
    .insert({
      tenant_id: user.tenantId,
      title,
      period_kind: period.kind,
      period_start: period.startISO,
      period_end: period.endISO,
      period_label: period.label,
      executive_summary: input.executiveSummary?.trim() || null,
      created_by: user.id,
      // created_at is a column default — database time, not this process's.
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };

  await writeAudit({
    action: AuditActions.PERFORMANCE_REPORT_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "performance_report",
    entityId: data.id as string,
    after: { title, period: period.label },
  });
  return { ok: true, id: data.id as string };
}

/** Edit a draft's prose. Refused once the report is published — by the trigger too. */
export async function updateReportNarrative(
  id: string,
  input: { title?: string; executiveSummary?: string; managementCommentary?: string },
): Promise<ReportActionResult> {
  let user;
  try {
    user = await assertPermission("performance:report:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("performance_report")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "PUBLIE") return { ok: false, error: "published_is_frozen" };

  const patch: { title?: string; executive_summary?: string | null; management_commentary?: string | null } = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) return { ok: false, error: "title_required" };
    patch.title = t;
  }
  if (input.executiveSummary !== undefined) patch.executive_summary = input.executiveSummary.trim() || null;
  if (input.managementCommentary !== undefined) {
    patch.management_commentary = input.managementCommentary.trim() || null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "no_change" };

  const { error } = await admin
    .from("performance_report")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: "update_failed" };
  return { ok: true, id };
}

/** BROUILLON → PRÊT POUR REVUE. */
export async function submitReportForReview(id: string): Promise<ReportActionResult> {
  let user;
  try {
    user = await assertPermission("performance:report:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("performance_report")
    .update({ status: "PRET_POUR_REVUE", submitted_by: user.id, submitted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("status", "BROUILLON") // CAS: only a draft may be submitted
    .select("id");
  if (error) return { ok: false, error: "update_failed" };
  if ((data?.length ?? 0) !== 1) return { ok: false, error: "invalid_state" };

  await writeAudit({
    action: AuditActions.PERFORMANCE_REPORT_SUBMITTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "performance_report",
    entityId: id,
  });
  return { ok: true, id };
}

/** PRÊT POUR REVUE → BROUILLON, for a reviewer who wants changes. */
export async function returnReportToDraft(id: string): Promise<ReportActionResult> {
  let user;
  try {
    user = await assertPermission("performance:report:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("performance_report")
    .update({ status: "BROUILLON", submitted_by: null, submitted_at: null })
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("status", "PRET_POUR_REVUE")
    .select("id");
  if (error) return { ok: false, error: "update_failed" };
  if ((data?.length ?? 0) !== 1) return { ok: false, error: "invalid_state" };
  return { ok: true, id };
}

/**
 * PRÊT POUR REVUE → PUBLIÉ. The irreversible act.
 *
 * The snapshot is computed HERE, at publication, and written in the same
 * statement that flips the status — so what is frozen is what the engine said
 * at the moment of publication, and there is no window in which a published
 * report exists without its evidence (a CHECK constraint refuses that shape
 * anyway). The PDF is rendered FROM the frozen snapshot afterwards, never from
 * live data.
 */
export async function publishReport(id: string): Promise<ReportActionResult> {
  let user;
  try {
    user = await assertPermission("performance:report:publish");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("performance_report")
    .select("id, status, title, period_kind, period_start, period_end, executive_summary, management_commentary, created_by, created_at")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "PUBLIE") return { ok: false, error: "already_published" };
  if (row.status !== "PRET_POUR_REVUE") return { ok: false, error: "not_ready_for_review" };

  const { snapshot } = await snapshotFor(user.tenantId, {
    type: row.period_kind as string,
    anchor: row.period_start as string,
    from: row.period_start as string,
    to: row.period_end as string,
  });

  // ONE atomic act, with the DATABASE's clock. The RPC re-proves the actor's
  // authority, refuses any state but PRÊT POUR REVUE, and writes the status,
  // the snapshot and `published_at = now()` in a single statement — so a
  // published report can never exist without the evidence it was published on,
  // and no application clock can influence when it happened.
  const { data: result, error } = await admin.rpc("publish_performance_report", {
    p_report_id: id,
    p_actor: user.id,
    p_snapshot: snapshot as unknown as Json,
    p_parameter_set_version: PARAMETER_SET_VERSION,
    p_engine_version: PERFORMANCE_ENGINE_VERSION,
  });
  if (error) return { ok: false, error: "publish_failed" };
  const publishedAt = (result as { published_at?: string } | null)?.published_at ?? null;

  // The PDF renders the FROZEN snapshot — `renderPerformanceReport` takes the
  // snapshot and cannot reach the database, so it is structurally incapable of
  // rendering live numbers into a published document. Attaching it is the one
  // write the immutability trigger still allows on a published row, and only
  // while the path is null: an artifact of a frozen record may be produced
  // once, never revised.
  //
  // A render failure must not un-publish anything. The decision is the
  // snapshot; the PDF is a rendering of it, and the report reads « PDF
  // indisponible » rather than pretending otherwise.
  try {
    // Provenance comes from the FROZEN row and from the identity that just
    // published — never recomputed, never a browser clock.
    const { data: people } = await admin
      .from("app_user")
      .select("id, email")
      .eq("tenant_id", user.tenantId)
      .in("id", [row.created_by as string, user.id]);
    const emailOf = new Map((people ?? []).map((u) => [u.id as string, u.email as string | null]));

    const bytes = renderPerformanceReport({
      title: row.title as string,
      snapshot,
      provenance: {
        preparedBy: emailOf.get(row.created_by as string) ?? null,
        createdAt: row.created_at as string,
        publishedBy: emailOf.get(user.id) ?? null,
        publishedAt,
        parameterSetVersion: PARAMETER_SET_VERSION,
        engineVersion: PERFORMANCE_ENGINE_VERSION,
      },
      executiveSummary: row.executive_summary as string | null,
      managementCommentary: row.management_commentary as string | null,
    });
    const path = `performance-reports/${user.tenantId}/${id}.pdf`;
    const up = await uploadObject(path, bytes, "application/pdf");
    if (up.ok) {
      await admin
        .from("performance_report")
        .update({
          artifact_storage_path: path,
          artifact_sha256: sha256Hex(bytes),
          artifact_renderer_version: PERFORMANCE_REPORT_RENDERER_VERSION,
          artifact_generated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("tenant_id", user.tenantId)
        .is("artifact_storage_path", null);
    }
  } catch {
    // Deliberately swallowed — see above.
  }

  await writeAudit({
    action: AuditActions.PERFORMANCE_REPORT_PUBLISHED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "performance_report",
    entityId: id,
    after: {
      parameter_set_version: PARAMETER_SET_VERSION,
      engine_version: PERFORMANCE_ENGINE_VERSION,
    },
  });
  return { ok: true, id };
}
