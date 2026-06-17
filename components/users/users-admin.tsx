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
  assignRole,
  revokeRole,
  sendWelcomeEmail,
} from "@/lib/users/actions";
import type { AdminUser, AssignableRole, ActionResult } from "@/lib/users/types";
import { loginMethodLabel, type Presence } from "@/lib/users/presence";

function errorMessage(code: string): string {
  const map = t.users.errors as Record<string, string>;
  return map[code] ?? t.users.errors.generic;
}

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

export function UsersAdmin({
  users,
  roles,
  canManageRoles,
}: {
  users: AdminUser[];
  roles: AssignableRole[];
  canManageRoles: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // create form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);
  const [sendWelcome, setSendWelcome] = useState(true);

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
          <input
            type="password"
            placeholder={t.users.form.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            disabled={pending}
            onClick={() =>
              run(
                () => createUser({ email, name, password, roleIds: newRoleIds, sendWelcome }),
                (res) => {
                  setEmail("");
                  setName("");
                  setPassword("");
                  setNewRoleIds([]);
                  if (res.welcome === "queued") setNotice(t.users.welcome.queued);
                  else if (res.welcome === "failed") setNotice(t.users.welcome.failed);
                },
              )
            }
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
          >
            {pending ? t.users.form.submitting : t.users.form.submit}
          </button>
        </div>
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
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={sendWelcome}
            onChange={(e) => setSendWelcome(e.target.checked)}
          />
          {t.users.form.sendWelcome}
        </label>
      </div>

      {/* Directory */}
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
  const assignedIds = new Set(user.roles.map((r) => r.roleId));
  const available = roles.filter((r) => !assignedIds.has(r.id));

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
              {canManageRoles && (
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
        {canManageRoles && available.length > 0 && (
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
              : "inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
          }
        >
          {user.status === "active" ? t.users.status.active : t.users.status.inactive}
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
            onClick={() =>
              run(
                () => sendWelcomeEmail(user.id),
                (res) => {
                  if (res.welcome === "queued") notify(t.users.welcome.queued);
                },
              )
            }
            title={t.users.actions.resendWelcome}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {t.users.actions.resendWelcome}
          </button>
        </div>
      </td>
    </tr>
  );
}
