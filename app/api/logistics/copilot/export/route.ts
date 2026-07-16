/**
 * Logistics Copilot export audit (Phase 7.6B, Part 13) — /api/logistics/copilot/export.
 * SERVER-ONLY. The export itself (copy / plain-text download) happens client-side over the
 * ALREADY-VISIBLE, authorized result. This endpoint records SAFE metadata only — the export TYPE
 * and the recommendation COUNT — never the exported contents, the prompt, or the answer.
 */
import { NextResponse } from "next/server";
import { assertPermission, PermissionError } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = ["copy", "text"];

export async function POST(req: Request) {
  let user;
  try {
    user = await assertPermission("logistics:copilot:read");
  } catch (e) {
    if (e instanceof PermissionError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
  const body = (await req.json().catch(() => null)) as { format?: unknown; count?: unknown } | null;
  const exportType = ALLOWED.includes(String(body?.format)) ? String(body?.format) : "text";
  const recommendationCount = Number.isFinite(Number(body?.count)) ? Math.max(0, Math.min(999, Math.floor(Number(body?.count)))) : 0;

  await writeAudit({
    action: AuditActions.LOGISTICS_COPILOT_QUERY, actorId: user.id, tenantId: user.tenantId, entity: "logistics",
    after: { outcome: "export", exportType, recommendationCount },
  });
  return NextResponse.json({ ok: true });
}
