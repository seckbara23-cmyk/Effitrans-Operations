/**
 * Operations & Support console (Phase 8.2) — SERVER-RENDERED, platform-admin only.
 * ---------------------------------------------------------------------------
 * One page where a platform administrator assesses overall system health. It owns NO data and
 * NO logic: everything comes from getOpsConsole(), which composes the EXISTING capabilities
 * (AI health snapshot, comms provider state, company stats, audit aggregates, storage counts,
 * Vercel build env). Cards degrade independently — a failing subsystem renders as
 * « Indisponible », never crashes the page, never fakes health.
 *
 * Actions are SAFE and read-only: « Actualiser » re-renders; « Vérifier le fournisseur IA »
 * re-renders with ?verify=ai, which runs the existing live health probe once. No destructive
 * action exists. Secrets never appear: the AI card shows host + booleans (getAIStatus
 * contract); email shows counts only (no recipient); backup state is honestly « indisponible ».
 */
import Link from "next/link";
import { PlatformAuthError } from "@/lib/platform/auth";
import { getOpsConsole, type CardState, type OpsConsole } from "@/lib/platform/ops/readers";

export const dynamic = "force-dynamic";

const STATE_BADGE: Record<CardState, { label: string; cls: string }> = {
  ok: { label: "Sain", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  warn: { label: "Attention", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  down: { label: "Hors service", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  unavailable: { label: "Indisponible", cls: "bg-white/10 text-slate-300 border-white/15" },
};

function Badge({ state }: { state: CardState }) {
  const b = STATE_BADGE[state];
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>{b.label}</span>;
}

function Card({ title, state, children }: { title: string; state?: CardState; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {state && <Badge state={state} />}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-medium text-white">{value}</span>
    </div>
  );
}

function Unavailable() {
  return <p className="text-sm text-slate-400">Indisponible pour ce rendu — le sous-système n'a pas répondu (indisponible ≠ sain).</p>;
}

const dt = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "—");
const CONF = (b: boolean) => (b ? "Configuré" : "Non configuré");

export default async function OperationsPage({ searchParams }: { searchParams?: { verify?: string } }) {
  let ops: OpsConsole;
  try {
    ops = await getOpsConsole({ verifyAi: searchParams?.verify === "ai" });
  } catch (e) {
    if (e instanceof PlatformAuthError) {
      return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">Accès réservé aux administrateurs plateforme.</div>;
    }
    throw e;
  }

  const d = ops.deployment;
  const h = ops.health;
  const ai = ops.ai;
  const em = ops.email;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Opérations & Support</h1>
          <p className="mt-1 text-sm text-slate-400">
            État consolidé de la plateforme — instantané du {dt(ops.generatedAt)}.
            {ops.unavailable.length > 0 && ` Sections indisponibles : ${ops.unavailable.join(", ")}.`}
          </p>
        </div>
        {/* Safe operational actions only — no destructive action exists on this page. */}
        <div className="flex gap-2">
          <Link href="/platform/operations" className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10">Actualiser</Link>
          <Link href="/platform/operations?verify=ai" className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10">Vérifier le fournisseur IA</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* 1. Deployment */}
        <Card title="Déploiement" state={d ? (d.probeApplied === false ? "warn" : "ok") : "unavailable"}>
          {d ? (
            <>
              <Row label="Commit" value={<code className="text-xs">{d.sha ? d.sha.slice(0, 12) : "local"}</code>} />
              <Row label="Branche" value={d.ref ?? "—"} />
              <Row label="Environnement" value={d.env ?? "—"} />
              <Row label="Région" value={d.region ?? "—"} />
              <Row label="Migrations livrées" value={`${d.migrationCount} · dernière : ${d.latestMigration}`} />
              <Row
                label="Base de données"
                value={
                  d.probeApplied === null
                    ? "marqueur non vérifiable"
                    : d.probeApplied
                      ? `à jour (marqueur ${d.probeMigration.slice(0, 14)} présent)`
                      : `EN RETARD — marqueur ${d.probeMigration.slice(0, 14)} ABSENT`
                }
              />
              <p className="mt-2 text-[11px] text-slate-500">Les migrations DDL postérieures au marqueur ne sont pas vérifiables via l'API — la vérification complète reste la CI + « supabase migration list ».</p>
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 2. Platform health */}
        <Card title="Santé plateforme" state={h?.state ?? "unavailable"}>
          {h ? (
            <>
              <Row label="Base de données" value={h.dbReachable ? `joignable · ${h.dbLatencyMs} ms` : "INJOIGNABLE"} />
              <Row label="Hébergement" value={h.hosted ? "Vercel (production)" : "local"} />
              <Row label="Point de version" value={<Link className="text-teal-300 hover:underline" href="/api/version">/api/version</Link>} />
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 3. AI services — provider comes from the neutral abstraction, NEVER hardcoded */}
        <Card title="Services IA" state={ai ? (ai.status?.configOk ? (ai.status.health ? (ai.status.health.healthy ? "ok" : "down") : "ok") : "warn") : "unavailable"}>
          {ai ? (
            <>
              <Row label="Fournisseur" value={ai.status?.provider ?? "non configuré"} />
              <Row label="Modèle" value={ai.status?.model ?? "—"} />
              <Row label="Hôte" value={ai.status?.baseUrlHost ?? "—"} />
              <Row label="Identifiants" value={ai.status?.credentialsPresent ? "présents" : "absents"} />
              {ai.status?.health && <Row label="Sonde en direct" value={ai.status.health.healthy ? "connecté" : `échec (${ai.status.health.errorCode ?? "—"})`} />}
              <Row label="Requêtes aujourd'hui" value={`${ai.todayRequests} · ${ai.todayAnswered} répondues · ${ai.todayFallback} replis · ${ai.todayFailed} échecs`} />
              <Row label="Latence moyenne" value={ai.avgLatencyMs != null ? `${ai.avgLatencyMs} ms` : "—"} />
              <Row label="Dernier succès" value={dt(ai.lastSuccessAt)} />
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 4. Email */}
        <Card title="E-mail" state={em?.state ?? "unavailable"}>
          {em ? (
            <>
              <Row label="Fournisseur" value={em.providerConfigured ? "configuré" : "non configuré (stub silencieux)"} />
              <Row label="En file" value={em.queuedNow} />
              <Row label="Envoyés aujourd'hui" value={em.sentToday} />
              <Row label="Échecs aujourd'hui" value={em.failedToday} />
              <Row label="Dernier envoi" value={dt(em.lastSentAt)} />
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 5. Background jobs — honest: the comms queue is the only queue */}
        <Card title="Tâches de fond" state={ops.jobs ? (ops.jobs.commsFailed > 0 ? "warn" : "ok") : "unavailable"}>
          {ops.jobs ? (
            <>
              <Row label="File communications" value={ops.jobs.commsQueued} />
              <Row label="Échecs (aujourd'hui)" value={ops.jobs.commsFailed} />
              <Row label="Dernier traitement" value={dt(ops.jobs.lastProcessedAt)} />
              <p className="mt-2 text-[11px] text-slate-500">Aucune tâche planifiée (cron) n'existe sur cette plateforme — la file de communications est l'unique file de fond.</p>
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 6. Storage */}
        <Card title="Stockage" state={ops.storage?.state ?? "unavailable"}>
          {ops.storage ? (
            <>
              {ops.storage.buckets.map((b) => (
                <Row key={b.bucket} label={b.bucket} value={b.objectCount == null ? "illisible" : `${b.objectCount} objet(s) · dernier : ${dt(b.latestUploadAt)}`} />
              ))}
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 7. Tenants */}
        <Card title="Entreprises" state={ops.tenants ? "ok" : "unavailable"}>
          {ops.tenants ? (
            <>
              <Row label="Total" value={ops.tenants.total} />
              <Row label="Actives" value={ops.tenants.active} />
              <Row label="En essai" value={ops.tenants.trial} />
              <Row label="Suspendues" value={ops.tenants.suspended} />
              <Row label="Archivées" value={ops.tenants.archived} />
              {ops.users && (
                <>
                  <Row label="Personnel actif / suspendu / archivé" value={`${ops.users.staffActive} / ${ops.users.staffInactive} / ${ops.users.staffArchived}`} />
                  <Row label="Utilisateurs portail" value={ops.users.portalUsers} />
                </>
              )}
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 8. Production activity (today) */}
        <Card title="Activité du jour" state={ops.activity ? "ok" : "unavailable"}>
          {ops.activity ? (
            <>
              <Row label="Connexions" value={ops.activity.logins} />
              <Row label="Connexions rejetées" value={ops.activity.rejectedLogins} />
              <Row label="Utilisateurs créés" value={ops.activity.usersCreated} />
              <Row label="Archivés / restaurés" value={`${ops.activity.usersArchived} / ${ops.activity.usersRestored}`} />
              <Row label="Requêtes IA" value={ops.activity.aiRequests} />
              <Row label="Documents téléversés" value={ops.activity.documentsUploaded} />
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 9. Critical events (audit-sourced) */}
        <Card title="Événements notables" state={ops.critical.length > 0 || ops.activity ? "ok" : "unavailable"}>
          {ops.critical.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun événement notable récent dans le journal d'audit.</p>
          ) : (
            <ul className="space-y-1">
              {ops.critical.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                  <code className="text-slate-300">{e.action}</code>
                  <span className="shrink-0 text-slate-500">{dt(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 10. Backup — NEVER fabricated */}
        <Card title="Sauvegardes" state="unavailable">
          <p className="text-sm text-slate-400">
            Statut de sauvegarde indisponible depuis l'application — la plateforme n'a pas d'accès API à l'état des sauvegardes Supabase.
            Référence : <span className="text-slate-300">docs/production/backup-and-recovery.md</span> (plan, exercice de restauration, RPO/RTO).
          </p>
        </Card>

        {/* 11. Environment */}
        <Card title="Environnement" state={ops.environment ? "ok" : "unavailable"}>
          {ops.environment ? (
            <>
              <Row label="Supabase" value={CONF(ops.environment.supabaseConfigured)} />
              <Row label="IA" value={CONF(ops.environment.aiConfigured)} />
              <Row label="E-mail" value={CONF(ops.environment.emailConfigured)} />
              <Row label="Stockage" value={CONF(ops.environment.storageConfigured)} />
              <Row label="URL du site" value={CONF(ops.environment.siteUrlConfigured)} />
            </>
          ) : (
            <Unavailable />
          )}
        </Card>

        {/* 12. Security — statements of record, not a live scan */}
        <Card title="Sécurité" state="ok">
          <Row label="HTTPS / HSTS" value="actifs (en-têtes sur chaque route)" />
          <Row label="CSP" value="différée (déploiement report-only planifié)" />
          <Row label="RLS" value="vérifiée en CI sur chaque commit" />
          <Row label="Scan de secrets" value="propre (bundles + historique, 8.0C)" />
          <Row label="Audit dépendances" value="1 avis élevé ouvert (Next.js — mise à niveau pré-GA planifiée)" />
          <p className="mt-2 text-[11px] text-slate-500">Résumés d'état documentés — détails : docs/production/security-review.md.</p>
        </Card>

        {/* 13. Performance — honest scope */}
        <Card title="Performance" state={ops.performance ? "ok" : "unavailable"}>
          {ops.performance ? (
            <>
              <Row label="Sonde base de données" value={ops.performance.dbProbeMs != null ? `${ops.performance.dbProbeMs} ms` : "—"} />
              <Row label="Latence IA moyenne (jour)" value={ops.performance.aiAvgLatencyMs != null ? `${ops.performance.aiAvgLatencyMs} ms` : "—"} />
              <p className="mt-2 text-[11px] text-slate-500">Les temps de réponse par route ne sont pas collectés dans l'application — voir Vercel Observability.</p>
            </>
          ) : (
            <Unavailable />
          )}
        </Card>
      </div>
    </div>
  );
}
