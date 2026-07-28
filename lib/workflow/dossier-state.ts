/**
 * THE canonical dossier state (production blocker fix). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * A dossier has exactly ONE operational truth. This resolver produces it.
 *
 * ===========================================================================
 * THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE
 * ===========================================================================
 * The dossier page used to assemble the workflow input from PERMISSION-GATED
 * reads:
 *
 *     const customsRecord = canReadCustoms ? await getCustomsRecord(id) : null;
 *     buildCanonicalProjection({ customs: customsRecord, ... });
 *
 * With `customs: null` the projection computes `customsApplicable = true` and
 * `rank = 0` — customs is applicable but unstarted — so the frontier lands on
 * « Préparation douane ». A Finance user without `customs:read` was therefore
 * told to "prepare the customs declaration" on a dossier that was delivered,
 * invoiced and paid. **Absence of permission was read as absence of progress.**
 *
 * The data flow is now, without exception:
 *
 *     database → canonical resolver → canonical state → RBAC → UI
 *
 * and never permissions → partial reads → workflow calculation.
 *
 * ===========================================================================
 * THIS RESOLVER DOES NOT KNOW WHO IS ASKING
 * ===========================================================================
 * It takes a fileId and a tenantId. It has no user parameter, reads no session
 * and calls no permission helper — deliberately, so it CANNOT become
 * viewer-dependent later. It uses the admin client because the answer must be
 * complete; callers remain responsible for deciding whether this viewer may
 * see a given FIELD, and for gating actions.
 *
 * Request-memoized: a dossier page asks for it several times per render (page,
 * access resolver, panels) and the answer cannot change mid-request.
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getDossierLifecycle, type DossierLifecycle, type Department } from "@/lib/files/lifecycle";
import { buildCanonicalProjection, type CanonicalProjection } from "@/lib/workflow/projection";
import { canonicalWorkflowInput, type CanonicalWorkflowInput } from "@/lib/workflow/canonical-input";
import { missingDocumentationEvidence } from "@/lib/documents/requirements";
import { isVerified } from "@/lib/documents/doctrine";

/** The complete, ungated facts the workflow is computed from. */
export type CanonicalDossierFacts = {
  fileId: string;
  fileNumber: string | null;
  fileStatus: string;
  fileType: string;
  clientId: string | null;
  documents: { typeCode: string; status: string }[];
  missingRequired: { label: string }[];
  customs: { status: string; required: boolean; declarationNumber: string | null; baeReference: string | null } | null;
  transport: { status: string } | null;
  invoices: { id: string; status: string; total: number; paid: number; balance: number }[];
  paymentsVerified: boolean;
  podVerified: boolean;
};

export type CanonicalDossierState = {
  facts: CanonicalDossierFacts;
  lifecycle: DossierLifecycle;
  projection: CanonicalProjection;
  /** Convenience accessors — all derived, never separately computed. */
  currentStage: string | null;
  nextAction: string | null;
  responsibleDepartment: Department | null;
  /** Every invoice settled and every payment verified. */
  closureReady: boolean;
  /** Closure reached — the dossier may be archived. */
  archivalReady: boolean;
};

/**
 * THE canonical state of one dossier. Returns null when the dossier does not
 * exist in this tenant.
 *
 * No `userId` parameter, by design.
 */
export const getCanonicalDossierState = cache(
  async (fileId: string, tenantId: string): Promise<CanonicalDossierState | null> => {
    const supabase = getAdminSupabaseClient();

    const { data: file } = await supabase
      .from("operational_file")
      .select("id, file_number, status, type, client_id")
      .eq("id", fileId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string; file_number: string | null; status: string; type: string; client_id: string | null;
      }>();
    if (!file) return null;

    // EVERY read is complete and ungated. There is no `canRead*` in this file.
    const [docs, docTypes, customs, transport, invoices] = await Promise.all([
      supabase.from("document").select("type_code, status")
        .eq("tenant_id", tenantId).eq("file_id", fileId).is("deleted_at", null),
      supabase.from("document_type").select("code, label_fr")
        .eq("active", true).contains("required_for", [file.type]),
      supabase.from("customs_record")
        .select("status, required, declaration_number, bae_reference")
        .eq("tenant_id", tenantId).eq("file_id", fileId)
        .maybeSingle<{ status: string; required: boolean; declaration_number: string | null; bae_reference: string | null }>(),
      supabase.from("transport_record").select("status")
        .eq("tenant_id", tenantId).eq("file_id", fileId)
        .maybeSingle<{ status: string }>(),
      supabase.from("invoice").select("id, status")
        .eq("tenant_id", tenantId).eq("file_id", fileId),
    ]);

    const documentRows = (docs.data ?? []).map((d) => ({
      typeCode: d.type_code as string,
      status: d.status as string,
    }));

    const missingRequired = missingDocumentationEvidence({
      fileType: file.type,
      requiredCodes: (docTypes.data ?? []).map((t) => t.code as string),
      facts: documentRows,
    }).map((m) => ({ label: m.label }));

    // Money, from the finance calculator — never recomputed here.
    const invoiceIds = (invoices.data ?? []).map((i) => i.id as string);
    const [lineRows, paymentRows] = invoiceIds.length
      ? await Promise.all([
          supabase.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate")
            .eq("tenant_id", tenantId).in("invoice_id", invoiceIds),
          supabase.from("payment").select("invoice_id, amount, reversed_at, verification_status")
            .eq("tenant_id", tenantId).in("invoice_id", invoiceIds),
        ])
      : [{ data: [] }, { data: [] }];

    const { invoiceTotals, paidAmount, balanceDue } = await import("@/lib/finance/calc");
    const invoiceFacts = (invoices.data ?? []).map((inv) => {
      const id = inv.id as string;
      const lines = (lineRows.data ?? [])
        .filter((l) => l.invoice_id === id)
        .map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) }));
      const pays = (paymentRows.data ?? []).filter((p) => p.invoice_id === id);
      const { total } = invoiceTotals(lines);
      const paid = paidAmount(pays.map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null })));
      return { id, status: inv.status as string, total, paid, balance: balanceDue(total, paid) };
    });

    const livePayments = (paymentRows.data ?? []).filter((p) => p.reversed_at == null);
    const paymentsVerified =
      livePayments.length > 0 && livePayments.every((p) => p.verification_status === "VERIFIED");

    const podVerified = documentRows.some((d) => d.typeCode === "DELIVERY_NOTE" && isVerified(d.status));

    const facts: CanonicalDossierFacts = {
      fileId,
      fileNumber: file.file_number,
      fileStatus: file.status,
      fileType: file.type,
      clientId: file.client_id,
      documents: documentRows,
      missingRequired,
      customs: customs.data
        ? {
            status: customs.data.status,
            required: customs.data.required,
            declarationNumber: customs.data.declaration_number,
            baeReference: customs.data.bae_reference,
          }
        : null,
      transport: transport.data ? { status: transport.data.status } : null,
      invoices: invoiceFacts,
      paymentsVerified,
      podVerified,
    };

    // ONE construction of the workflow input, from complete facts.
    const input: CanonicalWorkflowInput = canonicalWorkflowInput({
      fileId,
      file: { status: file.status, type: file.type },
      documents: documentRows.map((d) => ({ status: d.status })),
      missingRequired,
      customs: facts.customs ? { status: facts.customs.status, required: facts.customs.required } : null,
      transport: facts.transport,
      invoices: invoiceFacts.map((i) => ({ status: i.status, balance: i.balance })),
      podApproved: podVerified,
    });

    const lifecycle = getDossierLifecycle(input);
    const projection = buildCanonicalProjection(input);

    // Closure readiness: every non-void invoice settled AND its payments
    // verified. Payment ENTRY is not settlement — verification is (maker-checker).
    const billable = invoiceFacts.filter((i) => i.status !== "VOID");
    const closureReady =
      billable.length > 0 && billable.every((i) => i.balance <= 0) && paymentsVerified;

    return {
      facts,
      lifecycle,
      projection,
      currentStage: lifecycle.currentStep,
      nextAction: lifecycle.nextAction?.reasonCode ?? null,
      responsibleDepartment: projection.responsibleDepartment ?? lifecycle.currentDepartment,
      closureReady,
      archivalReady: file.status === "CLOSED",
    };
  },
);
