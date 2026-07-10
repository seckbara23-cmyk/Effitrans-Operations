"use client";

/**
 * Staff-side portal user management on the client detail page (Phase 1.12A;
 * 3.2B temporary-password onboarding). Create a portal account with an
 * admin-shared temporary password (shown once), reset it, activate/deactivate,
 * set role, and optionally resend email instructions. Invokes server-action
 * proxies only — the temporary password never leaves the one-time dialog.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import {
  createPortalAccess,
  resetPortalTempPassword,
  resendPortalInvite,
  setPortalUserRole,
  setPortalUserStatus,
} from "@/lib/portal/admin-actions";
import { PORTAL_ROLES } from "@/lib/portal/access";
import { PortalCredentialsDialog } from "@/components/portal/portal-credentials-dialog";
import type { ActionResult, PortalUserAdmin } from "@/lib/portal/types";

const STATUS_STYLE: Record<string, string> = {
  INVITED: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-teal-50 text-teal-700",
  DISABLED: "bg-slate-100 text-slate-400",
};

function whenText(iso: string | null, never: string): string {
  return iso ? new Date(iso).toLocaleString("fr-FR") : never;
}

export function PortalUsersPanel({
  clientId,
  users,
}: {
  clientId: string;
  users: PortalUserAdmin[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const a = t.portal.admin;

  function run(fn: () => Promise<ActionResult>, resetForm?: HTMLFormElement) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = a.errors as Record<string, string>;
        setError(map[res.error] ?? a.errors.generic);
        return;
      }
      if (res.tempPassword && res.email) setCreds({ email: res.email, password: res.tempPassword });
      if (res.inviteLink) setLink(res.inviteLink);
      resetForm?.reset();
      router.refresh();
    });
  }

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    run(
      () =>
        createPortalAccess(clientId, {
          email: String(fd.get("email") ?? ""),
          name: String(fd.get("name") ?? ""),
          role: String(fd.get("role") ?? "CLIENT_USER"),
          sendEmail: fd.get("sendEmail") === "on",
        }),
      form,
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-navy-900">{a.title}</h2>

      {link && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs">
          <p className="font-semibold text-teal-800">{a.linkLabel}</p>
          <p className="mt-1 break-all font-mono text-teal-700">{link}</p>
        </div>
      )}

      {/* Create portal access with a temporary password */}
      <form onSubmit={onCreate} className="surface space-y-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a.createTitle}</p>
        <div className="flex flex-wrap items-end gap-2">
          <input name="name" placeholder={a.inviteName} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <input name="email" type="email" required placeholder={a.inviteEmail} className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <select name="role" className="rounded-md border border-slate-200 px-2 py-1 text-sm">
            {PORTAL_ROLES.map((r) => (
              <option key={r} value={r}>{a.roles[r]}</option>
            ))}
          </select>
          <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {a.create}
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="sendEmail" className="rounded border-slate-300" />
          {a.sendByEmail}
        </label>
      </form>

      {users.length === 0 ? (
        <div className="surface p-4 text-sm text-slate-500">{a.empty}</div>
      ) : (
        <div className="surface divide-y divide-slate-100">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-navy-900">{u.name || u.email}</p>
                <p className="text-xs text-slate-500">{u.email}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {a.lastLogin}: {whenText(u.lastLoginAt, a.never)}
                  {u.lastLoginMethod ? ` · ${u.lastLoginMethod}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[u.status]}`}>
                  {a.statuses[u.status]}
                </span>
                {u.mustChangePassword && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {a.mustChangeBadge}
                  </span>
                )}
              </div>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <select
                  value={u.role}
                  disabled={pending}
                  onChange={(e) => run(() => setPortalUserRole(u.id, e.target.value))}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                >
                  {PORTAL_ROLES.map((r) => (
                    <option key={r} value={r}>{a.roles[r]}</option>
                  ))}
                </select>
                {u.status !== "DISABLED" && (
                  <button onClick={() => run(() => resetPortalTempPassword(u.id))} disabled={pending} className="rounded-md border border-navy-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">
                    {a.generatePassword}
                  </button>
                )}
                {u.status !== "ACTIVE" && (
                  <button onClick={() => run(() => setPortalUserStatus(u.id, "ACTIVE"))} disabled={pending} className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50">
                    {a.activate}
                  </button>
                )}
                {u.status !== "DISABLED" && (
                  <button onClick={() => run(() => setPortalUserStatus(u.id, "DISABLED"))} disabled={pending} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    {a.deactivate}
                  </button>
                )}
                <button onClick={() => run(() => resendPortalInvite(u.id))} disabled={pending} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">
                  {a.resend}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {creds && (
        <PortalCredentialsDialog email={creds.email} password={creds.password} onClose={() => setCreds(null)} />
      )}
    </section>
  );
}
