"use client";

/**
 * EC-2 — triage detail workspace (client).
 *
 * SAFE RENDERING, BY REMOVAL RATHER THAN BY SANITIZER.
 * The captured HTML body is NEVER fetched and NEVER rendered. Only the plain
 * text body is displayed, inside a React text node — so it is escaped by the
 * framework and there is no `dangerouslySetInnerHTML` anywhere in this file.
 * That single decision removes the XSS surface, remote images and tracking
 * pixels, and leaves no sanitizer to keep current. The HTML remains in private
 * storage as evidence; it is simply never injected into a page.
 *
 * Four outcomes, no fifth. Quarantine is EC-1's capture-time verdict for
 * unroutable mail and is not offered here — a visible message is, by
 * definition, already routed.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  claimTriageItem, assignTriageItem, reviewTriageItem,
  resolveTriageItem, readBodyText, signAttachment,
} from "@/lib/ec/triage/actions";
import {
  TRIAGE_OUTCOMES, TRIAGE_OUTCOME_FR, TRIAGE_STATUS_FR,
  DISCARD_REASON_CODES, DISCARD_REASON_FR, validateOutcome, isOpen,
  type TriageOutcome, type TriageStatus,
} from "@/lib/ec/triage/model";

type Attachment = {
  id: string; filename: string; mimeType: string | null; sizeBytes: number;
  sha256: string | null; stored: boolean; rejectionReason: string | null;
};

type Item = {
  id: string; messageId: string; status: TriageStatus;
  assignedTo: string | null; outcome: TriageOutcome | null;
  outcomeFileId: string | null; discardReasonCode: string | null;
  outcomeComment: string | null; resolvedAt: string | null;
  fromAddress: string; fromName: string | null; subject: string | null;
  receivedAt: string; mailboxAddress: string | null; mailboxPurpose: string | null;
  toAddresses: string[]; ccAddresses: string[];
  messageIdHeader: string | null; threadKey: string | null; rawSha256: string;
  hasTextBody: boolean; hasHtmlBody: boolean; attachments: Attachment[];
};

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (communication:triage requis).",
  forbidden_reassign: "Réattribution réservée au superviseur des opérations.",
  item_not_found: "Élément de tri introuvable.",
  terminal_item: "Cet élément est déjà traité — une correction se fait sur un nouveau message.",
  outcome_immutable: "Une décision de tri est définitive.",
  outcome_required: "Une résolution exige une décision.",
  quarantined_not_triable: "Un message en quarantaine n'est pas triable.",
  invalid_outcome: "Décision invalide.",
  dossier_required: "Sélectionnez le dossier de rattachement.",
  dossier_not_found: "Dossier introuvable dans ce tenant.",
  dossier_not_visible: "Vous n'êtes pas autorisé à consulter ce dossier.",
  dossier_not_allowed: "Cette décision ne comporte pas de dossier.",
  reason_required: "Le motif de rejet est obligatoire.",
  invalid_reason: "Motif de rejet inconnu.",
  reason_not_allowed: "Cette décision ne comporte pas de motif de rejet.",
  assignee_required: "Sélectionnez un destinataire.",
  no_text_body: "Ce message ne contient pas de corps en texte brut.",
  download_failed: "Le contenu n'a pas pu être récupéré.",
  not_stored: "Cette pièce jointe n'a pas été extraite (type non autorisé ou trop volumineuse).",
  url_failed: "Lien d'accès indisponible.",
  save_failed: "Échec de l'enregistrement.",
};

export function TriageStudio({
  item, canTriage, isSupervisor, currentUserId, dossiers,
}: {
  item: Item;
  canTriage: boolean;
  isSupervisor: boolean;
  currentUserId: string;
  dossiers: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<TriageOutcome | "">("");
  const [fileId, setFileId] = useState("");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  const open = isOpen(item.status);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else router.refresh();
    });
  };

  const loadBody = () => {
    setError(null);
    start(async () => {
      const res = await readBodyText(item.id);
      if (res.ok) setBody(res.text);
      else setError(ERR[res.error] ?? ERR.save_failed);
    });
  };

  const openAttachment = (id: string) => {
    setError(null);
    start(async () => {
      const res = await signAttachment(id);
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
      else setError(ERR[res.error] ?? ERR.save_failed);
    });
  };

  const problem = outcome ? validateOutcome({ outcome, fileId: fileId || null, reasonCode: reason || null }) : null;

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {/* -------------------------------------------------- envelope */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Enveloppe</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-400">Expéditeur</dt><dd className="text-sm text-navy-900">{item.fromName ? `${item.fromName} <${item.fromAddress}>` : item.fromAddress}</dd></div>
          <div><dt className="text-xs text-slate-400">Boîte destinataire</dt><dd className="text-sm text-navy-900">{item.mailboxAddress ?? "—"}{item.mailboxPurpose ? ` (${item.mailboxPurpose})` : ""}</dd></div>
          <div><dt className="text-xs text-slate-400">À</dt><dd className="text-sm text-slate-700">{item.toAddresses.join(", ") || "—"}</dd></div>
          <div><dt className="text-xs text-slate-400">Copie</dt><dd className="text-sm text-slate-700">{item.ccAddresses.join(", ") || "—"}</dd></div>
          <div><dt className="text-xs text-slate-400">Reçu le</dt><dd className="tabular text-sm text-slate-700">{item.receivedAt.slice(0, 16).replace("T", " ")}</dd></div>
          <div><dt className="text-xs text-slate-400">Statut</dt><dd className="text-sm text-slate-700">{TRIAGE_STATUS_FR[item.status]}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-400">Empreinte de l&apos;enveloppe (SHA-256)</dt>
            <dd className="break-all font-mono text-xs text-slate-500">{item.rawSha256}</dd>
          </div>
        </dl>
      </section>

      {/* -------------------------------------------------- body (text only) */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Contenu</h2>
        {!item.hasTextBody ? (
          <p className="text-sm text-slate-500">Aucun corps en texte brut n&apos;a été capturé.</p>
        ) : body === null ? (
          <button type="button" disabled={pending} onClick={loadBody}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-navy-800 disabled:opacity-50">
            Afficher le texte du message
          </button>
        ) : (
          // Rendered as a TEXT NODE — React escapes it. No HTML is parsed.
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-sm text-slate-800">
            {body}
          </pre>
        )}
        {item.hasHtmlBody && (
          <p className="mt-2 text-xs text-slate-500">
            Une version HTML a été capturée et conservée comme preuve. Elle n&apos;est
            <strong className="text-navy-800"> jamais affichée</strong> : aucun contenu distant
            (images, pixels de suivi) n&apos;est chargé depuis un message entrant.
          </p>
        )}
      </section>

      {/* -------------------------------------------------- attachments */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Pièces jointes ({item.attachments.length})</h2>
        {item.attachments.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune pièce jointe.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {item.attachments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-navy-900">{a.filename}</p>
                  <p className="text-xs text-slate-500">
                    {a.mimeType ?? "type inconnu"} · {Math.max(1, Math.round(a.sizeBytes / 1024))} Ko
                    {a.sha256 && <span className="ml-1 font-mono text-slate-400">{a.sha256.slice(0, 12)}…</span>}
                  </p>
                </div>
                {a.stored ? (
                  <button type="button" disabled={pending} onClick={() => openAttachment(a.id)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-navy-800 disabled:opacity-50">
                    Ouvrir (lien temporaire)
                  </button>
                ) : (
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">
                    Non extraite — {a.rejectionReason === "mime_not_allowed" ? "type non autorisé" : a.rejectionReason === "too_large" ? "trop volumineuse" : "extraction impossible"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Ces pièces sont des <strong className="text-navy-800">preuves en attente</strong>. Leur
          promotion en document gouverné du dossier reste un acte humain distinct.
        </p>
      </section>

      {/* -------------------------------------------------- decision */}
      {item.outcome ? (
        <section className="surface p-5">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Décision enregistrée</h2>
          <p className="text-sm text-navy-900">{TRIAGE_OUTCOME_FR[item.outcome]}</p>
          {item.outcomeFileId && (
            <p className="mt-1 text-sm">
              <Link href={`/files/${item.outcomeFileId}`} className="text-teal-700 hover:underline">
                Ouvrir le dossier rattaché
              </Link>
            </p>
          )}
          {item.discardReasonCode && (
            <p className="mt-1 text-sm text-slate-600">
              Motif : {DISCARD_REASON_FR[item.discardReasonCode as keyof typeof DISCARD_REASON_FR] ?? item.discardReasonCode}
            </p>
          )}
          {item.outcomeComment && <p className="mt-1 text-sm text-slate-600">{item.outcomeComment}</p>}
          <p className="mt-2 text-xs text-slate-400">Une décision de tri est définitive.</p>
        </section>
      ) : canTriage && open ? (
        <section className="surface space-y-4 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Traiter ce message</h2>

          <div className="flex flex-wrap gap-2">
            {item.assignedTo === null && (
              <button type="button" disabled={pending} onClick={() => run(() => claimTriageItem(item.id))}
                className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                Me l&apos;attribuer
              </button>
            )}
            {item.assignedTo !== null && item.assignedTo !== currentUserId && !isSupervisor && (
              <span className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-500">
                Attribué à un autre opérateur — réattribution réservée au superviseur
              </span>
            )}
            {item.assignedTo !== null && isSupervisor && (
              <button type="button" disabled={pending}
                onClick={() => run(() => assignTriageItem(item.id, currentUserId))}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-navy-800 disabled:opacity-50">
                Me réattribuer cet élément
              </button>
            )}
            {item.status === "ASSIGNED" && (
              <button type="button" disabled={pending} onClick={() => run(() => reviewTriageItem(item.id))}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-navy-800 disabled:opacity-50">
                Passer en examen
              </button>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Décision</legend>
            {TRIAGE_OUTCOMES.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" name="outcome" value={o} checked={outcome === o}
                  onChange={() => { setOutcome(o); setFileId(""); setReason(""); }} />
                {TRIAGE_OUTCOME_FR[o]}
              </label>
            ))}
          </fieldset>

          {outcome === "ATTACH_TO_DOSSIER" && (
            <div>
              <label className="mb-1 block text-xs text-slate-500" htmlFor="dossier">Dossier de rattachement</label>
              <select id="dossier" value={fileId} onChange={(e) => setFileId(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                <option value="">— Sélectionner —</option>
                {dossiers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              {dossiers.length === 0 && (
                <p className="mt-1 text-xs text-slate-500">Aucun dossier accessible avec vos autorisations.</p>
              )}
            </div>
          )}

          {outcome === "DISCARD" && (
            <div>
              <label className="mb-1 block text-xs text-slate-500" htmlFor="reason">Motif de rejet (obligatoire)</label>
              <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                <option value="">— Sélectionner —</option>
                {DISCARD_REASON_CODES.map((c) => <option key={c} value={c}>{DISCARD_REASON_FR[c]}</option>)}
              </select>
            </div>
          )}

          {outcome && (
            <div>
              <label className="mb-1 block text-xs text-slate-500" htmlFor="comment">Commentaire (facultatif)</label>
              <textarea id="comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            </div>
          )}

          {outcome === "HANDOFF_TO_QUOTATION" && (
            <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              L&apos;intention est enregistrée et transmise. <strong className="text-navy-800">Aucune
              cotation n&apos;est créée ici</strong> : l&apos;entité cotation appartient à la phase EC-3.
            </p>
          )}

          <button type="button"
            disabled={pending || !outcome || problem !== null}
            onClick={() => run(() => resolveTriageItem(item.id, {
              outcome: outcome as TriageOutcome,
              fileId: fileId || null,
              reasonCode: reason || null,
              comment: comment || null,
            }))}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            Enregistrer la décision
          </button>
          {problem && <p className="text-xs text-amber-700">{ERR[problem]}</p>}
        </section>
      ) : (
        <p className="surface p-4 text-sm text-slate-600">
          {canTriage
            ? "Cet élément n'est plus ouvert au tri."
            : "Le tri est une autorité distincte (« communication:triage »), en attente de ratification."}
        </p>
      )}
    </div>
  );
}
