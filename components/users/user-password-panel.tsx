"use client";

/**
 * Password Management — the user details page's dedicated section.
 * ---------------------------------------------------------------------------
 * Shows what is known about the user's password and offers the three
 * administrative levers, each behind its OWN permission (the server enforces;
 * this only avoids rendering a control the server would refuse):
 *
 *   reset email      admin:users:reset_password
 *   temp password    admin:users:temp_password
 *   unlock           admin:users:unlock
 *
 * ===========================================================================
 * THE SECRET IS SHOWN ONCE, AND ONCE MEANS ONCE
 * ===========================================================================
 * The generated password lives in React state and nowhere else — not in the
 * URL, not in localStorage, not in a cookie, not in a log, not in the audit
 * payload, and not on the server after the action returns. Closing the dialog
 * or refreshing loses it permanently, and that is the designed behaviour: if it
 * is lost, the administrator generates another one, which is an audited event
 * with a stated reason. That cost is the point.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import {
  generateStaffTempPassword,
  sendStaffPasswordReset,
  unlockStaffAccount,
  type TempPasswordResult,
} from "@/lib/users/password-actions";
import {
  TEMP_PASSWORD_REASONS,
  TEMP_PASSWORD_REASON_LABEL_FR,
  TEMP_PASSWORD_NOTE_MAX,
  PASSWORD_STATUS_LABEL_FR,
  type TempPasswordReason,
  type PasswordStatus,
} from "@/lib/users/password-lifecycle";

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
}

const STATUS_STYLE: Record<PasswordStatus, string> = {
  unknown: "bg-slate-100 text-slate-600",
  set: "bg-teal-50 text-teal-700",
  temporary: "bg-amber-50 text-amber-800",
  expired: "bg-red-50 text-red-700",
};

export type PasswordPanelUser = {
  id: string;
  email: string;
  name: string | null;
  archived: boolean;
  passwordChangedAt: string | null;
  tempPasswordExpiresAt: string | null;
  passwordStatus: PasswordStatus;
};

export function UserPasswordPanel({
  user,
  canResetPassword,
  canGenerateTempPassword,
  canUnlock,
  isSelf,
}: {
  user: PasswordPanelUser;
  canResetPassword: boolean;
  canGenerateTempPassword: boolean;
  canUnlock: boolean;
  /** An administrator may not issue themselves a temporary password — see the action. */
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<TempPasswordReason>("FORGOT_PASSWORD");
  const [note, setNote] = useState("");
  const [issued, setIssued] = useState<(TempPasswordResult & { ok: true }) | null>(null);
  const [copied, setCopied] = useState(false);

  const c = t.users.password;
  const errors = t.users.errors as Record<string, string>;
  const changed = fmt(user.passwordChangedAt);
  const expires = fmt(user.tempPasswordExpiresAt);
  const showExpiry =
    (user.passwordStatus === "temporary" || user.passwordStatus === "expired") && expires !== null;

  function onGenerate() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await generateStaffTempPassword(user.id, { reason, note });
      if (!res.ok) {
        setError(errors[res.error] ?? errors.generic);
        return;
      }
      setConfirming(false);
      setNote("");
      setIssued(res);
      router.refresh();
    });
  }

  function onReset() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await sendStaffPasswordReset(user.id);
      if (!res.ok) {
        setError(errors[res.error] ?? errors.generic);
        return;
      }
      // Honest: if no mail provider is configured the action returns the link
      // instead of claiming a send. Show whichever actually happened.
      setNotice(res.setupLink ? `${t.users.welcome.link_returned} ${res.setupLink}` : c.sendResetDone);
      router.refresh();
    });
  }

  function onUnlock() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await unlockStaffAccount(user.id);
      if (!res.ok) {
        setError(errors[res.error] ?? errors.generic);
        return;
      }
      setNotice(c.unlockDone);
      router.refresh();
    });
  }

  return (
    <section className="surface p-5">
      <h2 className="text-sm font-semibold text-navy-900">{c.title}</h2>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{c.lastChange}</dt>
          <dd className="mt-1 text-sm text-navy-900">
            {/* NOT backfilled at migration time: the platform genuinely does not
                know when a pre-existing user last changed their password. */}
            {changed ?? <span className="text-slate-400">{c.lastChangeUnknown}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{c.statusLabel}</dt>
          <dd className="mt-1">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[user.passwordStatus]}`}
            >
              {PASSWORD_STATUS_LABEL_FR[user.passwordStatus]}
            </span>
            {showExpiry && (
              <div className="mt-1 text-xs text-slate-500">
                {c.expiresAt} {expires}
              </div>
            )}
          </dd>
        </div>
      </dl>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 break-all rounded-lg bg-teal-50 p-3 text-sm text-teal-800" role="status">
          {notice}
        </p>
      )}

      {!user.archived && (
        <div className="mt-5 flex flex-wrap gap-2">
          {canResetPassword && (
            <button
              type="button"
              disabled={pending}
              onClick={onReset}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {c.sendReset}
            </button>
          )}
          {canGenerateTempPassword && !isSelf && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirming(true);
                setError(null);
              }}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {c.generate}
            </button>
          )}
          {canUnlock && (
            <button
              type="button"
              disabled={pending}
              onClick={onUnlock}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {c.unlock}
            </button>
          )}
        </div>
      )}

      {/* --- Confirmation: says exactly what will happen, and asks WHY -------- */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="temp-pw-confirm-title"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <p id="temp-pw-confirm-title" className="text-sm font-semibold text-amber-900">
            {c.confirmTitle}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
            {c.confirmBody.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="mt-3">
            <label htmlFor="temp-pw-reason" className="block text-xs font-medium text-amber-900">
              {c.confirmReason}
            </label>
            <select
              id="temp-pw-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as TempPasswordReason)}
              className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-navy-900"
            >
              {TEMP_PASSWORD_REASONS.map((r) => (
                <option key={r} value={r}>
                  {TEMP_PASSWORD_REASON_LABEL_FR[r]}
                </option>
              ))}
            </select>
          </div>

          {/* « Autre » alone records that a reset happened for an unstated reason,
              which reads like an answer but is not one. The note is required. */}
          <div className="mt-3">
            <label htmlFor="temp-pw-note" className="block text-xs font-medium text-amber-900">
              {c.confirmNote}
              {reason === "OTHER" ? " *" : ""}
            </label>
            <input
              id="temp-pw-note"
              type="text"
              maxLength={TEMP_PASSWORD_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={c.confirmNotePlaceholder}
              className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-navy-900"
            />
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {c.cancel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onGenerate}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {c.confirm}
            </button>
          </div>
        </div>
      )}

      {/* --- The one-time reveal --------------------------------------------- */}
      {issued && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="temp-pw-result-title"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <p id="temp-pw-result-title" className="text-sm font-semibold text-amber-900">
            {c.resultTitle}
          </p>

          <div className="mt-2 text-xs text-amber-900">
            <span className="font-medium">{c.resultUser} :</span> {issued.name || issued.email} · {issued.email}
          </div>

          <div className="mt-2">
            <div className="text-xs font-medium text-amber-900">{c.resultPassword}</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 rounded bg-white px-2 py-1.5 font-mono text-sm text-navy-900">
                {issued.temporaryPassword}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(issued.temporaryPassword);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
              >
                {copied ? c.copied : c.copy}
              </button>
            </div>
          </div>

          <div className="mt-2 text-xs text-amber-900">
            <span className="font-medium">{c.resultExpires} :</span> {fmt(issued.expiresAt)} ({issued.ttlHours} h)
          </div>
          <div className="mt-1 text-xs text-amber-900">✓ {c.resultForceChange}</div>

          <p className="mt-3 text-[11px] text-amber-800">{c.resultWarning}</p>

          <button
            type="button"
            onClick={() => setIssued(null)}
            className="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            {c.close}
          </button>
        </div>
      )}
    </section>
  );
}
