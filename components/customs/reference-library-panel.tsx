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
  SCAN_LABEL_FR,
  LICENCE_PENDING_CATEGORIES,
  LICENCE_STATUSES,
  REFERENCE_CATEGORIES,
  STATUS_LABEL_FR,
  publicationBlockers,
  referenceLifecycle,
  type LicenceStatus,
  type ReferenceCategory,
  type ReferenceDocument,
} from "@/lib/customs/reference/types";
import {
  publishDocument,
  recordLicenceRuling,
  recordVerifications,
  requestScan,
  submitForPublication,
  withdrawDocument,
} from "@/lib/customs/reference/actions";
import { MAX_UPLOAD_BYTES } from "@/lib/customs/reference/validate";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n";

const errors = t.customs.reference.errors as Record<string, string>;
const sentence = (code: string) => errors[code] ?? errors.generic;

const STATUS_STYLE: Record<string, string> = {
  PUBLISHED: "bg-teal-50 text-teal-700",
  QUARANTINE: "bg-amber-50 text-amber-800",
  WITHDRAWN: "bg-slate-100 text-slate-500",
};

/** Only CLEAN is reassuring, and only CLEAN lets anything be published. */
const LIFECYCLE_STYLE: Record<string, string> = {
  pendingVerification: "border-amber-200 bg-amber-50 text-amber-900",
  approved: "border-sky-200 bg-sky-50 text-sky-900",
  published: "border-emerald-200 bg-emerald-50 text-emerald-900",
  withdrawn: "border-slate-300 bg-slate-100 text-slate-700",
};

const SCAN_STYLE: Record<string, string> = {
  CLEAN: "bg-teal-50 text-teal-700",
  SCANNING: "bg-sky-50 text-sky-700",
  INFECTED: "bg-red-50 text-red-700",
  ERROR: "bg-red-50 text-red-700",
  UNSCANNED: "bg-slate-100 text-slate-600",
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
  viewerId,
  scannerConfigured,
}: {
  documents: ReferenceDocument[];
  canPublish: boolean;
  /** Needed to name self-approval BEFORE the database refuses it. */
  viewerId: string;
  /**
   * Whether a malware scanner is configured at all. REF-2.
   *
   * DISPLAY ONLY. `requestScan` re-checks this server-side and refuses with
   * `scanner_unavailable` regardless of what this prop says, so a stale or
   * forged `true` cannot cause a scan to be believed — it would only produce
   * the same refusal one click later. It is here so an operator is told up
   * front rather than discovering it by pressing a button.
   */
  scannerConfigured: boolean;
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

      {/* REF-2 — said ONCE, at the top, instead of per-document. With no
          scanner nothing can reach CLEAN, so nothing in this library is
          publishable; an operator should learn that before uploading, not
          after attesting provenance and a licence on a document that cannot
          move. The gate itself is unchanged and still refuses server-side. */}
      {!scannerConfigured && canPublish && (
        <div
          role="note"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">{t.customs.reference.scannerAbsent.title}</p>
          <p className="mt-1 text-xs">{t.customs.reference.scannerAbsent.body}</p>
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
                const blockers = publicationBlockers({
                  ...doc,
                  scanStatus: doc.scanStatus,
                  submittedForPublicationBy: doc.submittedForPublicationBy,
                  approverId: viewerId,
                });
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
                        {/* REF-2. Empty means « not regime-specific » — the
                            Customs Code, the tariff — and never « unknown ». */}
                        <p className="mt-1 text-xs text-slate-500">
                          {t.customs.reference.regimes}
                          {" : "}
                          {doc.customsRegimes.length > 0
                            ? doc.customsRegimes.join(", ")
                            : t.customs.reference.regimesNone}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* REF-2. Listed first, because « can I rely on this
                            document? » is the question an operator opens the
                            library with, and the three badges after it are the
                            reasons behind this one's answer. */}
                        <Badge className={LIFECYCLE_STYLE[referenceLifecycle(doc)]}>
                          {t.customs.reference.lifecycle[referenceLifecycle(doc)]}
                        </Badge>
                        <Badge className={STATUS_STYLE[doc.status]}>{STATUS_LABEL_FR[doc.status]}</Badge>
                        <Badge>{LICENCE_LABEL_FR[doc.licenceStatus]}</Badge>
                        <Badge className={SCAN_STYLE[doc.scanStatus]}>
                          {SCAN_LABEL_FR[doc.scanStatus]}
                        </Badge>
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

                        {/* The scan gate. Requesting is possible only before a
                            verdict exists, or after one failed. */}
                        {(doc.scanStatus === "UNSCANNED" || doc.scanStatus === "ERROR") && (
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              disabled={pending || !scannerConfigured}
                              onClick={() => run(() => requestScan(doc.id))}
                              className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                            >
                              {scannerConfigured
                                ? t.customs.reference.actions.requestScan
                                : t.customs.reference.scannerAbsent.action}
                            </button>
                            <span className="text-xs text-slate-500">
                              {t.customs.reference.scanRequiredNotice}
                            </span>
                          </div>
                        )}

                        {/* Maker-checker. The submitter is shown so the second
                            person knows whose proposal they are approving. */}
                        {!doc.submittedForPublicationBy ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(() => submitForPublication(doc.id))}
                            className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                          >
                            {t.customs.reference.actions.submitForPublication}
                          </button>
                        ) : (
                          <p className="text-xs text-slate-500">
                            {t.customs.reference.submittedNotice}
                            {doc.submittedForPublicationBy === viewerId
                              ? ` ${t.customs.reference.submittedBySelfNotice}`
                              : ""}
                          </p>
                        )}

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
  /** Which leg of a direct upload is running, for the operator. */
  const [phase, setPhase] = useState<string | null>(null);

  const replaceable = documents.filter((d) => d.category === category && !d.supersededById);

  /**
   * REF-2 — ONE form, two transports, chosen by the file's size.
   *
   * At or under `MAX_UPLOAD_BYTES` the bytes go through the REF-1 route
   * unchanged. That path is CI-verified and is deliberately left alone: a
   * 2 MB circular has no reason to take a three-request detour.
   *
   * Above it, the bytes cannot fit in a serverless request at all, so they go
   * straight to the private bucket under a short-lived signed upload URL and
   * `/finalize` reads them back, verifies them and writes the row. Both paths
   * land the same row in the same QUARANTINE state.
   */
  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    setPhase(null);
    try {
      const file = form.get("file");
      const picked = file instanceof File ? file : null;

      if (picked && picked.size > MAX_UPLOAD_BYTES) {
        await submitDirect(form, picked);
      } else {
        const res = await fetch("/api/customs/reference/upload", { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) setError(sentence(body.error ?? "generic"));
        else onDone();
      }
    } catch {
      setError(sentence("generic"));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  /** The metadata both transports send, read from the one form. */
  function metadataOf(form: FormData): Record<string, string | number | null> {
    const g = (k: string): string | null => {
      const v = form.get(k);
      const str = typeof v === "string" ? v.trim() : "";
      return str.length > 0 ? str : null;
    };
    return {
      category: g("category") ?? "",
      title: g("title") ?? "",
      sourceAuthority: g("sourceAuthority") ?? "",
      edition: g("edition"),
      publishedOn: g("publishedOn"),
      referenceCode: g("referenceCode"),
      supersedesId: g("supersedesId"),
      notes: g("notes"),
      customsRegimes: g("customsRegimes"),
    };
  }

  async function submitDirect(form: FormData, picked: File) {
    const meta = metadataOf(form);

    // 1 — ask for a ticket. The metadata is validated here too, so a missing
    // reference code is refused BEFORE a 40 MB transfer rather than after it.
    const ticketRes = await fetch("/api/customs/reference/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...meta, declaredSize: picked.size }),
    });
    const ticket = (await ticketRes.json().catch(() => ({}))) as {
      ok?: boolean; error?: string; uploadId?: string; path?: string; token?: string;
    };
    if (!ticketRes.ok || !ticket.ok || !ticket.path || !ticket.token || !ticket.uploadId) {
      setError(sentence(ticket.error ?? "generic"));
      return;
    }

    // 2 — hash locally, so the server can refuse a transfer that did not
    // arrive intact instead of recording a document nobody chose.
    const digest = await crypto.subtle.digest("SHA-256", await picked.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // 3 — the bytes, straight to the private bucket. The anon key carries no
    // storage permission of its own; the signed token authorises this one path.
    setPhase(t.customs.reference.directUpload.uploading);
    const supabase = getBrowserSupabaseClient();
    const { error: upErr } = await supabase.storage
      .from("customs-reference")
      .uploadToSignedUrl(ticket.path, ticket.token, picked, {
        contentType: "application/pdf",
      });
    if (upErr) {
      setError(sentence("upload_failed"));
      return;
    }

    // 4 — the boundary. The server reads the bytes back, validates them and
    // decides whether a document exists.
    setPhase(t.customs.reference.directUpload.verifying);
    const finRes = await fetch("/api/customs/reference/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...meta,
        uploadId: ticket.uploadId,
        declaredSize: picked.size,
        sha256,
      }),
    });
    const fin = (await finRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!finRes.ok || !fin.ok) setError(sentence(fin.error ?? "generic"));
    else onDone();
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

      {/* Said up front, because the operator is about to wait: above 4 Mo the
          transfer takes a different route and a visibly longer time. */}
      <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        {t.customs.reference.directUpload.notice}
      </p>

      {phase && (
        <p role="status" className="text-xs text-slate-600">{phase}</p>
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
          <span className="font-medium text-slate-700">{t.customs.reference.regimes}</span>
          <input
            name="customsRegimes"
            placeholder="MISE EN CONSOMMATION, TRANSIT, ADMISSION TEMPORAIRE"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
          <span className="mt-1 block text-slate-500">{t.customs.reference.regimesHint}</span>
        </label>

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
