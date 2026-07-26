"use client";

/**
 * Dispatcher driver assignment (Phase 3.4C; ungated in WES-1E). Client component.
 * ---------------------------------------------------------------------------
 * Assign / change / unassign the DRIVER app_user for a transport (sets
 * driver_user_id — the link the chauffeur portal and tracking RLS key on). Only
 * ACTIVE same-tenant DRIVER users are selectable; the server re-validates.
 *
 * WES-1E: rendered on `transport:assign` ALONE. It used to sit behind
 * TRACKING_ENABLED, so with GPS off a planner could type a driver's name into
 * the transport form, see no error, and leave the chauffeur with no mission.
 * Identity assignment is not a tracking feature; GPS remains flag-gated.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { assignDriverUser, unassignDriverUser } from "@/lib/transport/driver-actions";
import type { AssignableDriver } from "@/lib/transport/drivers";
import type { ActionResult } from "@/lib/transport/types";

export function DriverAssign({
  transportId,
  currentDriverUserId,
  displayDriverName,
  drivers,
  canAssign,
}: {
  transportId: string;
  currentDriverUserId: string | null;
  /** Free-text name from the transport form — display only, never the link. */
  displayDriverName?: string | null;
  drivers: AssignableDriver[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const da = t.transport.driverAssign;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(currentDriverUserId ?? "");

  const current = drivers.find((dr) => dr.id === currentDriverUserId) ?? null;

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = da.errors as Record<string, string>;
        setError(map[res.error] ?? da.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-navy-900">{da.title}</h2>
      <div className="surface space-y-3 p-4">
        <p className="text-xs text-slate-500">
          {da.current} : <span className="font-medium text-navy-800">{current ? current.email : da.none}</span>
        </p>

        {/* WES-1E — a free-text name is NOT an authenticated assignment. Say so
            plainly rather than letting the transport form look like it worked. */}
        {!currentDriverUserId && (displayDriverName ?? "").trim() !== "" && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
            {da.unauthenticated.replace("{name}", displayDriverName!.trim())}
          </p>
        )}

        {canAssign && (
          <>
            {drivers.length === 0 ? (
              <p className="text-xs text-slate-500">{da.noDrivers}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  <option value="">{da.select}</option>
                  {drivers.map((dr) => (
                    <option key={dr.id} value={dr.id}>
                      {dr.email}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => selected && run(() => assignDriverUser(transportId, selected))}
                  disabled={pending || !selected || selected === currentDriverUserId}
                  className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
                >
                  {da.assign}
                </button>
                {currentDriverUserId && (
                  <button
                    onClick={() => run(() => unassignDriverUser(transportId))}
                    disabled={pending}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {da.unassign}
                  </button>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-400">{da.hint}</p>
          </>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
