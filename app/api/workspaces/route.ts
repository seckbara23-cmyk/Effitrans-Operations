/**
 * Workspace menu route (Phase 6.0H) — /api/workspaces. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Returns the current session's switcher menu (own memberships + platform entry). The
 * client switcher fetches this on mount (the NotificationBell pattern) so no layout has to
 * read a session — keeping /login statically prerendered. Resolution is entirely
 * server-side (getWorkspaceMenu reads own rows via RLS + getPlatformUser); the client
 * cannot add or alter workspaces. 401 when signed out.
 */
import { NextResponse } from "next/server";
import { getWorkspaceMenu } from "@/lib/workspace/switcher";

export const dynamic = "force-dynamic";

export async function GET() {
  const menu = await getWorkspaceMenu();
  if (!menu) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(menu);
}
