/**
 * Closure input loader (Phase 5.0D-4). SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * Assembles everything the authoritative closure evaluator needs, in a bounded
 * batch. Reuses the EXISTING truth for every fact — nothing is recomputed and no
 * second ledger is created:
 *
 *   balance   = invoiceTotals(invoice_line) - Σ non-reversed payments
 *               (lib/finance/calc.ts — the same figure invoice.status is driven by)
 *   POD       = an APPROVED DELIVERY_NOTE document
 *   deposit   = invoice_deposit.status + client.requires_physical_invoice_deposit
 *   steps     = process_step_execution
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { balanceDue, invoiceTotals, paidAmount } from "@/lib/finance/calc";
import type { ClosureInput } from "@/lib/process/engine/closure";
import type { StepState } from "@/lib/process/engine/types";
import { isDone } from "@/lib/process/engine/types";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export type ClosureFacts = ClosureInput & {
  invoiceNumber: string | null;
  clientId: string | null;
};

export async function loadClosureInput(
  tenantId: string,
  fileId: string,
  permissions: string[],
): Promise<ClosureFacts | null> {
  const admin = getAdminSupabaseClient();

  const access = {
    finance: hasPermission(permissions, "finance:read"),
    documents: hasPermission(permissions, "document:read"),
    transport: hasPermission(permissions, "transport:read"),
  };

  const { data: instRows } = await scopedFrom(admin, "process_instance", tenantId)
    .select("id")
    .eq("file_id", fileId)
    .neq("status", "CANCELLED")
    .limit(1);
  const instance = ((instRows ?? []) as Row[])[0];
  if (!instance) return null;

  const [{ data: execs }, { data: docs }, { data: transports }, { data: invoices }, { data: files }] =
    await Promise.all([
      scopedFrom(admin, "process_step_execution", tenantId)
        .select("step_key, state, correction_of_id")
        .eq("process_instance_id", instance.id as string),
      access.documents
        ? scopedFrom(admin, "document", tenantId)
            .select("id, type_code, status")
            .eq("file_id", fileId)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Row[] }),
      access.transport
        ? scopedFrom(admin, "transport_record", tenantId).select("status").eq("file_id", fileId).limit(1)
        : Promise.resolve({ data: [] as Row[] }),
      access.finance
        ? scopedFrom(admin, "invoice", tenantId)
            .select("id, invoice_number, client_id, status, validated_at, disputed_at, dispute_resolved_at, collections_completed_at")
            .eq("file_id", fileId)
        : Promise.resolve({ data: [] as Row[] }),
      scopedFrom(admin, "operational_file", tenantId).select("client_id").eq("id", fileId).limit(1),
    ]);

  const stepStates = ((execs ?? []) as Row[]).map((e) => ({
    stepKey: e.step_key as string,
    state: e.state as StepState,
  }));
  const unresolvedCorrections = ((execs ?? []) as Row[]).filter(
    (e) => e.correction_of_id !== null && !isDone(e.state as StepState),
  ).length;

  const docRows = (docs ?? []) as Row[];
  const pod = docRows.find((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");

  const transport = ((transports ?? []) as Row[])[0];
  const transportDelivered =
    transport?.status === "DELIVERED" || transport?.status === "POD_RECEIVED";

  const invoiceRows = (invoices ?? []) as Row[];
  // The dossier's live invoice: the one that is not VOID.
  const invoice = invoiceRows.find((i) => i.status !== "VOID") ?? null;

  let outstandingBalance = 0;
  let invoiceValidated = false;
  let invoiceEmailed = false;
  let disputeOpen = false;
  let collectionsCompleted = false;

  if (invoice && access.finance) {
    const invoiceId = invoice.id as string;

    const [{ data: lines }, { data: payments }, { data: sent }] = await Promise.all([
      scopedFrom(admin, "invoice_line", tenantId)
        .select("quantity, unit_amount, tax_rate")
        .eq("invoice_id", invoiceId),
      scopedFrom(admin, "payment", tenantId).select("amount, reversed_at").eq("invoice_id", invoiceId),
      scopedFrom(admin, "communication_message", tenantId)
        .select("id")
        .eq("related_entity", "invoice")
        .eq("related_entity_id", invoiceId)
        .eq("status", "SENT")
        .limit(1),
    ]);

    // The SAME derivation finance uses. Not a second ledger.
    const totals = invoiceTotals(
      ((lines ?? []) as Row[]).map((l) => ({
        quantity: Number(l.quantity ?? 0),
        unitAmount: Number(l.unit_amount ?? 0),
        taxRate: Number(l.tax_rate ?? 0),
      })),
    );
    const paid = paidAmount(
      ((payments ?? []) as Row[]).map((p) => ({ amount: Number(p.amount ?? 0), reversed: !!p.reversed_at })),
    );
    outstandingBalance = Math.max(0, balanceDue(totals.total, paid));

    invoiceValidated = !!invoice.validated_at;
    // ISSUED means the validated invoice was actually EMAILED (Phase 5.0D-2). The
    // communication_message SENT row is the corroborating evidence.
    invoiceEmailed =
      ((sent ?? []) as Row[]).length > 0 ||
      invoice.status === "ISSUED" ||
      invoice.status === "PARTIALLY_PAID" ||
      invoice.status === "PAID";
    disputeOpen = !!invoice.disputed_at && !invoice.dispute_resolved_at;
    collectionsCompleted = !!invoice.collections_completed_at;
  }

  // Physical deposit — EXPLICIT client configuration, never implicit.
  const clientId = str(((files ?? []) as Row[])[0]?.client_id) ?? str(invoice?.client_id);
  const { data: clientRows } = clientId
    ? await scopedFrom(admin, "client", tenantId)
        .select("requires_physical_invoice_deposit")
        .eq("id", clientId)
        .limit(1)
    : { data: [] as Row[] };
  const depositRequired = Boolean(((clientRows ?? []) as Row[])[0]?.requires_physical_invoice_deposit);

  let depositProofAccepted = false;
  let depositProofDocumentId: string | null = null;
  let handedToCollections = false;
  if (depositRequired && invoice) {
    const { data: deps } = await scopedFrom(admin, "invoice_deposit", tenantId)
      .select("status, proof_document_id")
      .eq("invoice_id", invoice.id as string)
      .neq("status", "CANCELLED")
      .limit(1);
    const dep = ((deps ?? []) as Row[])[0];
    if (dep) {
      depositProofAccepted = dep.status === "PROOF_ACCEPTED" || dep.status === "HANDED_TO_COLLECTIONS";
      handedToCollections = dep.status === "HANDED_TO_COLLECTIONS";
      depositProofDocumentId = str(dep.proof_document_id);
    }
  }

  const live = new Map<string, StepState>();
  for (const s of stepStates) {
    if (s.state === "REJECTED" || s.state === "CANCELLED") continue;
    live.set(s.stepKey, s.state);
  }
  const done = (k: string) => {
    const st = live.get(k);
    return !!st && isDone(st);
  };

  return {
    evaluatedAt: new Date().toISOString(),
    access,
    transportDelivered,
    podApproved: !!pod,
    podDocumentId: pod ? (pod.id as string) : null,
    coordinatorCompletenessDone: done("coordinator_completeness"),
    amCompletenessDone: done("am_completeness"),
    invoiceId: invoice ? (invoice.id as string) : null,
    invoiceValidated,
    invoiceEmailed,
    depositRequired,
    depositProofAccepted,
    depositProofDocumentId,
    handedToCollections,
    outstandingBalance,
    disputeOpen,
    collectionsCompleted,
    stepStates,
    unresolvedCorrections,
    invoiceNumber: str(invoice?.invoice_number),
    clientId,
  };
}
