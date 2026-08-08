"use client";

import { useState, useTransition } from "react";
import {
  grantMembership, revokeMembership, setMembershipCapabilities,
  provisionMailbox, recordSetupOutcome, retryProvisioning,
} from "@/lib/ec/mailboxes/admin-actions";
import type { MailboxSummary } from "@/lib/ec/mailboxes/membership";
import { cn } from "@/lib/cn";

/**
 * EMP-4A — one user's Enterprise Mail access.
 *
 * Two rules this surface exists to hold:
 *   1. NOTHING is assigned without an explicit click. Suggestions are rendered
 *      as proposals with a visible reason, never pre-selected and never applied
 *      on load — every membership row must be able to name the person who
 *      decided, and that is only true if a person did.
 *   2. There is no "Send As". The provider envelope always uses the central
 *      configured sender, so a control by that name would claim an identity the
 *      recipient never sees. EMP-4B owns sender identity.
 *
 * Revoked memberships are shown with their reason rather than hidden — access
 * history is the point of keeping the row.
 */
export type UserMembership = {
  id: string; mailboxId: string; address: string; labelFr: string;
  canRead: boolean; canSend: boolean; canManageMembers: boolean; isDefaultSender: boolean;
  grantedAt: string; revokedAt: string | null; revokeReason: string | null;
};

export type Suggestion = {
  purpose: string; reason: string; mailboxId: string; address: string; status: string;
};

const STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon",
  PENDING_EXTERNAL_SETUP: "En attente de configuration externe",
  ACTIVE: "Active",
  DISABLED: "Désactivée",
  SETUP_FAILED: "Échec de configuration",
};

const ERRORS_FR: Record<string, string> = {
  forbidden: "Autorisation insuffisante.",
  default_sender_conflict: "Cet utilisateur a déjà un expéditeur par défaut sur une autre boîte.",
  not_active: "Cette appartenance n'est pas active.",
  not_revocable: "Cette appartenance est déjà révoquée.",
  address_taken: "Adresse déjà utilisée par une boîte ou un alias.",
  invalid_address: "Adresse invalide.",
  owner_required: "Une boîte personnelle doit désigner son titulaire.",
  not_pending: "Cette boîte n'attend pas de configuration.",
  not_failed: "Cette boîte n'est pas en échec.",
};

export function UserMailboxPanel({
  userId, userLabel, memberships, suggestions, personal, allMailboxes,
  canManageMembers, canProvision,
}: {
  userId: string;
  userLabel: string;
  memberships: UserMembership[];
  suggestions: Suggestion[];
  personal: MailboxSummary | null;
  allMailboxes: MailboxSummary[];
  canManageMembers: boolean;
  canProvision: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [personalAddress, setPersonalAddress] = useState("");
  const [addMailbox, setAddMailbox] = useState(allMailboxes[0]?.id ?? "");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERRORS_FR[res.error ?? ""] ?? `Échec : ${res.error}`);
    });
  };

  const active = memberships.filter((m) => !m.revokedAt);
  const revoked = memberships.filter((m) => m.revokedAt);

  return (
    <div className="space-y-4">
      {/* The standing honesty note — the same claim the composer makes. */}
      <p className="surface p-4 text-[11px] text-slate-600">
        Les messages sortants utilisent actuellement l&apos;expéditeur Effitrans configuré de
        façon centrale, quelle que soit la boîte sélectionnée. La capacité « envoi » autorise à
        initier une correspondance rattachée à une boîte dans Effitrans ; elle ne modifie pas
        l&apos;expéditeur vu par le destinataire.
      </p>

      {/* ---- active memberships ---- */}
      <section className="surface p-4" aria-labelledby="um-active">
        <h2 id="um-active" className="mb-3 text-sm font-semibold text-navy-900">
          Appartenances actives
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune appartenance active.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {active.map((m) => (
              <li key={m.id} className="py-3">
                <p className="text-sm font-medium text-navy-900">{m.address}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {m.labelFr} · accordée le {new Date(m.grantedAt).toLocaleDateString("fr-FR")}
                </p>
                {canManageMembers ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {([
                      ["canRead", "Lecture", m.canRead],
                      ["canSend", "Envoi", m.canSend],
                      ["canManageMembers", "Gestion des membres", m.canManageMembers],
                      ["isDefaultSender", "Expéditeur par défaut", m.isDefaultSender],
                    ] as const).map(([key, label, value]) => (
                      <label key={key} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={value}
                          disabled={pending}
                          onChange={(e) =>
                            run(() => setMembershipCapabilities(m.id, { [key]: e.target.checked }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <button
                      type="button" disabled={pending}
                      onClick={() => run(() => revokeMembership(m.id, note || "révocation administrative"))}
                      className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 disabled:opacity-50"
                    >
                      Révoquer
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManageMembers && allMailboxes.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <select
              value={addMailbox} onChange={(e) => setAddMailbox(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              {allMailboxes.map((m) => (
                <option key={m.id} value={m.id}>{m.address}</option>
              ))}
            </select>
            <button
              type="button" disabled={pending || !addMailbox}
              onClick={() => run(() => grantMembership({
                mailboxId: addMailbox, userId, capabilities: { canRead: true },
              }))}
              className="rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Accorder l&apos;accès
            </button>
          </div>
        ) : null}
      </section>

      {/* ---- suggestions ---- */}
      <section className="surface p-4" aria-labelledby="um-suggest">
        <h2 id="um-suggest" className="mb-1 text-sm font-semibold text-navy-900">
          Boîtes proposées
        </h2>
        <p className="mb-3 text-[11px] text-slate-500">
          Déduites du département dérivé de ses rôles. Ce sont des propositions : rien
          n&apos;est attribué sans une action explicite.
        </p>
        {suggestions.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune proposition — soit ses rôles ne sont rattachés à aucun département, soit il
            possède déjà les boîtes proposées.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {suggestions.map((s) => (
              <li key={s.mailboxId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-navy-900">{s.address}</p>
                  <p className="text-[11px] text-slate-500">
                    {s.reason} · {STATUS_FR[s.status] ?? s.status}
                  </p>
                </div>
                {canManageMembers ? (
                  <button
                    type="button" disabled={pending}
                    onClick={() => run(() => grantMembership({
                      mailboxId: s.mailboxId, userId, capabilities: { canRead: true },
                    }))}
                    className="rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Accorder
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- personal mailbox ---- */}
      <section className="surface p-4" aria-labelledby="um-personal">
        <h2 id="um-personal" className="mb-3 text-sm font-semibold text-navy-900">
          Boîte personnelle
        </h2>
        {personal ? (
          <>
            <p className="text-sm text-navy-900">{personal.address}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {STATUS_FR[personal.provisioningStatus] ?? personal.provisioningStatus}
              {personal.provisioningAttempts > 0 ? ` · ${personal.provisioningAttempts} tentative(s)` : ""}
            </p>
            {personal.provisioningNote ? (
              <p className="mt-1 text-[11px] text-amber-800">{personal.provisioningNote}</p>
            ) : null}

            {canProvision ? (
              <div className="mt-3 space-y-2">
                <input
                  value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (obligatoire en cas d'échec)"
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  {personal.provisioningStatus === "PENDING_EXTERNAL_SETUP" ? (
                    <>
                      <button type="button" disabled={pending}
                        onClick={() => run(() => recordSetupOutcome(personal.id, "ACTIVE", note))}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                        Configuration externe confirmée
                      </button>
                      <button type="button" disabled={pending || !note.trim()}
                        onClick={() => run(() => recordSetupOutcome(personal.id, "SETUP_FAILED", note))}
                        className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                        Signaler un échec
                      </button>
                    </>
                  ) : null}
                  {personal.provisioningStatus === "SETUP_FAILED" ? (
                    <button type="button" disabled={pending}
                      onClick={() => run(() => retryProvisioning(personal.id))}
                      className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50">
                      Relancer la demande à l&apos;opérateur
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : canProvision ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Réserve l&apos;identité interne uniquement. La boîte doit ensuite être créée chez le
              fournisseur par un opérateur ; aucune intégration n&apos;existe.
            </p>
            <input
              value={personalAddress} onChange={(e) => setPersonalAddress(e.target.value)}
              placeholder="prenom.nom@exemple.sn"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
            <button
              type="button" disabled={pending || !personalAddress.trim()}
              onClick={() => run(() => provisionMailbox({
                address: personalAddress, labelFr: userLabel, purpose: "GENERAL",
                mailboxType: "PERSONAL", ownerUserId: userId,
              }))}
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Réserver l&apos;identité interne
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Aucune boîte personnelle.</p>
        )}
      </section>

      {/* ---- revoked history ---- */}
      {revoked.length > 0 ? (
        <section className="surface p-4" aria-labelledby="um-revoked">
          <h2 id="um-revoked" className="mb-3 text-sm font-semibold text-navy-900">
            Appartenances révoquées
          </h2>
          <ul className="divide-y divide-slate-100">
            {revoked.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className={cn("text-sm text-slate-400 line-through")}>{m.address}</p>
                  <p className="text-[11px] text-slate-500">
                    Révoquée le {m.revokedAt ? new Date(m.revokedAt).toLocaleDateString("fr-FR") : "—"}
                    {m.revokeReason ? ` — ${m.revokeReason}` : ""}
                  </p>
                </div>
                {canManageMembers ? (
                  <button
                    type="button" disabled={pending}
                    onClick={() => run(() => grantMembership({
                      mailboxId: m.mailboxId, userId, capabilities: { canRead: true },
                    }))}
                    className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-navy-900 disabled:opacity-50"
                  >
                    Réactiver
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <p className="text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
