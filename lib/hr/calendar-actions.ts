"use server";

/**
 * D3 — HR maintenance of the working-day calendar (`hr_calendar_day`).
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-08-28: HR owns and maintains the calendar of non-worked days —
 * Senegal public holidays and Effitrans exceptional closures — that every
 * jours-ouvrés and capacity calculation excludes. The table has no RLS write
 * policy (the HR-A2 idiom): these actions ARE the boundary, gated on
 * `hr:manage` exactly like the rest of the HR registry, and no operational
 * role acquires any authority here.
 *
 * The calendar is KPI time-base data, so every mutation is audited with the
 * full row in before/after — a removed férié must remain reconstructible.
 */
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

// Values and types live in ./calendar — a "use server" module may export only
// async functions, and a constant array is an object export that fails at page
// build rather than at typecheck.
import {
  CALENDAR_DAY_KINDS,
  type CalendarActionResult,
  type CalendarDayKind,
  type CalendarDayRow,
} from "./calendar";

/**
 * The tenant's calendar for one year, ordered.
 *
 * Read gate (UAT-PERF-CALENDAR-01, ratified): `hr:read OR performance:read` —
 * an authorized Performance reader may see the time base behind figures they
 * can already read. Mirrors the RLS select policy (migration 134) exactly, so
 * the two layers cannot drift; a test pins this gate to the page's. Management
 * below stays hr:manage — HR owns the calendar, Performance consumes it.
 */
export async function listCalendarDays(year: number): Promise<CalendarDayRow[]> {
  let user;
  try {
    user = await assertPermission("hr:read");
  } catch {
    try {
      user = await assertPermission("performance:read");
    } catch {
      return [];
    }
  }
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("hr_calendar_day")
    .select("id, day, kind, label")
    .eq("tenant_id", user.tenantId)
    .gte("day", `${year}-01-01`)
    .lte("day", `${year}-12-31`)
    .order("day", { ascending: true });
  return (data ?? []) as CalendarDayRow[];
}

export async function addCalendarDay(input: {
  day: string;
  kind: CalendarDayKind;
  label: string;
}): Promise<CalendarActionResult> {
  let user;
  try {
    user = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || Number.isNaN(Date.parse(`${input.day}T00:00:00Z`))) {
    return { ok: false, error: "invalid_day" };
  }
  if (!CALENDAR_DAY_KINDS.includes(input.kind)) return { ok: false, error: "invalid_kind" };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "label_required" };

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("hr_calendar_day")
    .insert({
      tenant_id: user.tenantId,
      day: input.day,
      kind: input.kind,
      label,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    // unique (tenant_id, day): one ruling per day.
    if (error?.code === "23505") return { ok: false, error: "day_exists" };
    return { ok: false, error: error?.message ?? "insert_failed" };
  }

  await writeAudit({
    action: AuditActions.HR_CALENDAR_DAY_ADDED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "hr_calendar_day",
    entityId: data.id as string,
    after: { day: input.day, kind: input.kind, label },
  });
  return { ok: true, id: data.id as string };
}

export async function removeCalendarDay(id: string): Promise<CalendarActionResult> {
  let user;
  try {
    user = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("hr_calendar_day")
    .select("id, day, kind, label")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };

  const { error } = await admin
    .from("hr_calendar_day")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.HR_CALENDAR_DAY_REMOVED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "hr_calendar_day",
    entityId: id,
    before: { day: row.day, kind: row.kind, label: row.label },
  });
  return { ok: true, id };
}
