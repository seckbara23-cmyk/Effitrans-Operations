/**
 * Tenant-scoping wrapper for service-role reads (Phase 4.0A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The service-role admin client BYPASSES RLS, so tenant isolation on those reads
 * depends entirely on a `tenant_id` filter being present on every query. Today
 * that filter is hand-written (`.eq("tenant_id", tenant)`) at ~230 call sites —
 * a single omission is a silent cross-tenant leak with no RLS backstop.
 *
 * `scopedFrom()` makes the tenant filter STRUCTURAL rather than per-call: it
 * injects `.eq("tenant_id", tenantId)` into the select and asserts a valid
 * tenant up front. New service-role reads should use it; existing `.eq` reads
 * are equivalent and enforced by the tenant-scope guard test.
 *
 *   scopedFrom(admin, "operational_file", tenant)
 *     .select("status, created_at")
 *     .returns<FileRow[]>()
 *   // === admin.from("operational_file").select(...).eq("tenant_id", tenant)
 *
 * NOTE: the returned builder is typed with a lightweight local interface, NOT
 * supabase-js's generic query builder. Threading the full `.select` template-
 * literal generics through a generic `table` parameter makes `tsc` blow its heap
 * (the column-string parser expands over every table). The runtime object IS a
 * real PostgrestFilterBuilder; this interface just exposes the chain methods our
 * service-role reads use, with `.returns<T>()` preserved for result typing.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { TENANT_SCOPED_TABLES } from "./tenant-tables";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fail LOUDLY if a tenant id is missing/blank/malformed before it reaches a
 * query. Guards against a resolved-null tenant silently becoming an unscoped or
 * `tenant_id=is.null` filter. Narrows the type to `string` on success.
 */
export function assertTenantId(
  tenantId: string | null | undefined,
  context = "tenant-scoped query",
): asserts tenantId is string {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error(`[tenant-scope] missing tenant id for ${context}`);
  }
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`[tenant-scope] invalid tenant id "${tenantId}" for ${context}`);
  }
}

type PgResponse<Data> = { data: Data | null; count: number | null; error: { message: string } | null };

/** Minimal, non-generic view of a PostgrestFilterBuilder (see file note). */
export interface ScopedQuery<Data = unknown> extends PromiseLike<PgResponse<Data>> {
  eq(column: string, value: unknown): ScopedQuery<Data>;
  neq(column: string, value: unknown): ScopedQuery<Data>;
  in(column: string, values: readonly unknown[]): ScopedQuery<Data>;
  is(column: string, value: unknown): ScopedQuery<Data>;
  gte(column: string, value: unknown): ScopedQuery<Data>;
  lte(column: string, value: unknown): ScopedQuery<Data>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): ScopedQuery<Data>;
  limit(count: number): ScopedQuery<Data>;
  returns<T>(): ScopedQuery<T>;
}

type SelectOptions = { head?: boolean; count?: "exact" | "planned" | "estimated" };

type TableName = keyof Database["public"]["Tables"] & string;

/**
 * Tenant-scoped `.from(table).select(...)` for the service-role admin client.
 * `.select()` applies `.eq("tenant_id", tenantId)` for you; further filters
 * (`.eq`, `.in`, `.is`, ...), `.returns<T>()` and count/head options chain as
 * usual — the only difference is that the tenant filter cannot be forgotten.
 */
export function scopedFrom<T extends TableName>(
  admin: SupabaseClient<Database>,
  table: T,
  tenantId: string,
): { select(columns?: string, options?: SelectOptions): ScopedQuery } {
  if (!TENANT_SCOPED_TABLES.has(table)) {
    throw new Error(`[tenant-scope] scopedFrom() requires a tenant-scoped table; "${table}" is not one`);
  }
  assertTenantId(tenantId, `read on ${table}`);
  // Cast `.from` to a loose signature so tsc does not expand the heavy generic
  // query-builder types over the `table` type parameter (see file note).
  const from = (admin as unknown as { from(t: string): { select(c?: string, o?: SelectOptions): ScopedQuery } }).from;
  return {
    select(columns?: string, options?: SelectOptions): ScopedQuery {
      return from.call(admin, table).select(columns, options).eq("tenant_id", tenantId);
    },
  };
}
