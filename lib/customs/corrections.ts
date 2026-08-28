/**
 * D4 — reading the governed correction history.
 *
 * The table is append-only and WORM-triggered; nothing here can write to it.
 * Reads go through the admin client, so this module rebuilds the tenant filter
 * the RLS policy would have applied — the admin client bypasses RLS, and a
 * missing `.eq("tenant_id", …)` here would be a cross-tenant leak that no
 * database policy is in a position to catch.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type CorrectionChange = { old: string | number | null; new: string | number | null };

export type CustomsCorrectionRow = {
  id: string;
  customsId: string;
  fileId: string;
  fileNumber: string;
  correctedAt: string;
  correctedByEmail: string | null;
  reason: string;
  changes: Record<string, CorrectionChange>;
  validatedAtBefore: string;
  validatedByBeforeEmail: string | null;
  /** True when the record carries a certification again. */
  revalidated: boolean;
};

/** Tenant-wide history, newest first. */
export async function listCustomsCorrections(
  tenantId: string,
  limit = 100,
): Promise<CustomsCorrectionRow[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("customs_correction")
    .select("id, customs_id, file_id, corrected_at, corrected_by, reason, changes, validated_by_before, validated_at_before")
    .eq("tenant_id", tenantId)
    .order("corrected_at", { ascending: false })
    .limit(limit);
  if (!data || data.length === 0) return [];

  const fileIds = [...new Set(data.map((r) => r.file_id as string))];
  const userIds = [
    ...new Set(
      data.flatMap((r) => [r.corrected_by as string, r.validated_by_before as string]).filter(Boolean),
    ),
  ];
  const customsIds = [...new Set(data.map((r) => r.customs_id as string))];

  const [files, users, records] = await Promise.all([
    admin.from("operational_file").select("id, file_number").eq("tenant_id", tenantId).in("id", fileIds),
    admin.from("app_user").select("id, email").eq("tenant_id", tenantId).in("id", userIds),
    admin.from("customs_record").select("id, reviewed_at").eq("tenant_id", tenantId).in("id", customsIds),
  ]);

  const numberOf = new Map((files.data ?? []).map((f) => [f.id as string, f.file_number as string]));
  const emailOf = new Map((users.data ?? []).map((u) => [u.id as string, u.email as string | null]));
  const certified = new Map(
    (records.data ?? []).map((r) => [r.id as string, (r.reviewed_at as string | null) !== null]),
  );

  return data.map((r) => ({
    id: r.id as string,
    customsId: r.customs_id as string,
    fileId: r.file_id as string,
    fileNumber: numberOf.get(r.file_id as string) ?? "—",
    correctedAt: r.corrected_at as string,
    correctedByEmail: emailOf.get(r.corrected_by as string) ?? null,
    reason: r.reason as string,
    changes: (r.changes ?? {}) as Record<string, CorrectionChange>,
    validatedAtBefore: r.validated_at_before as string,
    validatedByBeforeEmail: emailOf.get(r.validated_by_before as string) ?? null,
    revalidated: certified.get(r.customs_id as string) ?? false,
  }));
}

/** The correction history of ONE customs record, oldest first. */
export async function correctionsForRecord(
  tenantId: string,
  customsId: string,
): Promise<CustomsCorrectionRow[]> {
  const all = await listCustomsCorrections(tenantId, 200);
  return all.filter((c) => c.customsId === customsId).reverse();
}
