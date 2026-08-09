"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  provisionMailbox, recordSetupOutcome, retryProvisioning,
  setMailboxEnabled, revokeMembership,
} from "@/lib/ec/mailboxes/admin-actions";
import type { MailboxSummary, MailboxMember } from "@/lib/ec/mailboxes/membership";
import { cn } from "@/lib/cn";

/**
 * EMP-4A — the mailbox administration panel.
 *
 * Two things it deliberately does NOT show:
 *   * any "Send As" / "Envoyer en tant que" control. The provider envelope
 *     always uses the central configured sender, so a control by that name
 *     would claim an identity the recipient never sees. It arrives in EMP-4B,
 *     when the provider honours it.
 *   * any suggestion that provisioning contacts a provider. Every state here
 *     records what a person did or reported.
 *
 * Revoked memberships are shown, struck through, with their reason. "Who had
 * access in March" is a question this surface exists to answer.
 */
const STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon",
  PENDING_EXTERNAL_SETUP: "En attente de configuration externe",
  ACTIVE: "Active",
  DISABLED: "Désactivée",
  SETUP_FAILED: "Échec de configuration",
};

const ERRORS_FR: Record<string, string> = {
  forbidden: "Autorisation insuffisante.",
  address_taken: "Cette adresse est déjà utilisée par une boîte ou un alias.",
  invalid_address: "Adresse invalide.",
  owner_required: "Une boîte personnelle doit désigner son titulaire.",
  owner_not_allowed: "Une boîte partagée n'a pas de titulaire.",
  not_pending: "Cette boîte n'attend pas de configuration.",
  not_failed: "Cette boîte n'est pas en échec.",
  invalid_state: "Changement d'état impossible depuis l'état actuel.",
  not_revocable: "Cette appartenance est déjà révoquée.",
  provision_failed: "La réservation a échoué.",
};

export function MailboxAdminPanel({
  mailboxes,
  selectedId,
  members,
  canProvision,
  canManageMembers,
}: {
  mailboxes: MailboxSummary[];
  selectedId: string | null;
  members: MailboxMember[];
  canProvision: boolean;
  canManageMembers: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPurpose, setNewPurpose] = useState("OPERATIONS");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERRORS_FR[res.error ?? ""] ?? `Échec : ${res.error}`);
    });
  };

  const selected = mailboxes.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* ---- mailbox list ---- */}
      <section className="surface overflow-hidden" aria-labelledby="mbx-list">
        <h2 id="mbx-list" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
          Boîtes
        </h2>
        {mailboxes.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Aucune boîte réservée.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mailboxes.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/admin/enterprise-mail/mailboxes?mailbox=${m.id}`}
                  className={cn(
                    "block px-4 py-3 hover:bg-slate-50",
                    m.id === selectedId && "bg-slate-50",
                  )}
                >
                  <p className="truncate text-sm font-medium text-navy-900">{m.address}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {m.mailboxType === "PERSONAL" ? "Personnelle" : "Partagée"} ·{" "}
                    {STATUS_FR[m.provisioningStatus] ?? m.provisioningStatus} ·{" "}
                    {m.activeMembers} membre{m.activeMembers > 1 ? "s" : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {canProvision ? (
          <div className="space-y-2 border-t border-slate-100 p-4">
            <h3 className="text-xs font-semibold text-navy-900">Réserver une boîte</h3>
            <input
              value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
              placeholder="operations@exemple.sn"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
            <input
              value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Libellé"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
            <select
              value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            >
              {["OPERATIONS", "TRANSIT", "CUSTOMS", "FINANCE", "COMMERCIAL", "SUPPORT", "GENERAL"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !newAddress.trim()}
              onClick={() => run(() => provisionMailbox({
                address: newAddress, labelFr: newLabel, purpose: newPurpose, mailboxType: "SHARED",
              }))}
              className="w-full rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {pending ? "…" : "Réserver (configuration externe à suivre)"}
            </button>
          </div>
        ) : null}
      </section>

      {/* ---- selected mailbox ---- */}
      <section className="surface p-4" aria-labelledby="mbx-detail">
        <h2 id="mbx-detail" className="mb-3 text-sm font-semibold text-navy-900">
          {selected ? selected.address : "Aucune boîte sélectionnée"}
        </h2>

        {selected ? (
          <>
            <dl className="grid gap-2 text-xs sm:grid-cols-3">
              <Fact label="État" value={STATUS_FR[selected.provisioningStatus] ?? selected.provisioningStatus} />
              <Fact label="Type" value={selected.mailboxType === "PERSONAL" ? "Personnelle" : "Partagée"} />
              <Fact label="Tentatives" value={String(selected.provisioningAttempts)} />
            </dl>
            {selected.provisioningNote ? (
              <p className="mt-2 text-[11px] text-amber-800">{selected.provisioningNote}</p>
            ) : null}

            {canProvision ? (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {selected.provisioningStatus === "PENDING_EXTERNAL_SETUP" ? (
                  <>
                    <input
                      value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="Note (obligatoire en cas d'échec)"
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={pending}
                        onClick={() => run(() => recordSetupOutcome(selected.id, "ACTIVE", note))}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                        Configuration externe confirmée
                      </button>
                      <button type="button" disabled={pending || !note.trim()}
                        onClick={() => run(() => recordSetupOutcome(selected.id, "SETUP_FAILED", note))}
                        className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                        Signaler un échec
                      </button>
                    </div>
                  </>
                ) : null}

                {selected.provisioningStatus === "SETUP_FAILED" ? (
                  <button type="button" disabled={pending}
                    onClick={() => run(() => retryProvisioning(selected.id))}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50">
                    Relancer la demande à l&apos;opérateur
                  </button>
                ) : null}

                {selected.provisioningStatus === "ACTIVE" || selected.provisioningStatus === "DISABLED" ? (
                  <button type="button" disabled={pending}
                    onClick={() => run(() => setMailboxEnabled(selected.id, selected.provisioningStatus !== "ACTIVE"))}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 disabled:opacity-50">
                    {selected.provisioningStatus === "ACTIVE" ? "Désactiver" : "Activer"}
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* ---- members ---- */}
            <h3 className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold text-navy-900">
              Appartenances
            </h3>
            {!canManageMembers ? (
              <p className="mt-1 text-[11px] text-slate-500">
                La gestion des appartenances requiert une autorisation distincte.
              </p>
            ) : members.length === 0 ? (
              <p className="mt-1 text-[11px] text-slate-500">Aucun membre.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className={cn("text-sm text-navy-900", m.revokedAt && "text-slate-400 line-through")}>
                        {m.userName ?? m.userEmail}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {[m.canRead && "lecture", m.canSend && "envoi",
                          m.canManageMembers && "gestion", m.isDefaultSender && "expéditeur par défaut"]
                          .filter(Boolean).join(" · ") || "aucune capacité"}
                        {m.revokedAt ? ` · révoquée${m.revokeReason ? ` : ${m.revokeReason}` : ""}` : ""}
                      </p>
                    </div>
                    {!m.revokedAt ? (
                      <button type="button" disabled={pending}
                        onClick={() => run(() => revokeMembership(m.id, note || "révocation administrative"))}
                        className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 disabled:opacity-50">
                        Révoquer
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">Sélectionnez une boîte à gauche.</p>
        )}

        {error ? <p className="mt-3 text-xs text-red-700" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
