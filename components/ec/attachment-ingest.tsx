"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ingestAttachmentToDossier } from "@/lib/ec/ingest/actions";

/**
 * EMP-4 — "attach this to a dossier".
 *
 * Deliberately an explicit, per-attachment action with a required document
 * type. Nothing is inferred: an email attachment has no inherent type, and
 * guessing one would record a guess as a fact.
 *
 * The component lives in its own file rather than inside the triage studio,
 * because EC-2 pins that its own surfaces create nothing automatically. Keeping
 * ingestion out of those files keeps that guarantee true.
 *
 * It offers no OCR, no analysis and no sharing. Ingestion moves a copy into the
 * dossier; everything after that is the document workspace's existing job.
 */
export type IngestTarget = { id: string; label: string };
export type IngestDocType = { code: string; label: string };

const ERRORS_FR: Record<string, string> = {
  forbidden_inbound: "Vous n'êtes pas autorisé à consulter le courrier entrant.",
  forbidden_document: "Vous n'êtes pas autorisé à créer un document.",
  forbidden_dossier: "Vous n'êtes pas autorisé à consulter ce dossier.",
  type_required: "Choisissez un type de document.",
  attachment_not_found: "Pièce jointe introuvable.",
  attachment_not_stored: "Cette pièce jointe n'a pas été conservée : son contenu n'est pas disponible.",
  already_ingested: "Cette pièce jointe a déjà été rattachée à un dossier.",
  download_failed: "Le contenu de la pièce jointe n'a pas pu être lu.",
  hash_mismatch:
    "L'empreinte du contenu ne correspond pas à celle enregistrée à la capture. Le rattachement est refusé.",
  upload_failed: "Le document n'a pas pu être enregistré.",
  insert_failed: "Le document n'a pas pu être créé.",
};

export function AttachmentIngest({
  attachmentId,
  filename,
  stored,
  alreadyIngested,
  dossiers,
  documentTypes,
  canIngest,
}: {
  attachmentId: string;
  filename: string;
  stored: boolean;
  alreadyIngested: { id: string; fileId: string } | null;
  dossiers: IngestTarget[];
  documentTypes: IngestDocType[];
  canIngest: boolean;
}) {
  const [fileId, setFileId] = useState(dossiers[0]?.id ?? "");
  const [typeCode, setTypeCode] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; fileId: string } | null>(
    alreadyIngested,
  );

  // Already done: say so and link to it, rather than offering an action that
  // would be refused.
  if (done) {
    return (
      <p className="text-[11px] text-slate-600">
        Rattachée au dossier —{" "}
        <Link href={`/files/${done.fileId}`} className="text-teal-700 hover:underline">
          ouvrir le dossier
        </Link>
      </p>
    );
  }

  if (!stored) {
    return (
      <p className="text-[11px] text-slate-500">
        Contenu non conservé : cette pièce jointe ne peut pas être rattachée.
      </p>
    );
  }

  if (!canIngest || dossiers.length === 0) {
    return (
      <p className="text-[11px] text-slate-500">
        Le rattachement requiert l&apos;autorisation de créer un document dans un dossier
        que vous pouvez consulter.
      </p>
    );
  }

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await ingestAttachmentToDossier({ attachmentId, fileId, typeCode });
      if (res.ok) setDone({ id: res.documentId, fileId });
      else setError(ERRORS_FR[res.error] ?? `Échec : ${res.error}`);
    });
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`dossier-${attachmentId}`}>
        Dossier de destination
      </label>
      <select
        id={`dossier-${attachmentId}`}
        value={fileId}
        onChange={(e) => setFileId(e.target.value)}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs"
      >
        {dossiers.map((d) => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor={`type-${attachmentId}`}>
        Type de document
      </label>
      <select
        id={`type-${attachmentId}`}
        value={typeCode}
        onChange={(e) => setTypeCode(e.target.value)}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs"
      >
        <option value="">— Type de document —</option>
        {documentTypes.map((t) => (
          <option key={t.code} value={t.code}>{t.label}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={submit}
        disabled={pending || !fileId || !typeCode}
        className="rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        title={`Rattacher ${filename} au dossier`}
      >
        {pending ? "…" : "Rattacher au dossier"}
      </button>

      {error ? (
        <span className="text-[11px] text-red-700" role="alert">{error}</span>
      ) : null}
    </div>
  );
}
