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
} from "@/lib/users/actions";
import type { AdminUser, AssignableRole, ActionResult } from "@/lib/users/types";

function errorMessage(code: string): string {
  const map = t.users.errors as Record<string, string>;
  return map[code] ?? t.users.errors.generic;
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

  // create form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      onOk?.();
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
                () => createUser({ email, name, password, roleIds: newRoleIds }),
                () => {
                  setEmail("");
                  setName("");
                  setPassword("");
                  setNewRoleIds([]);
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
      </div>

      {/* Directory */}
      <div className="surface overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">{t.users.columns.user}</th>
              <th className="px-4 py-3 font-semibold">{t.users.columns.roles}</th>
              <th className="px-4 py-3 font-semibold">{t.users.columns.status}</th>
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
              />
            ))}
          </tbody>
        </table>
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
}: {
  user: AdminUser;
  roles: AssignableRole[];
  canManageRoles: boolean;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
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
        <button
          disabled={pending}
          onClick={() =>
            run(() => setUserStatus(user.id, user.status === "active" ? "inactive" : "active"))
          }
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {user.status === "active" ? t.users.actions.disable : t.users.actions.enable}
        </button>
      </td>
    </tr>
  );
}
