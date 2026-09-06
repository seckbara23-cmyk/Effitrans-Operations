import "server-only";
/**
 * THE reader of `process_step_owning_role`.
 * ---------------------------------------------------------------------------
 * Which role owns a step is the authoritative answer to "is this work yours",
 * and by the time three surfaces needed it there were about to be three copies
 * of the same query. One is enough, and it is the only place that has to know
 * the table is a GLOBAL registry mirror keyed by `step_key` — no tenant column,
 * so it is read directly rather than through `scopedFrom`.
 *
 * ALWAYS BATCHED. It takes a list, never a single key inside a loop: a
 * per-step read here would be the N+1 the contextual surfaces exist to avoid.
 *
 * NOT THE REGISTRY'S `role` FIELD, deliberately. That field is documentary and
 * names roles that do not exist in any tenant (DEC-C35 records the trap and
 * forbids rewriting it to fix an authority statement). This table is what
 * `assertControlOwner` and `activateStep` enforce against.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

/** step_key -> role_code, for the steps asked about. ONE bounded read. */
export async function owningRoleByStepKey(
  stepKeys: readonly string[],
): Promise<Map<string, string>> {
  const keys = [...new Set(stepKeys)];
  if (keys.length === 0) return new Map();
  const admin = getAdminSupabaseClient();
  // The generated types do not carry this table (it is a projection added by
  // migration, not by `db:types`), so the client is narrowed by hand here — in
  // ONE place — rather than cast at each call site.
  const { data } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => { in: (k: string, v: string[]) => Promise<{ data: Row[] | null }> };
    };
  })
    .from("process_step_owning_role")
    .select("step_key, role_code")
    .in("step_key", keys);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Row[]) out.set(r.step_key as string, r.role_code as string);
  return out;
}
