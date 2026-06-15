import { requirePortalUser } from "@/lib/portal/auth";
import { PortalShell } from "@/components/portal/portal-shell";

// Portal reads per-request identity (auth) — never prerender.
export const dynamic = "force-dynamic";

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePortalUser(); // active client_user or redirect to /portal/login
  return <PortalShell clientName={user.clientName}>{children}</PortalShell>;
}
