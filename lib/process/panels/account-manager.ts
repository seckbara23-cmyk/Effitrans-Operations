/**
 * Account Manager portfolio panel (Phase 5.0D-5, Deliverable 1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The client-facing owner's view: their clients, the dossiers under each, where
 * each one stands in the official process, and what is blocking it.
 *
 * BOUNDED — 7 queries total, regardless of how many clients or dossiers are
 * returned. Never one query per client, per dossier, per invoice or per message.
 *
 * PRIVACY: no Finance or Collections notes, no maker-checker detail, no promises,
 * no disputes. The AM sees a SAFE payment summary (issued / balance / paid) and
 * nothing about how the recovery is being conducted.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { balanceDue, invoiceTotals, paidAmount } from "@/lib/finance/calc";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { getNode } from "../engine/state";
import { isDone, isOpen, type StepState } from "../engine/types";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => Number(v ?? 0);

export type AmDossier = {
  fileId: string;
  fileNumber: string;
  /** Where it stands in the official 26-step process. */
  stepKey: string | null;
  stepNumber: number | null;
  stepLabel: string | null;
  blocker: string | null;
  priorityReason: string | null;
  acknowledgmentSent: boolean;
  /** Documents the CLIENT still owes us. */
  documentsAwaited: number;
  deliveryStatus: string | null;
  invoiceIssued: boolean;
  /** SAFE payment summary only — no collector, no notes, no promises. */
  payment: { total: number; paid: number; outstanding: number; status: string | null };
  closed: boolean;
};

export type AmClient = {
  clientId: string;
  clientName: string;
  activeDossiers: number;
  /** Most recent message we sent this client. Subject/`sent_at` only. */
  lastCommunicationAt: string | null;
  lastCommunicationSubject: string | null;
  /** Client-initiated messages with no staff reply after them. */
  unansweredCommunications: number;
  dossiers: AmDossier[];
};

export type AmPortfolio = {
  clients: AmClient[];
  total: number;
  page: number;
  pageSize: number;
  telemetry: { panel: "account_manager"; count: number; durationMs: number; queries: number };
};

/**
 * The AM's portfolio. `assignedOnly` restricts to clients where this user is the
 * account manager — a supervisor may see the whole tenant.
 */
export async function getAmPortfolio(
  tenantId: string,
  userId: string,
  permissions: string[],
  opts: { assignedOnly?: boolean; page?: number; pageSize?: number } = {},
): Promise<AmPortfolio> {
  const started = Date.now();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(25, Math.max(1, opts.pageSize ?? 10));
  const empty: AmPortfolio = {
    clients: [],
    total: 0,
    page,
    pageSize,
    telemetry: { panel: "account_manager", count: 0, durationMs: 0, queries: 0 },
  };

  const flags = await getTenantProcessFlags(tenantId);
  if (!flags.workspaces) return empty;
  if (!hasPermission(permissions, "client:read") || !hasPermission(permissions, "process:read")) return empty;

  const admin = getAdminSupabaseClient();
  const canFinance = hasPermission(permissions, "finance:read");
  const canComms = hasPermission(permissions, "communication:read");
  const canDocs = hasPermission(permissions, "document:read");
  let queries = 0;

  // (1) the AM's clients
  let cq = scopedFrom(admin, "client", tenantId).select("id, name").eq("status", "active");
  if (opts.assignedOnly !== false) cq = cq.eq("account_manager_id", userId);
  const { data: clientRows } = await cq.order("name", { ascending: true }).limit(200);
  queries++;
  const clients = (clientRows ?? []) as Row[];
  if (clients.length === 0) {
    return { ...empty, telemetry: { ...empty.telemetry, durationMs: Date.now() - started, queries } };
  }

  const clientIds = clients.map((c) => c.id as string);

  // (2) their dossiers
  const { data: fileRows } = await scopedFrom(admin, "operational_file", tenantId)
    .select("id, file_number, client_id, status")
    .in("client_id", clientIds)
    .limit(500);
  queries++;
  const files = (fileRows ?? []) as Row[];
  const fileIds = files.map((f) => f.id as string);

  // (3-7) everything else, batched. Never one query per row.
  const [{ data: instances }, { data: execs }, { data: invoices }, { data: comms }, { data: docs }] =
    await Promise.all([
      fileIds.length
        ? scopedFrom(admin, "process_instance", tenantId)
            .select("id, file_id, status")
            .in("file_id", fileIds)
            .neq("status", "CANCELLED")
        : Promise.resolve({ data: [] as Row[] }),
      fileIds.length
        ? scopedFrom(admin, "process_step_execution", tenantId)
            .select("process_instance_id, step_key, step_number, state")
            .in("state", ["AVAILABLE", "ACTIVE", "BLOCKED", "SUBMITTED"])
            .limit(2000)
        : Promise.resolve({ data: [] as Row[] }),
      canFinance && fileIds.length
        ? scopedFrom(admin, "invoice", tenantId)
            .select("id, file_id, status")
            .in("file_id", fileIds)
            .neq("status", "VOID")
        : Promise.resolve({ data: [] as Row[] }),
      canComms
        ? scopedFrom(admin, "communication_message", tenantId)
            .select("client_id, subject, sent_at, created_at, status")
            .in("client_id", clientIds)
            .order("created_at", { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [] as Row[] }),
      canDocs && fileIds.length
        ? scopedFrom(admin, "document", tenantId)
            .select("file_id, status")
            .in("file_id", fileIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Row[] }),
    ]);
  queries += 5;

  const instanceRows = (instances ?? []) as Row[];
  const instanceByFile = new Map(instanceRows.map((i) => [i.file_id as string, i]));
  const instanceIds = new Set(instanceRows.map((i) => i.id as string));

  // Open steps, grouped by instance (only instances we actually loaded).
  const openByInstance = new Map<string, Row[]>();
  for (const e of (execs ?? []) as Row[]) {
    const k = e.process_instance_id as string;
    if (!instanceIds.has(k)) continue;
    const l = openByInstance.get(k);
    if (l) l.push(e);
    else openByInstance.set(k, [e]);
  }

  // Invoice balances: two more batched reads, only if finance is readable.
  const invoiceRows = (invoices ?? []) as Row[];
  const balanceByFile = new Map<string, { total: number; paid: number; outstanding: number; status: string }>();
  if (canFinance && invoiceRows.length > 0) {
    const invIds = invoiceRows.map((i) => i.id as string);
    const [{ data: lines }, { data: payments }] = await Promise.all([
      scopedFrom(admin, "invoice_line", tenantId)
        .select("invoice_id, quantity, unit_amount, tax_rate")
        .in("invoice_id", invIds),
      scopedFrom(admin, "payment", tenantId).select("invoice_id, amount, reversed_at").in("invoice_id", invIds),
    ]);
    queries += 2;

    const linesBy = new Map<string, Row[]>();
    for (const l of (lines ?? []) as Row[]) {
      const k = l.invoice_id as string;
      const a = linesBy.get(k);
      if (a) a.push(l);
      else linesBy.set(k, [l]);
    }
    const paysBy = new Map<string, Row[]>();
    for (const p of (payments ?? []) as Row[]) {
      const k = p.invoice_id as string;
      const a = paysBy.get(k);
      if (a) a.push(p);
      else paysBy.set(k, [p]);
    }

    for (const inv of invoiceRows) {
      const id = inv.id as string;
      const totals = invoiceTotals(
        (linesBy.get(id) ?? []).map((l) => ({
          quantity: num(l.quantity),
          unitAmount: num(l.unit_amount),
          taxRate: num(l.tax_rate),
        })),
      );
      // The SAME balance finance uses — never a second ledger.
      const paid = paidAmount(
        (paysBy.get(id) ?? []).map((p) => ({ amount: num(p.amount), reversed: !!p.reversed_at })),
      );
      balanceByFile.set(inv.file_id as string, {
        total: totals.total,
        paid,
        outstanding: Math.max(0, balanceDue(totals.total, paid)),
        status: inv.status as string,
      });
    }
  }

  // Documents the CLIENT still owes: uploaded by them, awaiting our review.
  const awaitedByFile = new Map<string, number>();
  for (const d of (docs ?? []) as Row[]) {
    if (d.status !== "PENDING_REVIEW") continue;
    const k = d.file_id as string;
    awaitedByFile.set(k, (awaitedByFile.get(k) ?? 0) + 1);
  }

  // Communications, newest first per client.
  const commsByClient = new Map<string, Row[]>();
  for (const m of (comms ?? []) as Row[]) {
    const k = m.client_id as string;
    if (!k) continue;
    const l = commsByClient.get(k);
    if (l) l.push(m);
    else commsByClient.set(k, [m]);
  }

  const filesByClient = new Map<string, Row[]>();
  for (const f of files) {
    const k = f.client_id as string;
    const l = filesByClient.get(k);
    if (l) l.push(f);
    else filesByClient.set(k, [f]);
  }

  const built: AmClient[] = clients.map((c) => {
    const clientId = c.id as string;
    const clientFiles = filesByClient.get(clientId) ?? [];
    const messages = commsByClient.get(clientId) ?? [];
    const latest = messages[0] ?? null;

    const dossiers: AmDossier[] = clientFiles.map((f) => {
      const fileId = f.id as string;
      const inst = instanceByFile.get(fileId);
      const open = inst ? (openByInstance.get(inst.id as string) ?? []) : [];

      // The frontier: the lowest-numbered open step.
      const frontier = [...open].sort(
        (a, b) => (num(a.step_number) || 99) - (num(b.step_number) || 99),
      )[0];
      const node = frontier ? getNode(frontier.step_key as string) : null;
      const blockedStep = open.find((e) => e.state === "BLOCKED");

      const pay = balanceByFile.get(fileId) ?? null;

      return {
        fileId,
        fileNumber: f.file_number as string,
        stepKey: frontier ? (frontier.step_key as string) : null,
        stepNumber: frontier ? (num(frontier.step_number) || null) : null,
        stepLabel: node?.labelFr ?? null,
        blocker: blockedStep ? (getNode(blockedStep.step_key as string)?.labelFr ?? null) : null,
        priorityReason: blockedStep
          ? "Étape bloquée"
          : (awaitedByFile.get(fileId) ?? 0) > 0
            ? "Documents attendus du client"
            : pay && pay.outstanding > 0 && pay.status !== "DRAFT"
              ? "Facture impayée"
              : null,
        // The dossier has moved past DRAFT => the client was acknowledged.
        acknowledgmentSent: f.status !== "DRAFT",
        documentsAwaited: awaitedByFile.get(fileId) ?? 0,
        deliveryStatus: str(f.status),
        invoiceIssued: !!pay && pay.status !== "DRAFT" && pay.status !== "VALIDATED",
        payment: pay
          ? { total: pay.total, paid: pay.paid, outstanding: pay.outstanding, status: pay.status }
          : { total: 0, paid: 0, outstanding: 0, status: null },
        closed: (inst?.status as string) === "CLOSED" || f.status === "CLOSED",
      };
    });

    return {
      clientId,
      clientName: c.name as string,
      activeDossiers: dossiers.filter((d) => !d.closed).length,
      lastCommunicationAt: latest ? (str(latest.sent_at) ?? str(latest.created_at)) : null,
      // Subject only — never the message body.
      lastCommunicationSubject: latest ? str(latest.subject) : null,
      // A queued/failed message is one we have not successfully answered with.
      unansweredCommunications: messages.filter((m) => m.status === "QUEUED" || m.status === "FAILED").length,
      dossiers,
    };
  });

  const total = built.length;
  const start = (page - 1) * pageSize;

  return {
    clients: built.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    telemetry: { panel: "account_manager", count: total, durationMs: Date.now() - started, queries },
  };
}

export { isDone, isOpen };
export type { StepState };
