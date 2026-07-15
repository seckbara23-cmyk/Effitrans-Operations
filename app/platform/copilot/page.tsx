/**
 * Platform Copilot page (Phase 6.0F). SERVER — platform only.
 * ---------------------------------------------------------------------------
 * Read-only, aggregate-first tenant awareness. Gated by platform:copilot:read (the route
 * re-checks). The panel POSTs to /api/platform/copilot; nothing here calls a provider.
 */
import type { Metadata } from "next";
import { assertPlatformPermission } from "@/lib/platform/auth";
import { getCopilotConfig } from "@/lib/copilot/engine";
import { PlatformCopilotPanel } from "@/components/platform/copilot-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Copilote plateforme" };

export default async function PlatformCopilotPage() {
  await assertPlatformPermission("platform:copilot:read");
  const config = getCopilotConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Copilote plateforme</h1>
        <p className="mt-1 text-sm text-slate-400">
          Assistant en <strong>lecture seule</strong> pour les opérateurs. Il répond à partir d'agrégats sûrs
          (cycle de vie, essais, onboarding, déploiement, marque, activité, invitations, santé) — jamais à partir
          des données métier d'un tenant. Il n'exécute aucune action.
        </p>
      </div>

      {!config.configured && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          Le fournisseur IA n'est pas configuré sur cet environnement ({config.provider || "aucun"}). Le copilote
          renverra un diagnostic tant que la configuration n'est pas complète.
        </div>
      )}

      <PlatformCopilotPanel />
    </div>
  );
}
