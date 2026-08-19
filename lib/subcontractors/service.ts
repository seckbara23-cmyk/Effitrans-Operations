/**
 * TMS-6 — external transport providers (sous-traitants). SERVER-ONLY reads.
 * ---------------------------------------------------------------------------
 * Gate: `transport:read` — the SAME authority the RLS select policy requires
 * and the one governing every other transport reference-data read. The admin
 * client bypasses RLS, so this app gate is the boundary (EC-3C).
 *
 * A provider is an EXTERNAL company. It is never an Effitrans department (the
 * TMS-5C canonical registry is untouched by this module), never a role, and
 * never a maritime « transporteur » — `ocean_carrier` is the shipping-line
 * plane and is deliberately not reused here.
 *
 * Usage history is DERIVED from transport_record, exactly as vehicle usage is
 * in TMS-5: no execution log is invented.
 */
import "server-only";
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type ProviderStatus = "APPROVED" | "SUSPENDED";

export type TransportProvider = {
  id: string;
  name: string;
  ninea: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: ProviderStatus;
  isActive: boolean;
  notes: string | null;
  /** DERIVED from transport_record — how many transports this provider carried. */
  transportCount: number;
  /** DERIVED — transports still running right now. */
  engagedFileNumbers: string[];
};

type Row = {
  id: string; name: string; ninea: string | null; contact_name: string | null;
  email: string | null; phone: string | null; address: string | null;
  status: string; is_active: boolean; notes: string | null;
};

const COLS = "id, name, ninea, contact_name, email, phone, address, status, is_active, notes";

/** Transport states that mean the provider is carrying work right now. */
export const ENGAGED_TRANSPORT_STATUSES = [
  "PLANNED",
  "DRIVER_ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
] as const;

export async function listProviders(): Promise<TransportProvider[]> {
  const user = await assertPermission("transport:read");
  const supabase = getAdminSupabaseClient();

  const { data } = await supabase
    .from("transport_provider")
    .select(COLS)
    .eq("tenant_id", user.tenantId)
    .order("name", { ascending: true })
    .returns<Row[]>();
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // Usage is a QUERY over the execution machine, never a second log.
  const { data: used } = await supabase
    .from("transport_record")
    .select("provider_id, status, file:file_id(file_number)")
    .eq("tenant_id", user.tenantId)
    .in("provider_id", ids)
    .is("deleted_at", null)
    .returns<{ provider_id: string | null; status: string; file: { file_number: string } | null }[]>();

  const counts = new Map<string, number>();
  const engaged = new Map<string, string[]>();
  for (const t of used ?? []) {
    if (!t.provider_id) continue;
    counts.set(t.provider_id, (counts.get(t.provider_id) ?? 0) + 1);
    if ((ENGAGED_TRANSPORT_STATUSES as readonly string[]).includes(t.status)) {
      const list = engaged.get(t.provider_id) ?? [];
      if (t.file?.file_number) list.push(t.file.file_number);
      engaged.set(t.provider_id, list);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ninea: r.ninea,
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    status: r.status as ProviderStatus,
    isActive: r.is_active,
    notes: r.notes,
    transportCount: counts.get(r.id) ?? 0,
    engagedFileNumbers: engaged.get(r.id) ?? [],
  }));
}

/**
 * Providers bindable to a transport RIGHT NOW: active and APPROVED. The
 * database refuses the rest independently (the interlock trigger) — this read
 * exists so the operator is never offered a choice the server will reject.
 */
export async function listAssignableProviders(): Promise<{ id: string; label: string }[]> {
  const providers = await listProviders();
  return providers
    .filter((p) => p.isActive && p.status === "APPROVED")
    .map((p) => ({ id: p.id, label: p.ninea ? `${p.name} (${p.ninea})` : p.name }));
}
