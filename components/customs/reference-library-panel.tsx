"use client";

/**
 * Customs Reference Library — the operator surface. CUSTOMS-REF-01A / REF-1.
 * ---------------------------------------------------------------------------
 * A reader sees a grouped, consultable list and nothing else: the publishing
 * controls are not rendered at all for them. That is presentation, not
 * security — the route, the actions and the RLS policy each refuse
 * independently — but a button that cannot work should not be shown.
 *
 * Every refusal is displayed as its French sentence from `t`, looked up by the
 * code the action returned, so an operator is told what to do rather than being
 * shown an error class.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORY_LABEL_FR,
  LICENCE_LABEL_FR,
  LICENCE_PENDING_CATEGORIES,
  LICENCE_STATUSES,
  REFERENCE_CATEGORIES,
  STATUS_LABEL_FR,
  publicationBlockers,
  type LicenceStatus,
  type ReferenceCategory,
  type ReferenceDocument,
} from "@/lib/customs/reference/types";
import {
  publishDocument,
  recordLicenceRuling,
  recordVerifications,
  withdrawDocument,
} from "@/lib/customs/reference/actions";
import { t } from "@/lib/i18n";

const errors = t.customs.reference.errors as Record<string, string>;
const sentence = (code: string) => errors[code] ?? errors.generic;

const STATUS_STYLE: Record<string, string> = {
  PUBLISHED: "bg-teal-50 text-teal-700",
  QUARANTINE: "bg-amber-50 text-amber-800",
  WITHDRAWN: "bg-slate-100 text-slate-500",
};

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${className ?? "bg-slate-100 text-slate-600"}`}>
      {children}
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

export function ReferenceLibraryPanel({
  documents,
  canPublish,
}: {
  documents: ReferenceDocument[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setMessage(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setMessage(sentence(res.error ?? "generic"));
      else router.refresh();
    });
  };

  const byCategory = (c: ReferenceCategory) => documents.filter((d) => d.category === c);

  return (
    <div className="space-y-6">
      {message && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {message}
        </div>
      )}

      {canPublish && <UploadForm documents={documents} onDone={() => router.refresh()} />}

      {documents.length === 0 && (
        <div className="surface p-6 text-sm text-slate-600">{t.customs.reference.empty}</div>
      )}

      {REFERENCE_CATEGORIES.map((category) => {
        const docs = byCategory(category);
        if (docs.length === 0) return null;
        return (
          <section key={category} className="surface p-6">
            <h2 className="text-sm font-semibold text-slate-800">{CATEGORY_LABEL_FR[category]}</h2>

            {LICENCE_PENDING_CATEGORIES.includes(category) && (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {t.customs.reference.licencePendingNotice}
              </p>
            )}

            <ul className="mt-4 space-y-4">
              {docs.map((doc) => {
                const blockers = publicationBlockers(doc);
                const isOpen = selected === doc.id;
                return (
                  <li key={doc.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{doc.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {doc.sourceAuthority}
                          {doc.edition ? ` · ${doc.edition}` : ""}
                          {doc.publishedOn ? ` · ${doc.publishedOn}` : ""}
                          {` · v${doc.version} · ${formatSize(doc.sizeBytes)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={STATUS_STYLE[doc.status]}>{STATUS_LABEL_FR[doc.status]}</Badge>
                        <Badge>{LICENCE_LABEL_FR[doc.licenceStatus]}</Badge>
                        {doc.supersededAt && <Badge>Remplacé</Badge>}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                      {/* The ONE door to the bytes. A new tab, because the route
                          streams an inline PDF rather than handing out a URL. */}
                      <a
                        href={`/api/customs/reference/${doc.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-teal-700 underline hover:no-underline"
                      >
                        {t.customs.reference.actions.view}
                      </a>

                      {canPublish && (
                        <button
                          type="button"
                          onClick={() => setSelected(isOpen ? null : doc.id)}
                          className="text-slate-600 underline hover:no-underline"
                        >
                          {isOpen ? "Masquer" : "Gérer"}
                        </button>
                      )}
                    </div>

                    {doc.status === "QUARANTINE" && canPublish && (
                      <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        {t.customs.reference.quarantineNotice}
                      </p>
                    )}

                    {canPublish && isOpen && (
                      <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge className={doc.provenanceVerified ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-600"}>
                            {doc.provenanceVerified
                              ? t.customs.reference.verification.provenanceVerified
                              : t.customs.reference.verification.provenancePending}
                          </Badge>
                          <Badge className={doc.legalVersionVerified ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-600"}>
                            {doc.legalVersionVerified
                              ? t.customs.reference.verification.legalVersionVerified
                              : t.customs.reference.verification.legalVersionPending}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {!doc.provenanceVerified && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => recordVerifications(doc.id, { provenance: true }))}
                              className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                            >
                              {t.customs.reference.actions.verifyProvenance}
                            </button>
                          )}
                          {!doc.legalVersionVerified && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => recordVerifications(doc.id, { legalVersion: true }))}
                              className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                            >
                              {t.customs.reference.actions.verifyLegalVersion}
                            </button>
                          )}
                        </div>

                        <LicenceForm doc={doc} pending={pending} run={run} />

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={pending || blockers.length > 0}
                            onClick={() => run(() => publishDocument(doc.id))}
                            className="rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                          >
                            {t.customs.reference.actions.publish}
                          </button>
                          {blockers.length > 0 && (
                            <span className="text-xs text-slate-500">{sentence(blockers[0])}</span>
                          )}
                        </div>

                        {doc.status !== "WITHDRAWN" && (
                          <WithdrawForm doc={doc} pending={pending} run={run} />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LicenceForm({
  doc,
  pending,
  run,
}: {
  doc: ReferenceDocument;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [value, setValue] = useState<LicenceStatus>(doc.licenceStatus);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-700">
        {t.customs.reference.fields.licence}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value as LicenceStatus)}
          className="rounded border border-slate-300 px-2 py-1.5 text-xs"
        >
          {LICENCE_STATUSES.map((s) => (
            <option key={s} value={s}>{LICENCE_LABEL_FR[s]}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Source de la décision (qui, quand)"
          className="min-w-[16rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-xs"
        />
        <button
          type="button"
          disabled={pending || note.trim().length === 0}
          onClick={() => run(() => recordLicenceRuling(doc.id, value, note))}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          {t.customs.reference.actions.recordLicence}
        </button>
      </div>
    </div>
  );
}

function WithdrawForm({
  doc,
  pending,
  run,
}: {
  doc: ReferenceDocument;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motif du retrait"
        className="min-w-[16rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-xs"
      />
      <button
        type="button"
        disabled={pending || reason.trim().length === 0}
        onClick={() => run(() => withdrawDocument(doc.id, reason))}
        className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {t.customs.reference.actions.withdraw}
      </button>
    </div>
  );
}

/**
 * Upload, and optionally replacement.
 *
 * Posts to the route handler rather than calling a server action, because a
 * server action's body limit is 1 MB and most statutes are larger. The
 * predecessor selector offers only documents that are not already superseded —
 * the route re-checks that, since a disabled option is not a control.
 */
function UploadForm({
  documents,
  onDone,
}: {
  documents: ReferenceDocument[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ReferenceCategory>("LEGISLATION");

  const replaceable = documents.filter((d) => d.category === category && !d.supersededById);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customs/reference/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) setError(sentence(body.error ?? "generic"));
      else onDone();
    } catch {
      setError(sentence("generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="surface space-y-3 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
      }}
    >
      <h2 className="text-sm font-semibold text-slate-800">
        {t.customs.reference.actions.upload}
      </h2>

      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="font-medium text-slate-700">{t.customs.reference.fields.category}</span>
          <select
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ReferenceCategory)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          >
            {REFERENCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL_FR[c]}</option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="font-medium text-slate-700">{t.customs.reference.fields.title}</span>
          <input name="title" required className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>

        <label className="block text-xs">
          <span className="font-medium text-slate-700">{t.customs.reference.fields.sourceAuthority}</span>
          <input
            name="sourceAuthority"
            required
            defaultValue="Direction Générale des Douanes"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium text-slate-700">{t.customs.reference.fields.edition}</span>
          <input name="edition" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>

        <label className="block text-xs">
          <span className="font-medium text-slate-700">{t.customs.reference.fields.publishedOn}</span>
          <input type="date" name="publishedOn" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>

        <label className="block text-xs">
          <span className="font-medium text-slate-700">{t.customs.reference.fields.referenceCode}</span>
          <input
            name="referenceCode"
            required
            placeholder="TEC, CODE-DOUANES, CIRC-2026-014…"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        {replaceable.length > 0 && (
          <label className="block text-xs sm:col-span-2">
            <span className="font-medium text-slate-700">{t.customs.reference.actions.replace}</span>
            <select name="supersedesId" defaultValue="" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">—</option>
              {replaceable.map((d) => (
                <option key={d.id} value={d.id}>{`${d.title} (v${d.version})`}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-xs sm:col-span-2">
          <span className="font-medium text-slate-700">Fichier PDF</span>
          <input
            type="file"
            name="file"
            accept="application/pdf"
            required
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
      </div>

      <p className="text-xs text-slate-500">{t.customs.reference.quarantineNotice}</p>

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? "Téléversement…" : t.customs.reference.actions.upload}
      </button>
    </form>
  );
}
