import { redirect } from "next/navigation";
import { requirePortalUser } from "@/lib/portal/auth";
import { PortalShell } from "@/components/portal/portal-shell";

// Portal reads per-request identity (auth) — never prerender.
export const dynamic = "force-dynamic";

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePortalUser(); // active client_user or redirect to /portal/login
  // Phase 3.2B — a temp-password user is blocked from ALL portal content until
  // they set their own password. /portal/auth/* is outside this layout, so this
  // redirect never loops.
  if (user.mustChangePassword) redirect("/portal/auth/change-password");
  return <PortalShell clientName={user.clientName}>{children}</PortalShell>;
}
