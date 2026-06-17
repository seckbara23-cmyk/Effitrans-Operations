/**
 * Portal shipment progress (Phase 2.4). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Single source of truth: reuses the internal getDossierLifecycle, then maps it
 * to the customer-facing timeline (lib/portal/progress-map). Ownership is
 * verified through the RLS user-context client (the portal user must already be
 * able to see the dossier); the full lifecycle inputs are then read with the
 * admin client PURELY to compute the customer-safe timeline — only the mapped
 * stages / percent / activity are returned, never internal data. No RLS change.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "./auth";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { invoiceTotals, paidAmount, balanceDue } from "@/lib/finance/calc";
import { toPortalTimeline, portalActivity, type PortalTimeline, type PortalStageKey } from "./progress-map";

export type PortalProgress = {
  timeline: PortalTimeline;
  activity: PortalStageKey[];
  lastUpdate: string | null;
  podAvailable: boolean;
};

export async function getPortalProgress(fileId: string): Promise<PortalProgress | null> {
  const user = await getCurrentPortalUser();
  if (!user) return null;

  // Ownership via RLS: a portal user only resolves their own client's dossier.
  const ctx = getServerSupabaseClient();
  const { data: own } = await ctx
    .from("operational_file")
    .select("id, status, type, updated_at")
    .eq("id", fileId)
    .maybeSingle<{ id: string; status: string; type: string; updated_at: string }>();
  if (!own) return null;

  // Ownership confirmed — read full inputs (admin) only to derive the timeline.
  const admin = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const [docsRes, typesRes, customsRes, transportRes, invRes] = await Promise.all([
    admin.from("document").select("type_code, status, shared_with_client").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).returns<{ type_code: string; status: string; shared_with_client: boolean }[]>(),
    admin.from("document_type").select("code, required_for").eq("active", true).returns<{ code: string; required_for: string[] | null }[]>(),
    admin.from("customs_record").select("status, required, updated_at").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ status: string; required: boolean; updated_at: string }>(),
    admin.from("transport_record").select("status, updated_at").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ status: string; updated_at: string }>(),
    admin.from("invoice").select("id, status, updated_at").eq("tenant_id", tenant).eq("file_id", fileId).returns<{ id: string; status: string; updated_at: string }[]>(),
  ]);

  const docs = docsRes.data ?? [];
  const approved = new Set(docs.filter((d) => d.status === "APPROVED").map((d) => d.type_code));
  const missingRequired = (typesRes.data ?? [])
    .filter((t) => (t.required_for ?? []).includes(own.type) && !approved.has(t.code))
    .map((t) => ({ label: t.code }));
  const podApproved = docs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");

  // Invoice balances for the lifecycle (no amounts exposed in the timeline).
  const invoices: { status: string; balance: number }[] = [];
  const invIds = (invRes.data ?? []).map((i) => i.id);
  if (invIds.length) {
    const [lineRes, payRes] = await Promise.all([
      admin.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenant).in("invoice_id", invIds).returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>(),
      admin.from("payment").select("invoice_id, amount, reversed_at").eq("tenant_id", tenant).in("invoice_id", invIds).returns<{ invoice_id: string; amount: number; reversed_at: string | null }[]>(),
    ]);
    for (const inv of invRes.data ?? []) {
      const lines = (lineRes.data ?? []).filter((l) => l.invoice_id === inv.id).map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) }));
      const pays = (payRes.data ?? []).filter((p) => p.invoice_id === inv.id).map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null }));
      invoices.push({ status: inv.status, balance: balanceDue(invoiceTotals(lines).total, paidAmount(pays)) });
    }
  }

  const lifecycle = getDossierLifecycle({
    fileId,
    file: { status: own.status, type: own.type },
    documents: docs.map((d) => ({ status: d.status })),
    missingRequired,
    customs: customsRes.data ? { status: customsRes.data.status, required: customsRes.data.required } : null,
    transport: transportRes.data ? { status: transportRes.data.status } : null,
    invoices,
    podApproved,
  });

  const timeline = toPortalTimeline(lifecycle.steps);
  const podAvailable = docs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED" && d.shared_with_client);
  const lastUpdate = [own.updated_at, customsRes.data?.updated_at, transportRes.data?.updated_at, ...(invRes.data ?? []).map((i) => i.updated_at)]
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop() ?? null;

  return { timeline, activity: portalActivity(timeline), lastUpdate, podAvailable };
}
