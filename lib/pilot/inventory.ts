/**
 * Live dossier inventory (Phase 5.0E-2B, Deliverable 12). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The historical-compatibility decision has been blocked since Phase 5.0A on one
 * missing fact: what the live dossier status distribution actually IS. Nobody could
 * answer it, so the backfill has stayed a dry run for two phases, which is the right
 * call — you do not migrate what you have not counted.
 *
 * This produces exactly the aggregate needed to unblock that decision, and nothing
 * else:
 *
 *     select status, count(*) from operational_file group by status;
 *
 * plus, per status: how many already have a process instance, and the age range.
 *
 * AGGREGATES ONLY. No file number, no client, no reference, no cargo, no amount —
 * the queries below select `status`, `created_at` and `id` and nothing more. A
 * migration decision needs counts; it does not need to see a single customer's data,
 * and a tool that showed them would be a tool someone eventually browses.
 *
 * READ-ONLY. There is no apply counterpart. This does not, and cannot, run a backfill.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";

export type InventoryBucket = {
  status: string;
  count: number;
  /** How many of these already have a process instance (i.e. need no backfill). */
  withInstance: number;
  /** How many would need one. THE number the compatibility decision turns on. */
  withoutInstance: number;
  oldestDays: number | null;
  newestDays: number | null;
};

export type DossierInventory = {
  buckets: InventoryBucket[];
  total: number;
  totalWithInstance: number;
  totalWithoutInstance: number;
  /** Delivered/closed dossiers are the ones a backfill could safely leave alone. */
  terminalWithoutInstance: number;
  generatedAt: string;
};

/** Statuses that mean the dossier's operational life is over. */
const TERMINAL = new Set(["DELIVERED", "CLOSED", "CANCELLED", "COMPLETED"]);

export async function getDossierInventory(tenantId: string): Promise<DossierInventory> {
  const admin = getAdminSupabaseClient();
  const now = Date.now();

  const [{ data: files }, { data: instances }] = await Promise.all([
    // id + status + created_at. Nothing that identifies a customer or a shipment.
    scopedFrom(admin, "operational_file", tenantId)
      .select("id, status, created_at")
      .is("deleted_at", null),
    scopedFrom(admin, "process_instance", tenantId).select("file_id"),
  ]);

  const hasInstance = new Set(
    ((instances ?? []) as { file_id: string }[]).map((r) => r.file_id),
  );

  const byStatus = new Map<string, { rows: number; withInstance: number; ages: number[] }>();

  for (const f of (files ?? []) as { id: string; status: string; created_at: string }[]) {
    const status = f.status ?? "UNKNOWN";
    const b = byStatus.get(status) ?? { rows: 0, withInstance: 0, ages: [] };
    b.rows++;
    if (hasInstance.has(f.id)) b.withInstance++;
    if (f.created_at) {
      b.ages.push(Math.floor((now - new Date(f.created_at).getTime()) / 86_400_000));
    }
    byStatus.set(status, b);
  }

  const buckets: InventoryBucket[] = [...byStatus.entries()]
    .map(([status, b]) => ({
      status,
      count: b.rows,
      withInstance: b.withInstance,
      withoutInstance: b.rows - b.withInstance,
      oldestDays: b.ages.length ? Math.max(...b.ages) : null,
      newestDays: b.ages.length ? Math.min(...b.ages) : null,
    }))
    .sort((a, b) => a.status.localeCompare(b.status));

  const total = buckets.reduce((n, b) => n + b.count, 0);
  const totalWithInstance = buckets.reduce((n, b) => n + b.withInstance, 0);

  return {
    buckets,
    total,
    totalWithInstance,
    totalWithoutInstance: total - totalWithInstance,
    terminalWithoutInstance: buckets
      .filter((b) => TERMINAL.has(b.status))
      .reduce((n, b) => n + b.withoutInstance, 0),
    generatedAt: new Date().toISOString(),
  };
}
