"use server";

/**
 * TMS-6 — external transport providers (sous-traitants). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * AUTHORITY, resolved from the repository and NOT invented: registering,
 * editing and suspending a provider is `transport:manage` — the same authority
 * that already governs every transport master-data entity (ocean carriers,
 * ports, vessels, airports, and TMS-5's vehicles). Binding a provider to a
 * transport is `transport:assign` and lives in lib/transport/actions.ts beside
 * driver and vehicle assignment. Reading is `transport:read`.
 *
 * No permission was created for this phase, and nothing here touches the
 * canonical department registry: a subcontractor is an EXTERNAL company, not
 * an Effitrans department.
 */
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export type ProviderResult = { ok: true; id?: string } | { ok: false; error: string };

const STATUSES = ["APPROVED", "SUSPENDED"];

export type ProviderInput = {
  name: string;
  ninea?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

const text = (v: string | null | undefined, max = 120): string | null => {
  const s = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};

function revalidate() {
  revalidatePath("/transport/sous-traitants");
  revalidatePath("/departments/transport");
}

/** Register an external transport provider. */
export async function createProvider(input: ProviderInput): Promise<ProviderResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const name = text(input.name, 120);
  if (!name) return { ok: false, error: "name_required" };

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("transport_provider")
    .insert({
      tenant_id: user.tenantId,
      name,
      ninea: text(input.ninea, 32),
      contact_name: text(input.contactName, 120),
      email: text(input.email, 160),
      phone: text(input.phone, 40),
      address: text(input.address, 240),
      notes: text(input.notes, 500),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "duplicate_name" };
    return { ok: false, error: error?.message ?? "create_failed" };
  }

  await writeAudit({
    action: AuditActions.PROVIDER_CREATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "transport_provider", entityId: data.id,
    after: { name },
  });
  revalidate();
  return { ok: true, id: data.id };
}

/** Edit a provider's identity and contact details. */
export async function updateProvider(id: string, input: ProviderInput): Promise<ProviderResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const name = text(input.name, 120);
  if (!name) return { ok: false, error: "name_required" };

  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("transport_provider")
    .update({
      name,
      ninea: text(input.ninea, 32),
      contact_name: text(input.contactName, 120),
      email: text(input.email, 160),
      phone: text(input.phone, 40),
      address: text(input.address, 240),
      notes: text(input.notes, 500),
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "duplicate_name" };
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: AuditActions.PROVIDER_UPDATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "transport_provider", entityId: id,
    after: { name },
  });
  revalidate();
  return { ok: true, id };
}

/**
 * Approve or suspend. A SUSPENDED provider cannot be bound to a new transport
 * (the DB interlock refuses it); transports it already carries are untouched —
 * suspending is not a retro-active cancellation of work already done.
 */
export async function setProviderStatus(id: string, status: string, reason?: string | null): Promise<ProviderResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!STATUSES.includes(status)) return { ok: false, error: "invalid_status" };

  const supabase = getAdminSupabaseClient();
  const { data: current } = await supabase
    .from("transport_provider")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ id: string; status: string }>();
  if (!current) return { ok: false, error: "not_found" };
  if (current.status === status) return { ok: true, id };

  const { error } = await supabase
    .from("transport_provider")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.PROVIDER_STATUS_CHANGED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "transport_provider", entityId: id,
    before: { status: current.status },
    after: { status, reason: text(reason, 300) },
  });
  revalidate();
  return { ok: true, id };
}

/** Retire (or restore) a provider. Never deletes: past transports keep their carrier. */
export async function setProviderActive(id: string, isActive: boolean): Promise<ProviderResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("transport_provider")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.PROVIDER_UPDATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "transport_provider", entityId: id,
    after: { is_active: isActive },
  });
  revalidate();
  return { ok: true, id };
}
