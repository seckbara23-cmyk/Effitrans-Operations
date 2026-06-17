/**
 * Recent activity feed (Dashboard UX). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * A curated, read-only view of the EXISTING audit_log — no new event system, no
 * schema, no polling. Read through the RLS-respecting user-context client, so the
 * audit_log_select_scoped policy (audit:read:all) is the boundary: only broad-
 * visibility roles get rows at all. On top of that, finance-sensitive events are
 * withheld unless the viewer holds finance:read, and only allow-listed actions
 * surface (lib/activity/classify).
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { activityMeta, isActivityVisible, type ActivityCategory } from "./classify";

export type ActivityItem = {
  id: string;
  occurredAt: string;
  label: string;
  category: ActivityCategory;
  actorEmail: string | null;
  fileId: string | null;
  fileNumber: string | null;
  clientName: string | null;
};

type Row = {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  after: Record<string, unknown> | null;
  occurred_at: string;
  actor: { email: string | null } | null;
};

function fileIdOf(r: Row): string | null {
  if (r.entity === "operational_file" && r.entity_id) return r.entity_id;
  const after = r.after ?? {};
  const fid = (after.file_id ?? after.dossier) as unknown;
  return typeof fid === "string" ? fid : null;
}

export async function getRecentActivity(canSeeFinance: boolean, limit = 10): Promise<ActivityItem[]> {
  const supabase = getServerSupabaseClient();
  // RLS audit_log_select_scoped restricts this to audit:read:all holders.
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, entity, entity_id, after, occurred_at, actor:actor_id(email)")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(60)
    .returns<Row[]>();
  if (error || !data) return [];

  const visible = data.filter((r) => isActivityVisible(r.action, canSeeFinance)).slice(0, limit);
  if (visible.length === 0) return [];

  // Best-effort dossier resolution: one batched lookup, RLS-scoped (no per-row joins).
  const ids = Array.from(new Set(visible.map(fileIdOf).filter((x): x is string => Boolean(x))));
  const fileMap = new Map<string, { number: string | null; client: string | null }>();
  if (ids.length) {
    const { data: files } = await supabase
      .from("operational_file")
      .select("id, file_number, client:client_id(name)")
      .in("id", ids)
      .returns<{ id: string; file_number: string | null; client: { name: string } | null }[]>();
    for (const f of files ?? []) fileMap.set(f.id, { number: f.file_number, client: f.client?.name ?? null });
  }

  return visible.map((r) => {
    const meta = activityMeta(r.action)!;
    const fid = fileIdOf(r);
    const fm = fid ? fileMap.get(fid) : undefined;
    return {
      id: r.id,
      occurredAt: r.occurred_at,
      label: meta.label,
      category: meta.category,
      actorEmail: r.actor?.email ?? null,
      fileId: fm ? fid : null,
      fileNumber: fm?.number ?? null,
      clientName: fm?.client ?? null,
    };
  });
}
