"use client";

import { useState, useTransition } from "react";
import { setMailboxActive } from "@/lib/ec/mailboxes/actions";
import { cn } from "@/lib/cn";

/**
 * EMP-1 — the single mailbox control: active or not.
 *
 * Deactivation is the reversible retirement EC-1's design implies — an address
 * is never deleted, because deleting one would orphan the captures that
 * reference it, and those are evidence.
 *
 * The consequence of deactivating is stated on the button's own confirmation
 * rather than left to be discovered: mail to an inactive mailbox is not
 * refused at the door, it is QUARANTINED, which means tenant-less and
 * invisible to everyone here.
 */
export function MailboxToggle({
  mailboxId,
  address,
  isActive,
}: {
  mailboxId: string;
  address: string;
  isActive: boolean;
}) {
  const [active, setActive] = useState(isActive);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const apply = (next: boolean) => {
    setError(null);
    setConfirming(false);
    start(async () => {
      const res = await setMailboxActive(mailboxId, next);
      if (res.ok) setActive(next);
      else setError(res.error === "forbidden" ? "Autorisation insuffisante." : "Modification impossible.");
    });
  };

  if (confirming) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs text-amber-900">
          Désactiver <strong>{address}</strong> ? Les messages reçus ensuite seront mis en
          quarantaine : ils n&apos;appartiendront à aucun tenant et ne seront visibles ni ici ni
          dans le tri.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => apply(false)}
            disabled={pending}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Désactiver
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => (active ? setConfirming(true) : apply(true))}
        disabled={pending}
        aria-pressed={active}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
          active
            ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
            : "bg-teal-600 text-white hover:bg-teal-700",
        )}
      >
        {pending ? "…" : active ? "Désactiver" : "Activer"}
      </button>
      {error ? (
        <p className="text-[11px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
