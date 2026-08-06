import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  listMailboxHealth, getWebhookHealth, getMailVolume, getProviderPosture,
  isTenantInboundEnabled, QUARANTINE_VISIBILITY_NOTICE,
} from "@/lib/ec/mailboxes/service";
import { MailboxToggle } from "@/components/ec/mailbox-toggle";

export const metadata: Metadata = { title: "Boîtes aux lettres" };
export const dynamic = "force-dynamic";

/**
 * EMP-1 — mailbox administration and the mail operations dashboard.
 *
 * Gate: `communication:manage`. That is stricter than the RLS policy on these
 * tables (`communication:inbound:read`), which is the right direction: reading
 * the queue and administering the addresses it depends on are different jobs.
 *
 * The dashboard is operational visibility only — volume, queue, webhook
 * posture, mailbox state. No analytics, no trends, no reporting.
 */
export default async function MailboxesPage() {
  const header = (
    <PageHeader
      meta="Communications"
      title="Boîtes aux lettres"
      subtitle="Adresses de réception, état opérationnel et santé de la capture."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="space-y-6">
        {header}
        <div className="surface p-6 text-sm text-slate-600">Configuration requise.</div>
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:manage")) notFound();

  const [boxes, webhook, volume, rolloutEnabled] = await Promise.all([
    listMailboxHealth(user.tenantId),
    getWebhookHealth(user.tenantId),
    getMailVolume(user.tenantId),
    isTenantInboundEnabled(user.tenantId),
  ]);
  const posture = getProviderPosture(rolloutEnabled);

  const totalVolume = volume.reduce((n, d) => n + d.count, 0);
  const openTotal = boxes.reduce((n, b) => n + b.openCount, 0);
  const inactive = boxes.filter((b) => !b.isActive).length;

  // The two-layer rollout rule: an unset ENV silently disables the module for
  // every tenant, so both halves are shown rather than one summary word.
  const captureLive = posture.inboundEnabled && posture.tenantRolloutEnabled;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Messages reçus (${webhook.windowDays} j)`} value={String(totalVolume)} />
        <StatCard label="En attente de tri" value={String(openTotal)} />
        <StatCard label="Boîtes configurées" value={String(boxes.length)} />
        <StatCard label="Boîtes inactives" value={String(inactive)} />
      </div>

      {/* Capture posture. Both flags, because either one alone stops mail. */}
      <section className="surface p-4" aria-labelledby="emp1-posture">
        <h2 id="emp1-posture" className="mb-3 text-sm font-semibold text-navy-900">
          État de la capture
        </h2>
        <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Capture entrante" value={captureLive ? "Active" : "Inactive"} tone={captureLive ? "ok" : "warn"} />
          <Fact
            label="Indicateur plateforme"
            value={posture.inboundEnabled ? "Activé" : "Désactivé"}
            tone={posture.inboundEnabled ? "ok" : "warn"}
          />
          <Fact
            label="Déploiement du tenant"
            value={posture.tenantRolloutEnabled ? "Activé" : "Désactivé"}
            tone={posture.tenantRolloutEnabled ? "ok" : "warn"}
          />
          <Fact
            label="Secret webhook"
            value={posture.webhookSecretConfigured ? "Configuré" : "Absent"}
            tone={posture.webhookSecretConfigured ? "ok" : "warn"}
          />
          <Fact
            label="Dernier webhook reçu"
            value={webhook.lastReceivedAt ? new Date(webhook.lastReceivedAt).toLocaleString("fr-FR") : "Aucun"}
            tone={webhook.lastReceivedAt ? "ok" : "muted"}
          />
          <Fact
            label="Signatures invalides"
            value={String(webhook.invalidSignatures)}
            tone={webhook.invalidSignatures > 0 ? "warn" : "ok"}
          />
          <Fact label="Captures enregistrées" value={String(webhook.byOutcome.CAPTURED ?? 0)} tone="muted" />
          <Fact label="Doublons ignorés" value={String(webhook.byOutcome.DUPLICATE ?? 0)} tone="muted" />
        </dl>
        <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          {QUARANTINE_VISIBILITY_NOTICE}
        </p>
      </section>

      <section className="surface overflow-hidden" aria-labelledby="emp1-boxes">
        <h2 id="emp1-boxes" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
          Adresses de réception
        </h2>
        {boxes.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            Aucune boîte configurée pour ce tenant. La création d&apos;une adresse est une opération
            d&apos;exploitation : les adresses sont uniques sur toute la plateforme, et cet écran
            administre celles qui existent sans pouvoir en créer.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {boxes.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-navy-900">
                    <Link href={`/communications/mailboxes/${b.id}`} className="hover:underline">
                      {b.address}
                    </Link>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        b.isActive ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {b.isActive ? "Active" : "Inactive"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {b.labelFr} · {b.purpose} · {b.messageCount} message{b.messageCount > 1 ? "s" : ""}
                    {b.openCount > 0 ? ` · ${b.openCount} en attente` : ""}
                    {b.lastReceivedAt
                      ? ` · dernier le ${new Date(b.lastReceivedAt).toLocaleDateString("fr-FR")}`
                      : " · jamais utilisée"}
                  </p>
                </div>
                <MailboxToggle mailboxId={b.id} address={b.address} isActive={b.isActive} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "muted" }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      {/* The tone repeats in the words themselves, so nothing depends on colour. */}
      <dd
        className={
          tone === "warn" ? "font-medium text-amber-700" : tone === "ok" ? "font-medium text-teal-700" : "text-slate-700"
        }
      >
        {value}
      </dd>
    </div>
  );
}
