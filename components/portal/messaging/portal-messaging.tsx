"use client";

/**
 * Effitrans Messaging Center — customer portal UI (Phase 8.7).
 * ---------------------------------------------------------------------------
 * Customer-focused language throughout: "Support Effitrans", not "conversation
 * client_support". Never exposes internal staff notes (RLS already denies them —
 * see the migration's message_portal_select policy — this UI does not even ask
 * for them), the employee directory, internal audit metadata, or any OTHER
 * customer's data (RLS scopes every read to the caller's own client_id).
 * Same poll-based "realtime" model as the employee UI — see its header comment.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  fetchPortalConversations,
  fetchPortalConversationDetail,
  sendPortalMessage,
  markPortalConversationRead,
  createSupportConversation,
  uploadPortalMessageAttachment,
  getPortalAttachmentDownloadUrl,
} from "@/lib/portal/messaging-actions";
import { CONTACT_DEPARTMENTS, CONTACT_DEPARTMENT_LABELS } from "@/lib/portal/self-service";
import type { ConversationDetail, ConversationSummary } from "@/lib/messaging/types";

const POLL_MS = 8000;

const STATUS_LABEL: Record<string, string> = {
  open: "Ouverte",
  waiting_customer: "En attente de votre réponse",
  waiting_effitrans: "En cours de traitement",
  resolved: "Résolue",
  closed: "Clôturée",
};

export function PortalMessaging({
  initialConversations,
  initialSelectedId,
  initialDetail,
}: {
  initialConversations: ConversationSummary[];
  initialSelectedId?: string;
  initialDetail?: ConversationDetail | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? initialConversations[0]?.id ?? null);
  const [detail, setDetail] = useState<ConversationDetail | null>(initialDetail ?? null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showNewForm, setShowNewForm] = useState(false);
  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasMountedDetail = useRef(Boolean(initialDetail));

  const refreshList = useCallback(async () => {
    setConversations(await fetchPortalConversations());
  }, []);

  const loadDetail = useCallback(
    async (id: string, markRead = true) => {
      setLoadingDetail(true);
      const d = await fetchPortalConversationDetail(id);
      setDetail(d);
      setLoadingDetail(false);
      if (d && markRead) {
        await markPortalConversationRead(id);
        refreshList();
      }
    },
    [refreshList],
  );

  useEffect(() => {
    if (selectedId && !hasMountedDetail.current) {
      hasMountedDetail.current = true;
      loadDetail(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    threadHeadingRef.current?.focus();
  }, [selectedId]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshList();
      if (selectedId) fetchPortalConversationDetail(selectedId).then((d) => d && setDetail(d));
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [selectedId, refreshList]);

  function selectConversation(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setComposerText("");
    setSendError(null);
    loadDetail(id);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !composerText.trim()) return;
    setSendError(null);
    const body = composerText;
    setComposerText("");
    startTransition(async () => {
      const res = await sendPortalMessage({ conversationId: selectedId, body });
      if (!res.ok) {
        setSendError(res.error);
        setComposerText(body);
      } else {
        loadDetail(selectedId, false);
        refreshList();
      }
    });
  }

  async function handleAttach(file: File) {
    if (!selectedId) return;
    setSendError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadPortalMessageAttachment(selectedId, fd);
    if (!res.ok) setSendError(res.error);
    else {
      loadDetail(selectedId, false);
      refreshList();
    }
  }

  async function handleDownload(attachmentId: string) {
    const res = await getPortalAttachmentDownloadUrl(attachmentId);
    if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <div className="surface flex max-h-[75vh] min-h-[420px] flex-col overflow-hidden">
        <div className="border-b border-slate-200 p-3">
          <button
            type="button"
            onClick={() => setShowNewForm((v) => !v)}
            aria-expanded={showNewForm}
            className="min-h-[36px] w-full rounded-lg border border-teal-700 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          >
            + Contacter Effitrans
          </button>
        </div>

        {showNewForm && (
          <NewRequestForm
            onCreated={(id) => {
              setShowNewForm(false);
              refreshList();
              selectConversation(id);
            }}
            onCancel={() => setShowNewForm(false)}
          />
        )}

        <ul className="flex-1 overflow-y-auto" aria-label="Vos demandes">
          {conversations.length === 0 && <li className="p-4 text-sm text-slate-400">Aucune demande pour le moment.</li>}
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => selectConversation(c.id)}
                aria-current={c.id === selectedId ? "true" : undefined}
                className={`block min-h-[44px] w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500/40 ${
                  c.id === selectedId ? "bg-teal-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-navy-900">{c.title ?? "Demande"}</span>
                  {c.unreadCount > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white" aria-label={`${c.unreadCount} message(s) non lu(s)`}>
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-slate-500">{c.lastMessagePreview ?? "—"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  <span>{STATUS_LABEL[c.status] ?? c.status}</span>
                  {c.fileNumber && <span>· Dossier {c.fileNumber}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="surface flex max-h-[75vh] min-h-[420px] flex-col">
        {!selectedId && (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">
            Sélectionnez une demande, ou contactez Effitrans pour en créer une.
          </div>
        )}
        {selectedId && loadingDetail && !detail && (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">Chargement…</div>
        )}
        {selectedId && detail && (
          <>
            <div className="border-b border-slate-200 p-4">
              <h2 tabIndex={-1} ref={threadHeadingRef} className="text-sm font-bold text-navy-900 focus:outline-none">
                {detail.conversation.title ?? "Demande"}
              </h2>
              <p className="text-xs text-slate-500">
                {STATUS_LABEL[detail.conversation.status] ?? detail.conversation.status}
                {detail.conversation.fileNumber ? ` · Dossier ${detail.conversation.fileNumber}` : ""}
              </p>
            </div>

            <ul className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-label="Messages de la demande">
              {detail.messages.length === 0 && <li className="text-sm text-slate-400">Aucun message.</li>}
              {detail.messages.map((m) => (
                <li key={m.id} className={`rounded-lg p-3 text-sm ${m.senderType === "customer" ? "bg-teal-50" : "bg-slate-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-navy-900">{m.senderType === "customer" ? "Vous" : "Effitrans"}</span>
                    <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString("fr-FR")}</time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-navy-900">{m.body}</p>
                  {m.attachments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleDownload(a.id)}
                      className="mt-1 flex min-h-[32px] items-center gap-1 text-xs font-medium text-teal-700 underline focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                    >
                      📎 {a.originalFilename}
                    </button>
                  ))}
                </li>
              ))}
            </ul>

            {detail.canSend ? (
              <form onSubmit={handleSend} className="border-t border-slate-200 p-3">
                <label htmlFor="portal-composer" className="sr-only">Votre message</label>
                <textarea
                  id="portal-composer"
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  rows={2}
                  placeholder="Écrire un message…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="flex min-h-[36px] cursor-pointer items-center text-xs font-medium text-teal-700">
                    📎 Joindre un fichier
                    <input
                      type="file"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAttach(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={pending || !composerText.trim()}
                    className="min-h-[36px] rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    Envoyer
                  </button>
                </div>
                {sendError && (
                  <p role="alert" className="mt-2 text-xs text-red-600">
                    Échec de l&apos;envoi : {sendError}
                  </p>
                )}
              </form>
            ) : (
              <p className="border-t border-slate-200 p-3 text-center text-xs text-slate-500">
                Cette demande est clôturée. Contactez Effitrans pour en ouvrir une nouvelle.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NewRequestForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [department, setDepartment] = useState("general");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createSupportConversation({ department, message });
      if (!res.ok) setError(res.error);
      else onCreated(res.id);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-b border-slate-200 bg-slate-50 p-3">
      <label htmlFor="new-req-dept" className="block text-xs font-medium text-slate-600">Service concerné</label>
      <select
        id="new-req-dept"
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
      >
        {CONTACT_DEPARTMENTS.map((dep) => (
          <option key={dep} value={dep}>{CONTACT_DEPARTMENT_LABELS[dep] ?? dep}</option>
        ))}
      </select>
      <label htmlFor="new-req-message" className="block text-xs font-medium text-slate-600">Votre message</label>
      <textarea
        id="new-req-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
        rows={3}
        maxLength={2000}
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-[32px] rounded-lg px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Annuler
        </button>
        <button type="submit" disabled={pending} className="min-h-[32px] rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          Envoyer
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">Échec : {error}</p>}
    </form>
  );
}
