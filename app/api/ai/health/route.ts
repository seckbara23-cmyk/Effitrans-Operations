/**
 * Admin AI health endpoint (Phase 3.4F-1) — /api/ai/health. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Admin-only, SECRET-FREE view of the AI configuration + a live health probe run
 * in THIS request (nothing persisted). Returns the configured provider/model, the
 * base URL HOST only, whether a credential is present (bool), the flags, and the
 * health result. NEVER returns the API key/token, a prompt, or dossier content.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAIStatus } from "@/lib/ai/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const status = await getAIStatus(process.env);
  return NextResponse.json(status);
}
