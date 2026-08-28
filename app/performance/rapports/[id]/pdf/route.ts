/**
 * The published report's PDF.
 *
 * Serves the STORED artifact — the document that was rendered from the frozen
 * snapshot at publication. It never re-renders: re-rendering would recompute
 * from whatever the data says today, which is precisely the failure a frozen
 * report exists to prevent.
 *
 * Gate: `performance:read` plus the caller's own tenant. The storage path is
 * read from the row, never from the URL, so no path can be supplied by a
 * caller.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { downloadObject } from "@/lib/documents/storage";
import { getReport } from "@/lib/performance/report-read";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "performance:read")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const report = await getReport(user.tenantId, id);
  if (!report || report.status !== "PUBLIE" || !report.artifactStoragePath) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = await downloadObject(report.artifactStoragePath);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${report.periodLabel.replace(/[^\w-]+/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
