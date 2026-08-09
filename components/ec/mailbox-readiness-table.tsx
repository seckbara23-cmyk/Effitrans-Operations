import Link from "next/link";
import type { MailboxSummary } from "@/lib/ec/mailboxes/membership";
import type { MailboxLifecycleView } from "@/lib/ec/mailboxes/lifecycle";
import { eligibilityLabelFr, MAILBOX_TYPE_FR, OWNERSHIP_FR } from "@/lib/ec/mailboxes/vocabulary";
import { cn } from "@/lib/cn";

/**
 * EMP-5H — activation readiness, every mailbox at once.
 *
 * The EMP-5F panel answers "what is wrong with THIS mailbox" one click at a
 * time. Before a controlled pilot the question is the other one: which mailbox
 * is closest to being usable, and what is standing in the way of each. That
 * needs a table, not a detail pane.
 *
 * IT DECIDES NOTHING. Every cell reads a `MailboxLifecycleView` the server
 * already computed with the EMP-5F/5G predicates and one `now`. There is no
 * rule here to drift from the guard, and no clock to disagree with it — which
 * is why this is a server component with no state at all.
 *
 * IT NEVER IMPLIES MORE THAN THE EVIDENCE SAYS. « Active » is a lifecycle
 * state; it is NOT a claim that the provider, DNS, sending or receiving were
 * checked. Those are separate columns precisely so an ACTIVE mailbox with no
 * outbound proof reads as what it is.
 */
function Cell({
  ok, label, detail, tone = "auto",
}: {
  ok: boolean | null;
  label: string;
  detail?: string | null;
  tone?: "auto" | "muted";
}) {
  return (
    <td className="px-2 py-2 align-top">
      <span
        className={cn(
          "text-[11px] font-medium",
          tone === "muted" ? "text-slate-500"
            : ok === true ? "text-teal-700"
            : ok === false ? "text-amber-800"
            : "text-slate-500",
        )}
      >
        {ok === true ? "✓ " : ok === false ? "○ " : ""}{label}
      </span>
      {detail ? <span className="block text-[10px] text-slate-400">{detail}</span> : null}
    </td>
  );
}

/** Days-old, or an explicit absence. `0` would read as "checked today". */
function ageLabel(days: number | null, stale: boolean): { ok: boolean | null; label: string } {
  if (days === null) return { ok: false, label: "aucune preuve" };
  if (stale) return { ok: false, label: `${days} j — expirée` };
  return { ok: true, label: `${days} j` };
}

export function MailboxReadinessTable({
  mailboxes,
  views,
  eligibleAdministrators,
}: {
  mailboxes: MailboxSummary[];
  views: Record<string, MailboxLifecycleView>;
  eligibleAdministrators: number;
}) {
  if (mailboxes.length === 0) return null;

  const window = views[mailboxes[0].id]?.freshness.capabilityMaxAgeDays ?? null;

  return (
    <section className="surface overflow-hidden" aria-labelledby="mbx-readiness">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 id="mbx-readiness" className="text-sm font-semibold text-navy-900">
          Préparation à la mise en service
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          « Active » est un état du cycle de vie. Ce n&apos;est <strong>pas</strong> une
          attestation que le DNS, le fournisseur, l&apos;envoi ou la réception ont été
          vérifiés : chaque preuve a sa propre colonne, et une boîte peut être active
          sans qu&apos;aucune n&apos;existe.
          {window !== null
            ? ` Les preuves de fonctionnement expirent après ${window} jours ; l'identité d'entreprise n'expire pas.`
            : null}
        </p>
      </div>

      {/* Wide table, scrollable on its own rather than pushing the page sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-2 py-2 font-medium">Boîte</th>
              <th scope="col" className="px-2 py-2 font-medium">État</th>
              <th scope="col" className="px-2 py-2 font-medium">Provenance</th>
              <th scope="col" className="px-2 py-2 font-medium">Identité</th>
              <th scope="col" className="px-2 py-2 font-medium">Département</th>
              <th scope="col" className="px-2 py-2 font-medium">Envoi</th>
              <th scope="col" className="px-2 py-2 font-medium">Réception</th>
              <th scope="col" className="px-2 py-2 font-medium">Fraîcheur</th>
              <th scope="col" className="px-2 py-2 font-medium">Accès</th>
              <th scope="col" className="px-2 py-2 font-medium">Séparation des tâches</th>
              <th scope="col" className="px-2 py-2 font-medium">Blocages</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mailboxes.map((m) => {
              const v = views[m.id];
              if (!v) return null;
              const out = ageLabel(v.freshness.outboundDays, v.freshness.outboundStale);
              const inb = ageLabel(v.freshness.inboundDays, v.freshness.inboundStale);
              const identity = v.freshness.identityDays;

              return (
                <tr key={m.id} className="align-top">
                  <td className="px-2 py-2">
                    <Link
                      href={`/admin/enterprise-mail/mailboxes?mailbox=${m.id}`}
                      className="text-xs font-medium text-navy-900 hover:underline"
                    >
                      {m.address}
                    </Link>
                    <span className="block text-[10px] text-slate-400">
                      {MAILBOX_TYPE_FR[m.mailboxType] ?? m.mailboxType}
                    </span>
                  </td>

                  <Cell
                    ok={v.state === "ACTIVE" ? true : null}
                    label={v.stateFr}
                    detail={v.legacyActive ? "sans preuve de vérification" : null}
                  />
                  <Cell
                    ok={m.ownership !== "UNKNOWN"}
                    label={OWNERSHIP_FR[m.ownership] ?? m.ownership}
                  />
                  <Cell
                    ok={v.capability.identityConfirmed}
                    label={v.capability.identityConfirmed ? "confirmée" : "non confirmée"}
                    detail={identity !== null ? `il y a ${identity} j` : null}
                  />
                  <Cell
                    ok={m.departmentEligibility ? true : null}
                    tone={m.departmentEligibility ? "auto" : "muted"}
                    label={eligibilityLabelFr(m.departmentEligibility)}
                  />
                  <Cell
                    ok={v.capability.outboundReady}
                    label={v.capability.outboundReady ? "prêt" : "non vérifié"}
                    detail={m.outboundVerificationRef ? "preuve manuelle" : null}
                  />
                  <Cell
                    ok={v.capability.inboundReady}
                    label={v.capability.inboundReady ? "prêt" : "non vérifié"}
                    detail={m.inboundVerificationRef ? "preuve manuelle" : null}
                  />
                  <td className="px-2 py-2 align-top">
                    <span className={cn("block text-[11px]", out.ok ? "text-teal-700" : "text-amber-800")}>
                      envoi : {out.label}
                    </span>
                    <span className={cn("block text-[11px]", inb.ok ? "text-teal-700" : "text-amber-800")}>
                      réception : {inb.label}
                    </span>
                  </td>
                  <Cell
                    ok={m.activeMembers > 0}
                    label={`${m.activeMembers} membre${m.activeMembers > 1 ? "s" : ""}`}
                    detail={m.activeMembers === 0 ? "personne ne peut la consulter" : null}
                  />
                  <Cell
                    ok={v.makerChecker.satisfiable}
                    label={
                      !v.makerChecker.makerRecorded ? "aucun vérificateur"
                        : !v.makerChecker.checkerAvailable ? "second administrateur requis"
                        : v.makerChecker.actorIsMaker ? "un autre administrateur doit activer"
                        : "prête à être activée par vous"
                    }
                    detail={`${eligibleAdministrators} administrateur(s) habilité(s)`}
                  />
                  <td className="px-2 py-2 align-top">
                    {v.blockers.length === 0 ? (
                      <span className="text-[11px] text-teal-700">aucun</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {v.blockers.map((b) => (
                          <li key={b.code} className="text-[10px] text-amber-800">• {b.messageFr}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
        Cette vue est descriptive : elle n&apos;a rien activé, vérifié, reclassé ni modifié.
        Toutes les décisions proviennent du serveur ; aucune règle n&apos;est réévaluée ici.
      </p>
    </section>
  );
}
