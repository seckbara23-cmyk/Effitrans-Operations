/**
 * Physical deposit — read model (Phase 5.0D-3, Deliverable 14). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE bounded read model. NO N+1: a fixed number of batch queries regardless of
 * how many deposits are returned. No duplicate truth — the deposit row is the
 * current state, the custody chain is the history, and both come from their own
 * tables rather than being recomputed.
 *
 * Never returns a document body. Proof documents are referenced by id only.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { CUSTODY_LABEL_FR, currentCustodian, type CustodyEntry, type CustodyEvent } from "./custody";
import { courierSection, DEPOSIT_LABEL_FR, type CourierSection, type DepositStatus } from "./status";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export type DepositView = {
  id: string;
  fileId: string;
  fileNumber: string;
  invoiceId: string;
  invoiceNumber: string | null;
  clientName: string;
  status: DepositStatus;
  statusLabel: string;
  /** Who holds the package RIGHT NOW — read from the last custody event. */
  currentCustodian: string | null;
  courierUserId: string | null;
  courierName: string | null;
  acceptedAt: string | null;
  /** Destination summary. Safe: name + location, no unrelated client data. */
  clientLocation: string | null;
  deliveryInstructions: string | null;
  packageReference: string | null;
  recipientName: string | null;
  recipientRole: string | null;
  depositedAt: string | null;
  proofDocumentId: string | null;
  proofStatus: string | null;
  rejectionReason: string | null;
  ageHours: number;
  /** What must happen next, and who must do it. */
  pendingAction: string;
  blocker: string | null;
  courierSection: CourierSection;
  custody: CustodyEntry[];
};

const PENDING_ACTION: Record<DepositStatus, string> = {
  PREPARATION_PENDING: "Administration : préparer le pli",
  READY_FOR_COURIER: "Administration : affecter un coursier",
  ASSIGNED: "Coursier : accepter la mission",
  IN_TRANSIT: "Coursier : déposer et saisir le destinataire",
  DEPOSITED: "Coursier : téléverser la preuve de dépôt",
  PROOF_SUBMITTED: "Administration : contrôler la preuve",
  PROOF_ACCEPTED: "Administration : remettre au recouvrement",
  PROOF_REJECTED: "Coursier : corriger la preuve",
  HANDED_TO_COLLECTIONS: "Recouvrement : suivi de l'échéance",
  CANCELLED: "—",
};

const hoursSince = (iso: string | null, now: number) =>
  iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 3_600_000)) : 0;

export type DepositScope =
  /** Administration / Collections — the tenant's whole chain. */
  | { kind: "tenant" }
  /** A courier — ONLY their own assignments. */
  | { kind: "courier"; userId: string };

/**
 * Load deposits for a scope. Fixed query count (6), whatever the row count.
 */
export async function listDeposits(
  tenantId: string,
  permissions: string[],
  scope: DepositScope,
  limit = 50,
): Promise<DepositView[]> {
  const flags = await getTenantProcessFlags(tenantId);
  if (!flags.physicalDeposit) return [];

  const canAdmin = hasPermission(permissions, "admin_service:manage");
  const canCollect = hasPermission(permissions, "collections:manage");
  const canCourier = hasPermission(permissions, "courier:deposit");
  if (scope.kind === "tenant" && !canAdmin && !canCollect) return [];
  if (scope.kind === "courier" && !canCourier) return [];

  const admin = getAdminSupabaseClient();

  // (1) the deposits
  let q = scopedFrom(admin, "invoice_deposit", tenantId).select("*").neq("status", "CANCELLED");
  if (scope.kind === "courier") q = q.eq("courier_user_id", scope.userId);
  const { data: depRows } = await q.limit(limit);
  const deposits = (depRows ?? []) as Row[];
  if (deposits.length === 0) return [];

  const ids = deposits.map((d) => d.id as string);
  const fileIds = [...new Set(deposits.map((d) => d.file_id as string))];
  const invoiceIds = [...new Set(deposits.map((d) => d.invoice_id as string))];
  const courierIds = [...new Set(deposits.map((d) => d.courier_user_id).filter(Boolean))] as string[];
  const proofIds = [...new Set(deposits.map((d) => d.proof_document_id).filter(Boolean))] as string[];

  // (2-6) everything else, batched. Never one query per deposit.
  const [{ data: events }, { data: files }, { data: invoices }, { data: couriers }, { data: proofs }] =
    await Promise.all([
      scopedFrom(admin, "invoice_deposit_event", tenantId)
        .select("*")
        .in("deposit_id", ids)
        .order("occurred_at", { ascending: true }),
      scopedFrom(admin, "operational_file", tenantId).select("id, file_number, client_id").in("id", fileIds),
      scopedFrom(admin, "invoice", tenantId).select("id, invoice_number").in("id", invoiceIds),
      courierIds.length
        ? scopedFrom(admin, "app_user", tenantId).select("id, name, email").in("id", courierIds)
        : Promise.resolve({ data: [] as Row[] }),
      proofIds.length
        ? scopedFrom(admin, "document", tenantId).select("id, status").in("id", proofIds)
        : Promise.resolve({ data: [] as Row[] }),
    ]);

  const fileRows = (files ?? []) as Row[];
  const clientIds = [...new Set(fileRows.map((f) => f.client_id as string).filter(Boolean))];
  const { data: clients } = clientIds.length
    ? await scopedFrom(admin, "client", tenantId).select("id, name").in("id", clientIds)
    : { data: [] as Row[] };

  const fileById = new Map(fileRows.map((f) => [f.id as string, f]));
  const clientById = new Map(((clients ?? []) as Row[]).map((c) => [c.id as string, c.name as string]));
  const invoiceById = new Map(((invoices ?? []) as Row[]).map((i) => [i.id as string, i]));
  const courierById = new Map(((couriers ?? []) as Row[]).map((u) => [u.id as string, u]));
  const proofById = new Map(((proofs ?? []) as Row[]).map((d) => [d.id as string, d]));

  const chainByDeposit = new Map<string, CustodyEntry[]>();
  for (const e of (events ?? []) as Row[]) {
    const k = e.deposit_id as string;
    const entry: CustodyEntry = {
      id: e.id as string,
      event: e.event as CustodyEvent,
      labelFr: CUSTODY_LABEL_FR[e.event as CustodyEvent] ?? (e.event as string),
      fromStatus: str(e.from_status),
      toStatus: e.to_status as string,
      actorId: str(e.actor_id),
      actorRoleCode: str(e.actor_role_code),
      fromDepartment: str(e.from_department),
      toDepartment: str(e.to_department),
      reason: str(e.reason),
      evidenceDocumentId: str(e.evidence_document_id),
      occurredAt: e.occurred_at as string,
    };
    const list = chainByDeposit.get(k);
    if (list) list.push(entry);
    else chainByDeposit.set(k, [entry]);
  }

  const now = Date.now();

  return deposits.map((d) => {
    const id = d.id as string;
    const status = d.status as DepositStatus;
    const chain = chainByDeposit.get(id) ?? [];
    const file = fileById.get(d.file_id as string);
    const courier = d.courier_user_id ? courierById.get(d.courier_user_id as string) : null;
    const proof = d.proof_document_id ? proofById.get(d.proof_document_id as string) : null;
    const proofStatus = str(proof?.status);

    const blocker =
      status === "PROOF_REJECTED"
        ? (str(d.rejection_reason) ?? "Preuve rejetée")
        : status === "READY_FOR_COURIER" && str(d.failure_reason)
          ? `Échec précédent : ${str(d.failure_reason)}`
          : null;

    return {
      id,
      fileId: d.file_id as string,
      fileNumber: (file?.file_number as string) ?? "—",
      invoiceId: d.invoice_id as string,
      invoiceNumber: str(invoiceById.get(d.invoice_id as string)?.invoice_number),
      clientName: clientById.get((file?.client_id as string) ?? "") ?? "—",
      status,
      statusLabel: DEPOSIT_LABEL_FR[status],
      // Read from the last custody EVENT, never inferred from the status.
      currentCustodian: currentCustodian(chain),
      courierUserId: str(d.courier_user_id),
      courierName: str(courier?.name) ?? str(courier?.email),
      acceptedAt: str(d.accepted_at),
      clientLocation: str(d.client_location),
      deliveryInstructions: str(d.delivery_instructions),
      packageReference: str(d.package_reference),
      recipientName: str(d.recipient_name),
      recipientRole: str(d.recipient_role),
      depositedAt: str(d.deposited_at),
      proofDocumentId: str(d.proof_document_id),
      proofStatus,
      rejectionReason: str(d.rejection_reason),
      ageHours: hoursSince(str(d.created_at), now),
      pendingAction: PENDING_ACTION[status],
      blocker,
      courierSection: courierSection(
        { status, courierUserId: str(d.courier_user_id), acceptedAt: str(d.accepted_at) },
        !!d.recipient_name && !!d.deposited_at,
        !!d.proof_document_id,
      ),
      custody: chain,
    };
  });
}

/** Administration + Collections view. */
export function listTenantDeposits(tenantId: string, permissions: string[], limit = 50) {
  return listDeposits(tenantId, permissions, { kind: "tenant" }, limit);
}

/** A courier's OWN missions. Never another courier's. */
export function listCourierDeposits(tenantId: string, permissions: string[], userId: string, limit = 50) {
  return listDeposits(tenantId, permissions, { kind: "courier", userId }, limit);
}
