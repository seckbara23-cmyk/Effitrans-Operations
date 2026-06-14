"use client";

/**
 * Client create/edit form (Phase 1.1). Client component.
 * ---------------------------------------------------------------------------
 * Imports NO server-only code — invokes the server-action proxies only. All
 * authority (permission, tenant, audit) lives server-side in the actions.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { createClient, updateClient, archiveClient, restoreClient } from "@/lib/clients/actions";
import type { ActionResult, ClientContactInput, ClientDetail } from "@/lib/clients/types";

function errorMessage(code: string): string {
  const map = t.clients.errors as Record<string, string>;
  return map[code] ?? t.clients.errors.generic;
}

const input =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20";

export function ClientForm({
  mode,
  clientId,
  initial,
  canUpdate = true,
  canDelete = false,
}: {
  mode: "create" | "edit";
  clientId?: string;
  initial?: ClientDetail;
  canUpdate?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [ninea, setNinea] = useState(initial?.ninea ?? "");
  const [segment, setSegment] = useState(initial?.segment ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [contacts, setContacts] = useState<ClientContactInput[]>(
    initial?.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      isPrimary: c.isPrimary,
    })) ?? [],
  );

  const editable = mode === "create" || canUpdate;

  function run(fn: () => Promise<ActionResult>, onOk?: (r: ActionResult & { ok: true }) => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      onOk?.(res);
    });
  }

  function save() {
    const payload = {
      name,
      ninea,
      segment,
      email,
      phone,
      address,
      contacts,
    };
    if (mode === "create") {
      run(() => createClient(payload), (r) => router.push(r.id ? `/clients/${r.id}` : "/clients"));
    } else if (clientId) {
      run(() => updateClient(clientId, payload), () => router.refresh());
    }
  }

  function updateContact(i: number, patch: Partial<ClientContactInput>) {
    setContacts((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="surface border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="surface space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.clients.form.name}>
            <input className={input} value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t.clients.form.ninea}>
            <input className={input} value={ninea} disabled={!editable} onChange={(e) => setNinea(e.target.value)} />
          </Field>
          <Field label={t.clients.form.segment}>
            <input className={input} value={segment} disabled={!editable} onChange={(e) => setSegment(e.target.value)} />
          </Field>
          <Field label={t.clients.form.email}>
            <input className={input} type="email" value={email} disabled={!editable} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t.clients.form.phone}>
            <input className={input} value={phone} disabled={!editable} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t.clients.form.address}>
            <input className={input} value={address} disabled={!editable} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>

        {/* Contacts */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-navy-900">{t.clients.form.contacts}</p>
            {editable && (
              <button
                type="button"
                onClick={() => setContacts((cs) => [...cs, { name: "", role: "", email: "", phone: "", isPrimary: cs.length === 0 }])}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50"
              >
                {t.clients.actions.addContact}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {contacts.length === 0 && <p className="text-xs text-slate-400">{t.common.none}</p>}
            {contacts.map((c, i) => (
              <div key={c.id ?? i} className="grid gap-2 sm:grid-cols-5">
                <input className={input} placeholder={t.clients.form.contactName} value={c.name} disabled={!editable} onChange={(e) => updateContact(i, { name: e.target.value })} />
                <input className={input} placeholder={t.clients.form.contactRole} value={c.role ?? ""} disabled={!editable} onChange={(e) => updateContact(i, { role: e.target.value })} />
                <input className={input} placeholder={t.clients.form.email} value={c.email ?? ""} disabled={!editable} onChange={(e) => updateContact(i, { email: e.target.value })} />
                <input className={input} placeholder={t.clients.form.phone} value={c.phone ?? ""} disabled={!editable} onChange={(e) => updateContact(i, { phone: e.target.value })} />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={Boolean(c.isPrimary)} disabled={!editable} onChange={(e) => updateContact(i, { isPrimary: e.target.checked })} />
                    {t.clients.form.primary}
                  </label>
                  {editable && (
                    <button type="button" onClick={() => setContacts((cs) => cs.filter((_, idx) => idx !== i))} className="text-xs text-slate-400 hover:text-red-600">
                      {t.clients.actions.removeContact}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {editable && (
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
            >
              {pending ? t.clients.actions.saving : mode === "create" ? t.clients.actions.create : t.clients.actions.save}
            </button>
          </div>
        )}
      </div>

      {/* Archive / restore (edit + delete permission) */}
      {mode === "edit" && clientId && canDelete && (
        <div className="surface flex items-center justify-between p-4">
          <span className="text-sm text-slate-600">
            {t.clients.columns.status}:{" "}
            <strong>{initial?.status === "archived" ? t.clients.status.archived : t.clients.status.active}</strong>
          </span>
          {initial?.status === "archived" ? (
            <button
              onClick={() => run(() => restoreClient(clientId), () => router.refresh())}
              disabled={pending}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t.clients.actions.restore}
            </button>
          ) : (
            <button
              onClick={() => run(() => archiveClient(clientId), () => router.refresh())}
              disabled={pending}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {t.clients.actions.archive}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-navy-700">{label}</span>
      {children}
    </label>
  );
}
