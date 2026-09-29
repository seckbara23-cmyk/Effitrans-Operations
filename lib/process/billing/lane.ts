import "server-only";
/**
 * The governed billing lane, as ONE server-resolved read model (STEP20-BILLING-UI-01).
 * SERVER-ONLY, READ-ONLY. Writes nothing and decides no authority.
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG. Steps 20 -> 21 -> 22 had a complete governed lane —
 * `prepareInvoiceDraft`, `submitInvoiceToFinance`, `approveInvoice`,
 * `rejectInvoice`, `emailValidatedInvoice` — and NOT ONE CONTROL that called any
 * of them. The only invoice control on the dossier was the legacy « Émettre »,
 * which allocates an official number with no Finance validation and is refused
 * by the step-22 control gate on any dossier the engine governs. So the
 * operator's single visible door was the one that cannot open, and the five
 * doors that work were unreachable from the product.
 *
 * BILLING-BYPASS-01 then withdrew the generic « Terminer » / « Valider » from
 * steps 20 and 21 — correctly, because those controls closed the steps with no
 * invoice in existence. That deliberately left the dossier with NO path through
 * the billing lane until this read model and its panel existed.
 *
 * WHY A SERVER READ MODEL RATHER THAN PROPS. The panel must know three things no
 * client can be trusted to derive: the invoice's maker-checker columns
 * (`submitted_by`, `validated_at`, `rejection_reason`, `revision`), the
 * authoritative billing-ready verdict, and the official state of steps 20/21/22.
 * `InvoiceDetail` — what `getFinanceForFile` returns — carries none of them: it
 * stops at `status`, so a client could not tell a fresh draft from one awaiting
 * a checker, nor the checker from the maker. Deriving any of it in React would
 * be a second billing state machine, which is exactly what is forbidden.
 *
 * THIS FILE DECIDES NOTHING. It loads rows and asks `billingLaneCapabilities`,
 * the PURE rule in `lib/process/billing/state.ts` — built from the very
 * predicates the server actions re-run. That split is not stylistic: a decision
 * living inside a server-only module cannot be executed by a unit test, so a
 * mutation to it passes the whole suite. BILLING-BYPASS-01's ninth probe
 * survived exactly that way, and this is the shape ratified in its place.
 *
 * THE UI IS NEVER A BOUNDARY, AND THIS IS NOT ONE. Every flag answers "would the
 * action accept this today?", and is used to decide what to RENDER. The action
 * re-reads the same row and re-runs the same predicate under its own `guard()`;
 * hiding a control removes a door from the screen and nothing from the server.
 * Fails closed at every unknown: no instance, no visibility, engine dark, or a
 * read that did not answer all return `null`, and the panel does not render.
 *
 * NARROWER THAN THE ACTION, NEVER WIDER. Where the lane needs a step to be in a
 * particular state for the act to land — step 20 must be able to reach
 * SUBMITTED, step 22 must be claimable — that reachability is folded into the
 * flag, so the panel never offers an act that would half-commit. Offering less
 * than the server allows is safe; offering more is the defect this avoids.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFileVisible } from "@/lib/authz/visibility";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { loadProcessSnapshot } from "../engine/snapshot";
import { authoritativeBillingReady } from "../engine/gate-authority";
import type { StepState } from "../engine/types";
import {
  billingLaneCapabilities,
  billingQueueState,
  isAwaitingValidation,
  isEditableDraft,
  type BillingError,
  type BillingQueueState,
  type EmailState,
  type InvoiceView,
} from "./state";

/** The three official steps this lane drives. */
export const LANE_DRAFT_STEP = "billing_draft";
export const LANE_VALIDATION_STEP = "finance_invoice_validation";
export const LANE_DISPATCH_STEP = "billing_dispatch";

/**
 * What the panel renders. Serialisable, and deliberately free of anything the
 * screen does not need — no client id, no amount, and no actor identity beyond
 * the one boolean that says whether the reader is the maker.
 */
export type BillingLaneView = {
  fileId: string;
  /** Null when the dossier has no invoice yet. */
  invoice: {
    id: string;
    status: InvoiceView["status"];
    revision: number;
    /** The reader IS the person who submitted it — so they may not validate it. */
    viewerIsMaker: boolean;
    lineCount: number;
    awaitingValidation: boolean;
    editableDraft: boolean;
    /** Finance's motif on a returned draft, shown verbatim to the maker. */
    rejectionReason: string | null;
  } | null;
  /** Steps 18 + 19 both passed — the authoritative verdict, not the reader's. */
  billingReady: boolean;
  queueState: BillingQueueState;
  steps: {
    draft: StepState | null;
    validation: StepState | null;
    dispatch: StepState | null;
  };
  /**
   * What this reader may do RIGHT NOW. Each is the action's own precondition; a
   * false means the action would refuse, never that it is unprotected.
   */
  can: {
    prepare: boolean;
    submit: boolean;
    approve: boolean;
    reject: boolean;
    issue: boolean;
  };
  /**
   * Why the act this reader is closest to is unavailable — always a
   * `BillingError`, so the panel resolves it through the SHARED vocabulary and
   * invents no sentence of its own. Null when something is offered.
   */
  blockedReason: BillingError | null;
};

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * The dossier's one governed invoice.
 *
 * A dossier may carry historical invoices; the lane concerns the one still
 * moving through it. The preference order matches what each action finds: the
 * open DRAFT/VALIDATED first — `prepareInvoiceDraft` returns exactly that row —
 * then the most recent, so a finished lane still reports « facture envoyée »
 * rather than an empty panel.
 */
async function loadLaneInvoice(tenantId: string, fileId: string): Promise<InvoiceView | null> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("invoice")
    .select(
      "id, status, submitted_by, submitted_at, validated_by, validated_at, rejection_reason, revision, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .order("created_at", { ascending: false });
  // FAIL CLOSED: a read that did not answer is not "this dossier has no invoice".
  if (error) return null;

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;
  const open = rows.find((r) => r.status === "DRAFT" || r.status === "VALIDATED");
  const r = open ?? rows[0];

  const { count } = await admin
    .from("invoice_line")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", r.id as string)
    .eq("tenant_id", tenantId);

  return {
    id: r.id as string,
    status: r.status as InvoiceView["status"],
    submittedBy: str(r.submitted_by),
    submittedAt: str(r.submitted_at),
    validatedBy: str(r.validated_by),
    validatedAt: str(r.validated_at),
    rejectionReason: str(r.rejection_reason),
    revision: Number(r.revision ?? 1),
    lineCount: count ?? 0,
  };
}

/** How this invoice's own dispatch went, for the queue state. */
async function loadEmailState(tenantId: string, invoiceId: string): Promise<EmailState> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("communication")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("related_entity", "invoice")
    .eq("related_entity_id", invoiceId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return "none";
  const s = str(((data ?? []) as Row[])[0]?.status);
  if (s === "SENT" || s === "DELIVERED") return "sent";
  if (s === "FAILED") return "failed";
  if (s === "QUEUED" || s === "SENDING") return "queued";
  return "none";
}

/**
 * Resolve the whole lane for one dossier and one reader.
 *
 * Returns null — and the panel does not render — whenever the lane does not
 * apply: the kill switch is off, the tenant is not enabled, the dossier is not
 * visible to this reader, or the engine does not govern it. That last case is
 * what keeps the legacy issuance path intact for dossiers with no process
 * instance, which `evaluateControlGate` deliberately lets through.
 */
export async function getBillingLane(fileId: string): Promise<BillingLaneView | null> {
  if (!globalKillSwitch().enabled) return null;

  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await getTenantProcessFlags(user.tenantId)).enabled) return null;
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return null;

  const permissions = await getEffectivePermissions(user.id);
  const snap = await loadProcessSnapshot(user.tenantId, fileId, permissions);
  // NO INSTANCE = NOT THIS LANE. The governed panel speaks for the official
  // process; on a dossier the process does not govern it has nothing to say,
  // and the legacy finance controls remain the only — and correct — path.
  if (!snap?.instance) return null;

  const stateOf = (key: string): StepState | null =>
    snap.executions.find((e) => e.stepKey === key && e.state !== "CANCELLED")?.state ?? null;

  const draft = stateOf(LANE_DRAFT_STEP);
  const validation = stateOf(LANE_VALIDATION_STEP);
  const dispatch = stateOf(LANE_DISPATCH_STEP);

  const [invoice, billingReady] = await Promise.all([
    loadLaneInvoice(user.tenantId, fileId),
    authoritativeBillingReady(user.tenantId, fileId),
  ]);

  const email: EmailState = invoice ? await loadEmailState(user.tenantId, invoice.id) : "none";

  const mayCreate = hasPermission(permissions, "finance:create");
  const mayValidate = hasPermission(permissions, "finance:validate");
  const mayIssue = hasPermission(permissions, "finance:issue");

  // Step 20 has to be able to REACH SUBMITTED for a submission to land:
  // AVAILABLE -> SUBMITTED is not a legal transition, and the lane claims an
  // AVAILABLE step itself (the same act as « Démarrer », under the same
  // permission it already required). So both open states count — and a step
  // that is PENDING, closed, or claimed by somebody else does not.
  const draftOpen = draft === "AVAILABLE" || draft === "ACTIVE";
  // Step 22 likewise: `prepareDispatchStep` claims AVAILABLE and accepts ACTIVE.
  const dispatchOpen = dispatch === "AVAILABLE" || dispatch === "ACTIVE";

  // THE WHOLE VERDICT, from the pure rule. Nothing about who may do what is
  // decided in this file.
  const { can, blockedReason } = billingLaneCapabilities({
    invoice,
    viewerId: user.id,
    billingReady,
    perms: { mayCreate, mayValidate, mayIssue },
    steps: { draftOpen, dispatchOpen },
  });

  return {
    fileId,
    invoice: invoice
      ? {
          id: invoice.id,
          status: invoice.status,
          revision: invoice.revision,
          viewerIsMaker: invoice.submittedBy !== null && invoice.submittedBy === user.id,
          lineCount: invoice.lineCount,
          awaitingValidation: isAwaitingValidation(invoice),
          editableDraft: isEditableDraft(invoice),
          rejectionReason: invoice.rejectionReason,
        }
      : null,
    billingReady,
    queueState: billingQueueState(invoice, billingReady, email),
    steps: { draft, validation, dispatch },
    can,
    blockedReason,
  };
}
