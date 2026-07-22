"use client";

/**
 * Effitrans Messaging Center — employee UI (Phase 8.7).
 * ---------------------------------------------------------------------------
 * REALTIME MODEL: there is no Supabase Realtime channel anywhere in this
 * codebase (confirmed by audit before building this), so rather than introduce
 * an unproven, hard-to-verify websocket authorization surface under time
 * pressure, this polls (fetchStaffConversations / fetchStaffConversationDetail)
 * every POLL_MS while mounted — the same "load on mount, load on interaction"
 * idiom the existing NotificationBell already uses, just on an interval too.
 * Persisted rows remain the source of truth; a poll never "delivers" anything
 * by itself, it only reconciles with what the server already committed.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  fetchStaffConversations,
  fetchStaffConversationDetail,
  sendMessage,
  markStaffConversationRead,
  createDirectConversation,
  closeConversation,
  reopenConversation,
  uploadMessageAttachment,
  getStaffAttachmentDownloadUrl,
} from "@/lib/messaging/actions";
import { CONTACT_DEPARTMENT_LABELS } from "@/lib/portal/self-service";
import { StaffRecipientPicker } from "./staff-recipient-picker";
import type { ConversationDetail, ConversationStatus, ConversationSummary } from "@/lib/messaging/types";
import type { StaffRecipient } from "@/lib/messaging/access";

const POLL_MS = 8000;

const STATUS_LABEL: Record<ConversationStatus | "all", string> = {
  all: "Toutes",
  open: "Ouverte",
  waiting_customer: "Attente client",
  waiting_effitrans: "Attente Effitrans",
  resolved: "Résolue",
  closed: "Clôturée",
};

export function MessagingCenter({
  initialConversations,
  canManage,
  initialSelectedId,
  initialDetail,
}: {
  initialConversations: ConversationSummary[];
  canManage: boolean;
  initialSelectedId?: string;
  initialDetail?: ConversationDetail | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? initialConversations[0]?.id ?? null);
  const [detail, setDetail] = useState<ConversationDetail | null>(initialDetail ?? null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");
  const [composerText, setComposerText] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showNewForm, setShowNewForm] = useState(false);
  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasMountedDetail = useRef(Boolean(initialDetail));

  const refreshList = useCallback(async () => {
    const list = await fetchStaffConversations();
    setConversations(list);
  }, []);

  const loadDetail = useCallback(
    async (id: string, markRead = true) => {
      setLoadingDetail(true);
      const d = await fetchStaffConversationDetail(id);
      setDetail(d);
      setLoadingDetail(false);
      if (d && markRead) {
        await markStaffConversationRead(id);
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
      if (selectedId) fetchStaffConversationDetail(selectedId).then((d) => d && setDetail(d));
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [selectedId, refreshList]);

  function selectConversation(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setComposerText("");
    setInternalNote(false);
    setSendError(null);
    loadDetail(id);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !composerText.trim()) return;
    setSendError(null);
    const body = composerText;
    const visibility = internalNote ? "internal" : "shared";
    setComposerText("");
    startTransition(async () => {
      const res = await sendMessage({ conversationId: selectedId, body, visibility });
      if (!res.ok) {
        setSendError(res.error);
        setComposerText(body); // restore so the user can retry without retyping
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
    const res = await uploadMessageAttachment(selectedId, fd);
    if (!res.ok) setSendError(res.error);
    else {
      loadDetail(selectedId, false);
      refreshList();
    }
  }

  async function handleDownload(attachmentId: string) {
    const res = await getStaffAttachmentDownloadUrl(attachmentId);
    if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
  }

  const filtered = conversations.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.title ?? "").toLowerCase().includes(q) ||
      (c.clientName ?? "").toLowerCase().includes(q) ||
      (c.fileNumber ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      <div className="surface flex max-h-[75vh] min-h-[420px] flex-col overflow-hidden">
        <div className="border-b border-slate-200 p-3">
          <label htmlFor="msg-search" className="sr-only">Rechercher une conversation</label>
          <input
            id="msg-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par statut">
            {(["all", "open", "waiting_customer", "waiting_effitrans", "resolved", "closed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                aria-pressed={statusFilter === s}
                className={`min-h-[28px] rounded-full px-2.5 py-1 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                  statusFilter === s ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowNewForm((v) => !v)}
            aria-expanded={showNewForm}
            className="mt-2 min-h-[36px] w-full rounded-lg border border-teal-700 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          >
            + Nouvelle conversation
          </button>
        </div>

        {showNewForm && (
          <NewConversationForm
            onCreated={(id) => {
              setShowNewForm(false);
              refreshList();
              selectConversation(id);
            }}
            onCancel={() => setShowNewForm(false)}
          />
        )}

        <ul className="flex-1 overflow-y-auto" aria-label="Liste des conversations">
          {filtered.length === 0 && <li className="p-4 text-sm text-slate-400">Aucune conversation.</li>}
          {filtered.map((c) => (
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
                  <span className="truncate text-sm font-semibold text-navy-900">
                    {c.title ?? c.clientName ?? "Conversation"}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white" aria-label={`${c.unreadCount} message(s) non lu(s)`}>
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-slate-500">{c.lastMessagePreview ?? "—"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  <span>{STATUS_LABEL[c.status]}</span>
                  {c.fileNumber && <span>· Dossier {c.fileNumber}</span>}
                  {c.departmentCode && <span>· {CONTACT_DEPARTMENT_LABELS[c.departmentCode] ?? c.departmentCode}</span>}
                  {c.priority === "urgent" && <span className="font-semibold text-red-600">· Urgent</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="surface flex max-h-[75vh] min-h-[420px] flex-col">
        {!selectedId && (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">
            Sélectionnez une conversation.
          </div>
        )}
        {selectedId && loadingDetail && !detail && (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">Chargement…</div>
        )}
        {selectedId && !loadingDetail && !detail && (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">
            Conversation introuvable ou accès non autorisé.
          </div>
        )}
        {selectedId && detail && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
              <div>
                <h2 tabIndex={-1} ref={threadHeadingRef} className="text-sm font-bold text-navy-900 focus:outline-none">
                  {detail.conversation.title ?? detail.conversation.clientName ?? "Conversation"}
                </h2>
                <p className="text-xs text-slate-500">
                  {STATUS_LABEL[detail.conversation.status]}
                  {detail.conversation.fileNumber ? ` · Dossier ${detail.conversation.fileNumber}` : ""}
                  {detail.conversation.assignedToName ? ` · Assignée à ${detail.conversation.assignedToName}` : ""}
                </p>
              </div>
              {detail.canManage && (
                <div className="flex gap-2">
                  {detail.conversation.status !== "closed" ? (
                    <button
                      type="button"
                      onClick={() => startTransition(async () => { await closeConversation(selectedId); loadDetail(selectedId, false); refreshList(); })}
                      className="min-h-[32px] rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Clôturer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startTransition(async () => { await reopenConversation(selectedId); loadDetail(selectedId, false); refreshList(); })}
                      className="min-h-[32px] rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Rouvrir
                    </button>
                  )}
                </div>
              )}
            </div>

            <ul className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-label="Messages de la conversation">
              {detail.messages.length === 0 && <li className="text-sm text-slate-400">Aucun message.</li>}
              {detail.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-lg p-3 text-sm ${
                    m.visibility === "internal"
                      ? "border border-dashed border-amber-300 bg-amber-50"
                      : m.senderType === "staff" || m.senderType === "system"
                        ? "bg-slate-50"
                        : "bg-teal-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-navy-900">
                      {m.senderName}
                      {m.senderRoleLabel ? ` · ${m.senderRoleLabel}` : ""}
                    </span>
                    <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString("fr-FR")}</time>
                  </div>
                  {m.visibility === "internal" && (
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                      Note interne — jamais visible du client
                    </p>
                  )}
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
                {canManage && (
                  <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)} />
                    Note interne (non visible du client)
                  </label>
                )}
                <label htmlFor="composer" className="sr-only">Votre message</label>
                <textarea
                  id="composer"
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
                Conversation clôturée{detail.canManage ? " — rouvrez-la pour répondre." : "."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Staff-to-staff conversation starter (Phase 8.6A) — searches colleagues by name/
 * email/role/department via StaffRecipientPicker instead of asking for a raw user
 * id. The internal id only ever lives in component state after a real selection;
 * it is re-validated server-side by createDirectConversation regardless.
 */
function NewConversationForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [recipient, setRecipient] = useState<StaffRecipient | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient || !message.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createDirectConversation({ participantUserId: recipient.id, firstMessage: message });
      if (!res.ok) setError(res.error === "not_found" ? "Ce collègue n'est plus disponible. Choisissez-en un autre." : res.error);
      else onCreated(res.id);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-b border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-semibold text-navy-900">Nouvelle conversation</p>

      <StaffRecipientPicker
        selected={recipient}
        onSelect={(r) => {
          setRecipient(r);
          setError(null);
        }}
        onClear={() => setRecipient(null)}
        disabled={pending}
      />

      <div>
        <label htmlFor="new-conv-message" className="mb-1 block text-xs font-medium text-slate-600">
          Premier message
        </label>
        <textarea
          id="new-conv-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="min-h-[44px] rounded-lg px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
          Annuler
        </button>
        <button
          type="submit"
          disabled={pending || !recipient || !message.trim()}
          className="min-h-[44px] rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Créer
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">Échec : {error}</p>}
    </form>
  );
}
