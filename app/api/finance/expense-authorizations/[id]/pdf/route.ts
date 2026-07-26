/**
 * Autorisation de Dépenses — PDF (Phase 11.0C). Route Handler (GET).
 * ---------------------------------------------------------------------------
 * Streams the exact-template rendering of one authorization. Gated on
 * finance:expense:export (the 11.0B family — no new permission), on top of the
 * reader's own finance:expense:read + tenant scoping, so an id from another
 * tenant is a 404 and never a document.
 *
 * The bytes are produced by the pure, deterministic renderer over the hand-rolled
 * PDF engine (lib/finance/expense/pdf.ts) — no HTML-to-PDF converter, no
 * headless browser, no screenshot. Identical input yields identical bytes.
 *
 * The export is audited with SAFE metadata only (11.0A §23): document id,
 * version, template version and page geometry — never the amount, the
 * beneficiary, the account/registration values or the PDF content.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { resolveTenantBranding } from "@/lib/branding/service";
import { exportFilename } from "@/lib/reports/brand";
import { getExpenseAuthorizationDetail, listExpenseAttachments } from "@/lib/finance/expense/readers";
import { AUTHORIZATION_STATUS_LABELS_FR } from "@/lib/finance/expense/types";
import { activeAuthorizationTemplate, buildAuthorizationPdf } from "@/lib/finance/expense/pdf";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:expense:export")) return new NextResponse("Forbidden", { status: 403 });

  // Tenant-scoped + finance:expense:read-gated inside the reader.
  const doc = await getExpenseAuthorizationDetail(params.id);
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const [attachments, branding, org] = await Promise.all([
    listExpenseAttachments(doc.id),
    resolveTenantBranding(user.tenantId),
    getServerSupabaseClient().from("organization").select("slug").eq("id", user.tenantId).maybeSingle(),
  ]);

  const { bytes, overflowedFields, usedTemplateRaster } = buildAuthorizationPdf({
    companyName: branding.displayName,
    authorizationNumber: doc.authorizationNumber,
    statusLabel: AUTHORIZATION_STATUS_LABELS_FR[doc.status],
    documentDate: new Date(doc.createdAt).toLocaleDateString("fr-FR"),
    accountNumber: doc.accountNumber,
    fileNumber: doc.fileNumber,
    registrationNumber: doc.registrationNumber,
    expenseType: doc.expenseType,
    weightKg: doc.weightKg,
    beneficiary: doc.beneficiary,
    amount: doc.amount,
    currency: doc.currency,
    amountInWords: doc.amountInWords,
    agentName: doc.requesterName,
    reason: doc.reason,
    attachments: attachments.filter((a) => !a.retiredAt).map((a) => a.fileName),
    requestedBy: doc.requesterName,
  });

  const template = activeAuthorizationTemplate();
  try {
    await writeAudit({
      action: AuditActions.EXPENSE_AUTHORIZATION_PDF_GENERATED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "expense_authorization",
      entityId: doc.id,
      after: {
        template_code: template?.code ?? null,
        template_version: template?.version ?? null,
        used_template_raster: usedTemplateRaster,
        version_id: doc.currentVersionId,
        overflowed_fields: overflowedFields,
      },
    });
  } catch {
    /* best-effort — never fail a download because the log write failed */
  }

  const base = doc.authorizationNumber ?? `autorisation-${doc.id.slice(0, 8)}`;
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${exportFilename(org.data?.slug ?? null, base, "pdf")}"`,
      "Cache-Control": "no-store",
    },
  });
}
