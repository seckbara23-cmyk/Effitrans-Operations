import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAIStatus } from "@/lib/ai/health";
import { AiHealthPanel, type AiHealthView } from "@/components/settings/ai-health-panel";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.aiSettings.title };

// Auth-dependent + runs a live health probe: never prerender at build.
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function AiSettingsPage() {
  const header = (
    <PageHeader meta="Administration" title={t.aiSettings.title} subtitle={t.aiSettings.subtitle} />
  );

  // Graceful in environments without Supabase configured (e.g. local Ollama-only).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.aiSettings.notConfigured}</Notice></div>;
  }

  const user = await requireUser(); // redirects to /login if unauthenticated
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.aiSettings.forbidden}</Notice></div>;
  }

  // Secret-free status + a live health probe in THIS request (nothing persisted).
  const status = await getAIStatus(process.env);
  const view: AiHealthView = {
    provider: status.provider,
    model: status.model,
    copilotEnabled: status.copilotEnabled,
    localProviderEnabled: status.localProviderEnabled,
    hosted: status.hosted,
    baseUrlHost: status.baseUrlHost,
    configOk: status.configOk,
    configError: status.configError ?? null,
    health: status.health ?? null,
  };

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <AiHealthPanel initial={view} />
    </div>
  );
}
