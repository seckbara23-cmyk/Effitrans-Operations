"use client";

import { useState, useTransition } from "react";
import { saveDraft, sendComposed, composeAndSend } from "@/lib/comms/outbound-actions";
import { cn } from "@/lib/cn";

/**
 * EMP-3 — the composer.
 *
 * Drafting and sending are two buttons because they are two authorities and two
 * acts. A user who may draft but not send sees only "Enregistrer le brouillon",
 * and the server enforces that independently — the button's absence is a
 * convenience, never the control.
 *
 * The From field is a SELECT over the tenant's active mailboxes and submits an
 * id, never an address: the server resolves the sender itself, so no arbitrary
 * From can be constructed here.
 */
export type MailboxOption = { id: string; address: string; label: string };

const ERRORS_FR: Record<string, string> = {
  forbidden: "Autorisation insuffisante.",
  outbound_disabled: "L'envoi de courrier est désactivé pour ce tenant.",
  provider_not_configured:
    "Aucun fournisseur d'envoi n'est configuré. Le message n'a pas été transmis et n'est pas enregistré comme envoyé.",
  mailbox_inactive: "Cette boîte est inactive et ne peut pas envoyer.",
  mailbox_not_found: "Boîte introuvable.",
  recipients_empty: "Indiquez au moins un destinataire.",
  recipients_invalid_address: "Adresse invalide.",
  recipients_too_many: "Trop de destinataires.",
  recipients_sender_in_recipients: "La boîte expéditrice ne peut pas être destinataire.",
  recipients_header_injection: "Adresse refusée (caractères interdits).",
  empty_body: "Le message est vide.",
  empty_subject: "L'objet est vide.",
  already_sent: "Ce message a déjà été envoyé.",
  already_in_flight: "Un envoi est déjà en cours pour ce message.",
  reply_source_not_found: "Le message d'origine est introuvable.",
};

function parseAddresses(raw: string): string[] {
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

export function Composer({
  mailboxes,
  canSend,
  replyToMessageId,
  replyAll,
  defaultSubject,
  defaultTo,
  onDone,
}: {
  mailboxes: MailboxOption[];
  canSend: boolean;
  replyToMessageId?: string | null;
  replyAll?: boolean;
  defaultSubject?: string;
  defaultTo?: string;
  onDone?: () => void;
}) {
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [to, setTo] = useState(defaultTo ?? "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (mailboxes.length === 0) {
    return (
      <p className="surface p-4 text-sm text-slate-600">
        Aucune boîte active n&apos;est disponible pour l&apos;envoi. Une boîte inactive ne peut pas
        envoyer.
      </p>
    );
  }

  const input = () => ({
    mailboxId,
    to: parseAddresses(to),
    cc: parseAddresses(cc),
    bcc: parseAddresses(bcc),
    subject,
    bodyText: body,
    replyToMessageId: replyToMessageId ?? null,
    replyAll: replyAll === true,
  });

  const run = (action: "draft" | "send") => {
    setError(null);
    setDone(null);
    start(async () => {
      const res = action === "draft" ? await saveDraft(input()) : await composeAndSend(input());
      if (res.ok) {
        setDone(action === "draft" ? "Brouillon enregistré." : "Message transmis au fournisseur.");
        onDone?.();
      } else {
        setError(ERRORS_FR[res.error] ?? `Échec : ${res.error}`);
      }
    });
  };

  return (
    <section className="surface space-y-3 p-4" aria-labelledby="emp3-composer">
      <h2 id="emp3-composer" className="text-sm font-semibold text-navy-900">
        {replyToMessageId ? (replyAll ? "Répondre à tous" : "Répondre") : "Nouveau message"}
      </h2>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          Expéditeur
          <select
            value={mailboxId}
            onChange={(e) => setMailboxId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          >
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.address}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Objet
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {(["to", "cc", "bcc"] as const).map((field) => (
        <label key={field} className="block text-xs text-slate-600">
          {field === "to" ? "À" : field === "cc" ? "Copie" : "Copie cachée"}
          <input
            value={field === "to" ? to : field === "cc" ? cc : bcc}
            onChange={(e) =>
              field === "to" ? setTo(e.target.value) : field === "cc" ? setCc(e.target.value) : setBcc(e.target.value)
            }
            placeholder="adresse@exemple.com, autre@exemple.com"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          />
        </label>
      ))}

      <label className="block text-xs text-slate-600">
        Message
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run("draft")}
          disabled={pending}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 hover:bg-slate-200 disabled:opacity-50"
        >
          {pending ? "…" : "Enregistrer le brouillon"}
        </button>
        {canSend ? (
          <button
            type="button"
            onClick={() => run("send")}
            disabled={pending}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {pending ? "Envoi…" : "Envoyer"}
          </button>
        ) : (
          <span className="text-[11px] text-slate-500">
            L&apos;envoi est une autorité distincte de la rédaction.
          </span>
        )}
      </div>

      {error ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-xs text-teal-700" role="status">
          {done}
        </p>
      ) : null}

      {/* The honesty line. "Transmitted to the provider" is the strongest claim
          this platform can make: there is no delivery webhook, so delivery and
          reading are not observable and are never asserted. */}
      <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        L&apos;acceptation par le fournisseur ne prouve pas la remise. Aucun état « remis » ou
        « lu » n&apos;est affiché, faute de preuve disponible.
      </p>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const FR: Record<string, string> = {
    DRAFT: "Brouillon", QUEUED: "En file", SENDING: "Envoi en cours",
    SENT: "Accepté par le fournisseur", FAILED: "Échec", CANCELLED: "Annulé",
  };
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        status === "SENT" && "bg-teal-50 text-teal-700",
        status === "FAILED" && "bg-red-50 text-red-700",
        status === "SENDING" && "bg-amber-100 text-amber-800",
        (status === "DRAFT" || status === "QUEUED" || status === "CANCELLED") && "bg-slate-100 text-slate-700",
      )}
    >
      {FR[status] ?? status}
    </span>
  );
}
