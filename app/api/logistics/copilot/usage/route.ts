/**
 * Logistics Copilot usage summary (Phase 7.6B, Part 15) — /api/logistics/copilot/usage.
 * SERVER-ONLY. Admin-gated (audit:read:all, inside getCopilotUsageSummary). Returns SAFE,
 * tenant-scoped aggregates over the copilot audit rows — counts, outcomes, average duration, and
 * token totals where present — never a prompt, an answer, or a secret. No fabricated cost.
 */
import { NextResponse } from "next/server";
import { PermissionError } from "@/lib/auth/require-permission";
import { getCopilotUsageSummary } from "@/lib/logistics/copilot/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const days = Math.max(1, Math.min(90, Number(new URL(req.url).searchParams.get("days")) || 7));
  try {
    const summary = await getCopilotUsageSummary(days);
    return NextResponse.json(summary);
  } catch (e) {
    if (e instanceof PermissionError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
}
