"use client";

/**
 * User-management admin UI (Task 6a). Client component.
 * ---------------------------------------------------------------------------
 * Renders the directory + forms and invokes the server actions (proxies). It
 * imports NO server-only code (no admin client, no service role). All authority
 * lives server-side in the actions (permission-gated + audited).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import {
  createUser,
  setUserStatus,
  archiveUser,
  restoreUser,
  assignRole,
  revokeRole,
  sendWelcomeEmail,
} from "@/lib/users/actions";
import type { AdminUser, AssignableRole, ActionResult, CredentialMode, WelcomeOutcome } from "@/lib/users/types";
import { loginMethodLabel, type Presence } from "@/lib/users/presence";

function errorMessage(code: string): string {
  const map = t.users.errors as Record<string, string>;
  return map[code] ?? t.users.errors.generic;
}

/** Honest French message for each welcome outcome — never claims a send that did not happen. */
function welcomeNotice(outcome: WelcomeOutcome | undefined): string | null {
  if (!outcome || outcome === "skipped") return null;
  const map = t.users.welcome as Record<string, string>;
  return map[outcome] ?? null;
}

/** The one-time credential result — held ONLY in React state, never persisted. */
type CredentialResult = {
  email: string;
  name: string;
  temporaryPassword?: string;
  setupLink?: string;
};

const PRESENCE_STYLE: Record<Presence, string> = {
  online: "bg-emerald-50 text-emerald-700",
  recently_active: "bg-amber-50 text-amber-700",
  offline: "bg-slate-100 text-slate-500",
  never: "bg-slate-100 text-slate-400",
};
const PRESENCE_DOT: Record<Presence, string> = {
  online: "🟢",
  recently_active: "🟡",
  offline: "⚪",
  never: "○",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return t.users.presence.none;
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function PresenceBadge({ presence }: { presence: Presence }) {
  const p = t.users.presence;
  const label =
    presence === "online" ? p.online : presence === "recently_active" ? p.recently_active : presence === "never" ? p.never : p.offline;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${PRESENCE_STYLE[presence]}`}>
      <span aria-hidden>{PRESENCE_DOT[presence]}</span>
      {label}
    </span>
  );
}

/**
 * One-time credential result (Phase 5.0E-4). The generated temporary password (or the
 * returned setup link) is shown ONCE, here, from React state only. It is never in the
 * URL, storage, a cookie, a log or an audit payload; dismissing or refreshing loses it.
 */
function CredentialPanel({ result, onDismiss }: { result: CredentialResult; onDismiss: () => void }) {
  const [copied, setCopied] = useState<"pw" | "link" | null>(null);
  const c = t.users.credential;
  const copy = (value: string, which: "pw" | "link") => {
    void navigator.clipboard?.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4" role="status">
      {result.temporaryPassword && (
        <>
          <p className="text-sm font-semibold text-amber-900">{c.title}</p>
          <p className="mt-1 text-xs text-amber-800">
            {result.name || result.email} · {result.email}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-2 py-1.5 font-mono text-sm text-navy-900">
              {result.temporaryPassword}
            </code>
            <button
              type="button"
              onClick={() => copy(result.temporaryPassword!, "pw")}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
            >
              {copied === "pw" ? c.copied : c.copy}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-amber-800">{c.warning}</p>
        </>
      )}

      {result.setupLink && (
        <div className={result.temporaryPassword ? "mt-4 border-t border-amber-200 pt-3" : ""}>
          <p className="text-sm font-semibold text-amber-900">{c.linkTitle}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white px-2 py-1.5 text-xs text-navy-900">
              {result.setupLink}
            </code>
            <button
              type="button"
              onClick={() => copy(result.setupLink!, "link")}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
            >
              {copied === "link" ? c.copied : c.copy}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-amber-800">{c.linkWarning}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
      >
        {c.done}
      </button>
    </div>
  );
}

export function UsersAdmin({
  users,
  roles,
  canManageRoles,
  showArchived = false,
}: {
  users: AdminUser[];
  roles: AssignableRole[];
  canManageRoles: boolean;
  /** 8.1A — whether the page was queried WITH archived users (?archived=1). */
  showArchived?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // create form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [credentialMode, setCredentialMode] = useState<CredentialMode>("setup_email");
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);
  const [sendWelcome, setSendWelcome] = useState(true);
  // The one-time credential result (generated password / returned setup link). Lives
  // ONLY here in memory; dismissing or refreshing loses it, by design.
  const [credential, setCredential] = useState<CredentialResult | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: (res: ActionResult & { ok: true }) => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      onOk?.(res);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="surface border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="surface border-teal-200 bg-teal-50 p-3 text-sm text-teal-800" role="status">
          {notice}
        </div>
      )}

      {/* Create user */}
      <div className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">{t.users.actions.create}</h2>
        <p className="mt-1 text-xs text-slate-500">{t.users.note}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="email"
            placeholder={t.users.form.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder={t.users.form.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          {/* The password field appears ONLY in manual mode — no always-required field. */}
          {credentialMode === "manual" ? (
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder={t.users.form.password}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-14 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-navy-700"
                aria-label={showPassword ? "Masquer" : "Afficher"}
              >
                {showPassword ? "Masquer" : "Afficher"}
              </button>
            </div>
          ) : (
            <div className="hidden sm:block" aria-hidden />
          )}
          <button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  createUser({
                    email,
                    name,
                    credentialMode,
                    ...(credentialMode === "manual" ? { password } : {}),
                    roleIds: newRoleIds,
                    sendWelcome,
                  }),
                (res) => {
                  setEmail("");
                  setName("");
                  setPassword("");
                  setNewRoleIds([]);
                  // A one-time secret (generated password) or a returned link goes into a
                  // dedicated result panel; otherwise show the honest welcome notice.
                  if (res.temporaryPassword || res.setupLink) {
                    setCredential({ email, name, temporaryPassword: res.temporaryPassword, setupLink: res.setupLink });
                  } else {
                    setNotice(welcomeNotice(res.welcome));
                  }
                },
              )
            }
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
          >
            {pending ? t.users.form.submitting : t.users.form.submit}
          </button>
        </div>

        {/* Credential mode selector (5.0E-4). Secure setup email is the default. */}
        <fieldset className="mt-3">
          <legend className="text-xs font-medium text-slate-600">{t.users.form.credentialMode}</legend>
          <div className="mt-1.5 flex flex-wrap gap-4">
            {([
              ["setup_email", t.users.form.modeSetupEmail],
              ["generate", t.users.form.modeGenerate],
              ["manual", t.users.form.modeManual],
            ] as [CredentialMode, string][]).map(([mode, label]) => (
              <label key={mode} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="radio"
                  name="credentialMode"
                  checked={credentialMode === mode}
                  onChange={() => setCredentialMode(mode)}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{t.users.form.passwordHint}</p>
        </fieldset>

        {credential && (
          <CredentialPanel result={credential} onDismiss={() => setCredential(null)} />
        )}
        {roles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={newRoleIds.includes(r.id)}
                  onChange={(e) =>
                    setNewRoleIds((ids) =>
                      e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id),
                    )
                  }
                />
                {r.labelFr ?? r.code}
              </label>
            ))}
          </div>
        )}
        {/* In setup_email mode the secure link IS the mechanism (always sent); the
            opt-in checkbox only makes sense for the password modes. */}
        {credentialMode !== "setup_email" && (
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={sendWelcome}
              onChange={(e) => setSendWelcome(e.target.checked)}
            />
            {t.users.form.sendWelcome}
          </label>
        )}
      </div>

      {/* Directory. 8.1A — archived users are hidden by default and EXCLUDED AT QUERY LEVEL;
          this toggle re-renders the page with ?archived=1 (a new server query), never a client
          filter over pre-fetched rows. */}
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={showArchived}
          disabled={pending}
          onChange={(e) => router.push(e.target.checked ? "/users?archived=1" : "/users")}
        />
        {t.users.archive.showArchived}
      </label>

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">{t.users.columns.user}</th>
              <th className="px-4 py-3 font-semibold">{t.users.columns.roles}</th>
              <th className="px-4 py-3 font-semibold">{t.users.columns.status}</th>
              <th className="px-4 py-3 font-semibold">{t.users.presence.column}</th>
              <th className="px-4 py-3 font-semibold">{t.users.presence.connection}</th>
              <th className="px-4 py-3 font-semibold">{t.users.columns.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                roles={roles}
                canManageRoles={canManageRoles}
                pending={pending}
                run={run}
                notify={setNotice}
              />
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  roles,
  canManageRoles,
  pending,
  run,
  notify,
}: {
  user: AdminUser;
  roles: AssignableRole[];
  canManageRoles: boolean;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>, onOk?: (res: ActionResult & { ok: true }) => void) => void;
  notify: (msg: string) => void;
}) {
  const [roleToAdd, setRoleToAdd] = useState("");
  // 8.1A — the archive confirmation is armed per row and rendered inline (existing UI style).
  const [confirmArchive, setConfirmArchive] = useState(false);
  const assignedIds = new Set(user.roles.map((r) => r.roleId));
  const available = roles.filter((r) => !assignedIds.has(r.id));
  // An archived row is READ-ONLY except Restore: no role changes, no welcome, no suspend.
  const canEditRoles = canManageRoles && user.status !== "archived";

  return (
    <tr className="align-top hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="font-medium text-navy-900">{user.name ?? user.email}</div>
        <div className="text-xs text-slate-500">{user.email}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {user.roles.length === 0 && <span className="text-xs text-slate-400">{t.common.none}</span>}
          {user.roles.map((r) => (
            <span key={r.roleId} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-navy-800">
              {r.labelFr ?? r.code}
              {canEditRoles && (
                <button
                  title={t.users.actions.revoke}
                  onClick={() => run(() => revokeRole(user.id, r.roleId))}
                  className="text-slate-400 hover:text-red-600"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {canEditRoles && available.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <select
              value={roleToAdd}
              onChange={(e) => setRoleToAdd(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              <option value="">{t.users.actions.addRole}…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.labelFr ?? r.code}
                </option>
              ))}
            </select>
            <button
              disabled={pending || !roleToAdd}
              onClick={() => roleToAdd && run(() => assignRole(user.id, roleToAdd))}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t.users.actions.assign}
            </button>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span
          className={
            user.status === "active"
              ? "inline-block rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700"
              : user.status === "archived"
                ? "inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600"
                : "inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
          }
        >
          {t.users.status[user.status]}
        </span>
      </td>
      <td className="px-4 py-3">
        <PresenceBadge presence={user.presence} />
        {user.presence !== "never" && (
          <div className="mt-1 text-[11px] text-slate-400">
            {t.users.presence.lastSeen} {fmtDateTime(user.lastSeenAt)}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-600">
        <div className="tabular">{fmtDateTime(user.lastLoginAt)}</div>
        <div className="text-[11px] text-slate-400">
          {loginMethodLabel(user.lastLoginMethod)} · {user.loginCount} {t.users.presence.logins}
        </div>
        <div className="mt-0.5 text-[11px]">
          {user.onboardingEmailSentAt ? (
            <span className="text-teal-700">✓ {t.users.presence.onboardingSent}</span>
          ) : (
            <span className="text-slate-400">{t.users.presence.onboardingNot}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {/* 8.1A lifecycle actions. Archived: RESTORE only (no suspend, no welcome, no roles).
            There is deliberately NO delete action anywhere — operational users are never
            deleted; archive preserves all history. */}
        {user.status === "archived" ? (
          <button
            disabled={pending}
            onClick={() => run(() => restoreUser(user.id), () => notify(t.users.archive.restored))}
            className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            {t.users.actions.restore}
          </button>
        ) : confirmArchive ? (
          <div className="max-w-xs rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">{t.users.archive.confirmTitle}</p>
            <p className="mt-1">{t.users.archive.confirmIntro}</p>
            <ul className="mt-1 list-disc pl-4">
              {t.users.archive.confirmBody.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button
                disabled={pending}
                onClick={() => setConfirmArchive(false)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t.users.archive.cancel}
              </button>
              <button
                disabled={pending}
                onClick={() =>
                  run(
                    () => archiveUser(user.id),
                    () => {
                      setConfirmArchive(false);
                      notify(t.users.archive.archived);
                    },
                  )
                }
                className="rounded-md bg-navy-900 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                {t.users.archive.confirm}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              disabled={pending}
              onClick={() =>
                run(() => setUserStatus(user.id, user.status === "active" ? "inactive" : "active"))
              }
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {user.status === "active" ? t.users.actions.disable : t.users.actions.enable}
            </button>
            <button
              disabled={pending}
              onClick={() => setConfirmArchive(true)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {t.users.actions.archive}
            </button>
            <button
              disabled={pending}
              onClick={() =>
                run(
                  () => sendWelcomeEmail(user.id),
                  (res) => {
                    // link_returned hands back a one-time link; otherwise an honest notice.
                    if (res.setupLink) notify(`${t.users.welcome.link_returned} ${res.setupLink}`);
                    else notify(welcomeNotice(res.welcome) ?? t.users.welcome.resent);
                  },
                )
              }
              title={t.users.actions.resendWelcome}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t.users.actions.resendWelcome}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
