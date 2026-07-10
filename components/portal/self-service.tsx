"use client";

/**
 * Client self-service UI (Phase 3.3B) — the customer's interactive surface on
 * their OWN dossier. Every button calls an ownership-verified server action
 * (lib/portal/self-service-actions) that writes via the service-role client and
 * audits with the client_user id. Nothing here validates a document or marks an
 * invoice paid: uploads are queued for STAFF review; payment proofs are files;
 * requests/messages become tasks. Purely presentational + the action calls —
 * the safety rules live server-side.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadPortalDocument,
  replacePortalDocument,
  uploadPortalPaymentProof,
  requestPortalUpdate,
  contactEffitrans,
} from "@/lib/portal/self-service-actions";
import { CONTACT_DEPARTMENTS } from "@/lib/portal/self-service";
import type { SelfServiceActions } from "@/lib/portal/self-service";
import { t } from "@/lib/i18n";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx,.xlsx,application/pdf,image/jpeg,image/png";
const MAX_BYTES = 26_214_400; // mirrors lib/documents/validate (client-side hint only)

type Result = { ok: true; id?: string } | { ok: false; error: string };

function errorText(code: string): string {
  const e = t.portal.premium.selfService.errors as Record<string, string>;
  return e[code] ?? e.generic;
}

// -------------------------------------------------------- shared upload button
function FileField({ name = "file", id }: { name?: string; id: string }) {
  const s = t.portal.premium.selfService;
  return (
    <div className="space-y-1">
      <input
        id={id}
        name={name}
        type="file"
        accept={ACCEPT}
        required
        className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-teal-700 hover:file:bg-teal-100"
      />
      <p className="text-[11px] text-slate-400">{s.constraints}</p>
    </div>
  );
}

/** Read + light-validate the file from a form before calling the action. */
function precheck(form: HTMLFormElement): string | null {
  const input = form.querySelector('input[type="file"]') as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file || file.size === 0) return "file_required";
  if (file.size > MAX_BYTES) return "file_too_large";
  return null;
}

// ------------------------------------------------------------ Actions required
export function ActionsRequired({ fileId, selfService }: { fileId: string; selfService: SelfServiceActions }) {
  const s = t.portal.premium.selfService;
  const { rejected, missingRequired, hasUnpaidInvoice, uploadableTypes } = selfService;
  const hasAny = rejected.length > 0 || missingRequired.length > 0 || hasUnpaidInvoice;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
        <span aria-hidden>✅</span> {s.title}
      </h2>

      {!hasAny ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-800">{s.none}</div>
      ) : (
        <div className="space-y-3">
          {rejected.map((r) => (
            <ReplaceRow key={r.docId} docId={r.docId} label={r.label} reason={r.reason} />
          ))}
          {missingRequired.map((m) => (
            <UploadRow key={m.code} fileId={fileId} typeCode={m.code} label={m.label} />
          ))}
          {hasUnpaidInvoice && <PaymentProofRow fileId={fileId} />}
        </div>
      )}

      {uploadableTypes.length > 0 && <AddDocument fileId={fileId} types={uploadableTypes} />}
    </section>
  );
}

// One rejected document → replace (keeps the old version server-side).
function ReplaceRow({ docId, label, reason }: { docId: string; label: string; reason: string | null }) {
  const s = t.portal.premium.selfService;
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = formRef.current!;
    const bad = precheck(form);
    if (bad) return setMsg({ ok: false, text: errorText(bad) });
    setMsg(null);
    start(async () => {
      const res: Result = await replacePortalDocument(docId, new FormData(form));
      if (res.ok) {
        setMsg({ ok: true, text: s.success });
        form.reset();
        router.refresh();
      } else setMsg({ ok: false, text: errorText(res.error) });
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-navy-900">{label}</span>
        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">{s.toReplace}</span>
      </div>
      <p className="mb-3 text-xs text-rose-700">
        <span className="font-medium">{s.rejectionReason} : </span>
        {reason?.trim() || s.noReason}
      </p>
      <FileField id={`replace-${docId}`} />
      <div className="mt-2 flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">
          {pending ? s.uploading : s.replace}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

// One missing required document → upload (fixed type).
function UploadRow({ fileId, typeCode, label }: { fileId: string; typeCode: string; label: string }) {
  const s = t.portal.premium.selfService;
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = formRef.current!;
    const bad = precheck(form);
    if (bad) return setMsg({ ok: false, text: errorText(bad) });
    setMsg(null);
    start(async () => {
      const res: Result = await uploadPortalDocument(fileId, new FormData(form));
      if (res.ok) {
        setMsg({ ok: true, text: s.success });
        form.reset();
        router.refresh();
      } else setMsg({ ok: false, text: errorText(res.error) });
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <input type="hidden" name="typeCode" value={typeCode} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-navy-900">{label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{s.toProvide}</span>
      </div>
      <FileField id={`upload-${typeCode}`} />
      <div className="mt-2 flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50">
          {pending ? s.uploading : s.upload}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

// Payment proof → a PENDING_REVIEW document, never a balance change.
function PaymentProofRow({ fileId }: { fileId: string }) {
  const s = t.portal.premium.selfService;
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = formRef.current!;
    const bad = precheck(form);
    if (bad) return setMsg({ ok: false, text: errorText(bad) });
    setMsg(null);
    start(async () => {
      const res: Result = await uploadPortalPaymentProof(fileId, new FormData(form));
      if (res.ok) {
        setMsg({ ok: true, text: s.proofSuccess });
        form.reset();
        router.refresh();
      } else setMsg({ ok: false, text: errorText(res.error) });
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden>💳</span>
        <span className="text-sm font-medium text-navy-900">{s.paymentTitle}</span>
      </div>
      <p className="mb-3 text-xs text-indigo-800">{s.paymentPrompt}</p>
      <input
        name="invoiceRef"
        type="text"
        placeholder={s.invoiceRef}
        maxLength={120}
        className="mb-2 block w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-navy-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none"
      />
      <FileField id={`proof-${fileId}`} />
      <div className="mt-2 flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {pending ? s.uploading : s.submitProof}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

// -------------------------------------------------------------- Add a document
export function AddDocument({ fileId, types }: { fileId: string; types: { code: string; label: string }[] }) {
  const s = t.portal.premium.selfService;
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = formRef.current!;
    const bad = precheck(form);
    if (bad) return setMsg({ ok: false, text: errorText(bad) });
    setMsg(null);
    start(async () => {
      const res: Result = await uploadPortalDocument(fileId, new FormData(form));
      if (res.ok) {
        setMsg({ ok: true, text: s.success });
        form.reset();
        router.refresh();
      } else setMsg({ ok: false, text: errorText(res.error) });
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-3 text-sm font-medium text-navy-700 transition hover:border-teal-300 hover:bg-teal-50"
      >
        <span aria-hidden>＋</span> {s.addTitle}
      </button>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="mb-2 text-sm font-semibold text-navy-900">{s.addTitle}</p>
      <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`add-type-${fileId}`}>{s.selectType}</label>
      <select
        id={`add-type-${fileId}`}
        name="typeCode"
        required
        defaultValue=""
        className="mb-2 block w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-navy-900 focus:border-teal-300 focus:outline-none"
      >
        <option value="" disabled>{s.selectType}…</option>
        {types.map((ty) => (
          <option key={ty.code} value={ty.code}>{ty.label}</option>
        ))}
      </select>
      <FileField id={`add-file-${fileId}`} />
      <div className="mt-2 flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50">
          {pending ? s.uploading : s.upload}
        </button>
        <button type="button" onClick={() => { setOpen(false); setMsg(null); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          {s.cancel}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

// -------------------------------------------------------------- Request update
export function RequestUpdateButton({ fileId }: { fileId: string }) {
  const s = t.portal.premium.requestUpdate;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function request() {
    setMsg(null);
    start(async () => {
      const res: Result = await requestPortalUpdate(fileId);
      if (res.ok) setMsg({ ok: true, text: s.success });
      else setMsg({ ok: false, text: res.error === "rate_limited" ? s.rateLimited : errorText(res.error) });
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <button
        onClick={request}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        <span aria-hidden>🔄</span> {pending ? s.requesting : s.button}
      </button>
      <p className="mt-2 text-[11px] text-slate-400">{s.hint}</p>
      {msg && <p className={`mt-1 text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</p>}
    </div>
  );
}

// --------------------------------------------------------------- Contact card
export function ContactCard({ fileId }: { fileId: string }) {
  const s = t.portal.premium.contact;
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = formRef.current!;
    setMsg(null);
    start(async () => {
      const res: Result = await contactEffitrans(fileId, new FormData(form));
      if (res.ok) {
        setMsg({ ok: true, text: s.success });
        form.reset();
      } else setMsg({ ok: false, text: (s.errors as Record<string, string>)[res.error] ?? s.errors.generic });
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-navy-900"><span aria-hidden>✉️</span> {s.title}</p>
      <p className="mb-3 text-xs text-slate-500">{s.intro}</p>
      <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`contact-dep-${fileId}`}>{s.department}</label>
      <select
        id={`contact-dep-${fileId}`}
        name="department"
        defaultValue="general"
        className="mb-2 block w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-navy-900 focus:border-teal-300 focus:outline-none"
      >
        {CONTACT_DEPARTMENTS.map((dep) => (
          <option key={dep} value={dep}>{(s.departments as Record<string, string>)[dep]}</option>
        ))}
      </select>
      <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`contact-msg-${fileId}`}>{s.message}</label>
      <textarea
        id={`contact-msg-${fileId}`}
        name="message"
        rows={3}
        required
        maxLength={2000}
        className="mb-2 block w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-navy-900 placeholder:text-slate-400 focus:border-teal-300 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50">
          {pending ? s.sending : s.send}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
