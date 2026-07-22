import { redirect } from "next/navigation";
import { requirePortalUser } from "@/lib/portal/auth";
import { resolveTenantBranding } from "@/lib/branding/service";
import { getTenantMessagingEnabled, messagingGlobalKillSwitch } from "@/lib/messaging/rollout";
import { PortalShell } from "@/components/portal/portal-shell";

// Portal reads per-request identity (auth) — never prerender.
export const dynamic = "force-dynamic";

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePortalUser(); // active client_user or redirect to /portal/login
  // Phase 3.2B — a temp-password user is blocked from ALL portal content until
  // they set their own password. /portal/auth/* is outside this layout, so this
  // redirect never loops.
  if (user.mustChangePassword) redirect("/portal/auth/change-password");
  // Phase 4.0B-5 — the portal header uses the tenant's resolved brand (own tenant
  // only; safe fallback to the default label).
  const [branding, messagingEnabled] = await Promise.all([
    resolveTenantBranding(user.tenantId),
    messagingGlobalKillSwitch() ? getTenantMessagingEnabled(user.tenantId) : Promise.resolve(false),
  ]);
  return (
    <PortalShell clientName={user.clientName} brandName={branding.displayName} messagingEnabled={messagingEnabled}>
      {children}
    </PortalShell>
  );
}
