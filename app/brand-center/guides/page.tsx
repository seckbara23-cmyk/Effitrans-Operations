import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const metadata: Metadata = { title: "Guides d'installation" };
export const dynamic = "force-dynamic";

const GUIDES: { client: string; steps: string[] }[] = [
  { client: "Outlook (Bureau, Windows)", steps: ["Fichier → Options → Courrier → Signatures.", "Créez une signature, puis collez le HTML (Coller en conservant la mise en forme).", "Astuce : ouvrez le fichier .html dans un navigateur, sélectionnez tout, copiez, puis collez dans l'éditeur de signature."] },
  { client: "Nouveau Outlook / Outlook Web / Microsoft 365", steps: ["Paramètres → Courrier → Composer et répondre → Signature.", "Collez la signature copiée (Copier HTML).", "Les signatures itinérantes se synchronisent entre appareils."] },
  { client: "Gmail (Web)", steps: ["Paramètres (roue dentée) → Voir tous les paramètres → Général → Signature.", "Collez la signature copiée. Gmail conserve le style en ligne.", "Enregistrez les modifications en bas de la page."] },
  { client: "Apple Mail (macOS)", steps: ["Mail → Réglages → Signatures.", "Décochez « Toujours utiliser la police par défaut », puis collez la signature.", "Glissez la signature sur le compte souhaité."] },
  { client: "iPhone / iPad (Mail iOS)", steps: ["Réglages → Mail → Signature.", "Collez le texte ou la signature copiée ; le HTML riche est limité sur iOS.", "Pour un rendu riche, envoyez-vous la signature et copiez-la depuis Mail."] },
  { client: "Android (Gmail)", steps: ["Application Gmail → Menu → Paramètres → votre compte → Signature mobile.", "Le HTML riche est limité : utilisez la version texte pour un rendu fiable sur mobile."] },
];

export default async function GuidesPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:users:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Guides d'installation des signatures" subtitle="Instructions par client de messagerie. Le rendu final peut varier ; aucune compatibilité pixel-perfect n'est garantie." />
      <p className="text-sm"><Link href="/brand-center/people" className="text-teal-700 hover:underline">← Identité collaborateurs</Link></p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <section key={g.client} className="surface p-5">
            <h2 className="text-sm font-semibold text-navy-900">{g.client}</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
              {g.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </section>
        ))}
      </div>
      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Compatibilité (validation manuelle P0)</h2>
        <p className="mt-1 text-xs text-slate-500">La compatibilité est vérifiée manuellement sur : Outlook Bureau, Outlook Web, Microsoft 365, Gmail Web, Apple Mail, iPhone Mail, Android Mail. Aucun service de test automatisé (Litmus / Email on Acid) n'est actuellement configuré — la compatibilité est donc rapportée honnêtement, sans certification.</p>
      </section>
    </div>
  );
}
