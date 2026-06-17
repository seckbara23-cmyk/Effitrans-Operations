"use client";

import { useState, useTransition } from "react";
import { t } from "@/lib/i18n";
import { updateNotificationPrefs } from "@/lib/customer-notify/actions";
import type { EmailPrefs } from "@/lib/customer-notify/events";

const KEYS: { key: keyof EmailPrefs; labelKey: "email" | "shipment" | "invoice" | "payment" }[] = [
  { key: "notify_email", labelKey: "email" },
  { key: "notify_shipment", labelKey: "shipment" },
  { key: "notify_invoice", labelKey: "invoice" },
  { key: "notify_payment", labelKey: "payment" },
];

export function NotificationPrefs({ initial }: { initial: EmailPrefs }) {
  const p = t.portal.notify.prefs;
  const [prefs, setPrefs] = useState<EmailPrefs>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof EmailPrefs) => {
    setSaved(false);
    setPrefs((x) => ({ ...x, [key]: !x[key] }));
  };
  const save = () =>
    start(async () => {
      await updateNotificationPrefs(prefs);
      setSaved(true);
    });

  return (
    <div className="surface space-y-3 p-5">
      <h2 className="text-sm font-semibold text-navy-900">{p.title}</h2>
      <div className="space-y-2">
        {KEYS.map(({ key, labelKey }) => (
          <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={prefs[key]} onChange={() => toggle(key)} />
            {p[labelKey]}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
        >
          {p.save}
        </button>
        {saved && <span className="text-sm text-teal-700">{p.saved}</span>}
      </div>
    </div>
  );
}
