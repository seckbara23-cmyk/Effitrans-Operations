"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ingestMessageToDossier } from "@/lib/ec/ingest/message-actions";

/**
 * CEO-ALIGNMENT WP1-D — « Rattacher ce message au dossier comme ordre de
 * transit ».
 *
 * An explicit, per-message action: the operator chooses the dossier, the type
 * is fixed (« Ordre de transit / instruction client ») because that is what
 * this control is for. What lands on the dossier is a PDF rendition of the
 * captured message — envelope, original SHA-256, text — and it enters the
 * ordinary verification workflow like any upload. Nothing is approved here.
 */
export type MessageIngestTarget = { id: string; label: string };

const ERRORS_FR: Record<string, string> = {
  forbidden_inbound: "Vous n'êtes pas autorisé à consulter le courrier entrant.",
  forbidden_document: "Vous n'êtes pas autorisé à créer un document.",
  forbidden_dossier: "Vous n'êtes pas autorisé à consulter ce dossier.",
  not_available: "Le rattachement des messages n'est pas encore disponible sur cette plateforme.",
  message_not_found: "Message introuvable.",
  already_ingested: "Ce message a déjà été rattaché à un dossier.",
  body_unreadable: "Le texte du message n'a pas pu être lu : le rattachement est refusé.",
  upload_failed: "Le document n'a pas pu être enregistré.",
  insert_failed: "Le document n'a pas pu être créé.",
};

export function MessageIngest({
  messageId,
  alreadyIngested,
  dossiers,
}: {
  messageId: string;
  alreadyIngested: { id: string; fileId: string } | null;
  dossiers: MessageIngestTarget[];
}) {
  const [fileId, setFileId] = useState(dossiers[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; fileId: string } | null>(alreadyIngested);

  if (done) {
    return (
      <p className="text-[11px] text-slate-600">
        Message rattaché comme ordre de transit —{" "}
        <Link href={`/files/${done.fileId}`} className="text-teal-700 hover:underline">
          ouvrir le dossier
        </Link>
      </p>
    );
  }

  if (dossiers.length === 0) {
    return (
      <p className="text-[11px] text-slate-500">
        Aucun dossier que vous pouvez consulter n&apos;est disponible pour ce rattachement.
      </p>
    );
  }

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await ingestMessageToDossier({ messageId, fileId });
      if (res.ok) setDone({ id: res.documentId, fileId });
      else setError(ERRORS_FR[res.error] ?? `Échec : ${res.error}`);
    });
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`msg-dossier-${messageId}`}>
        Dossier de destination
      </label>
      <select
        id={`msg-dossier-${messageId}`}
        value={fileId}
        onChange={(e) => setFileId(e.target.value)}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs"
      >
        {dossiers.map((d) => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !fileId}
        className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
      >
        Rattacher ce message au dossier comme ordre de transit
      </button>
      {error && <p className="w-full text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
