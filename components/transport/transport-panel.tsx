"use client";

/**
 * Transport panel embedded on a dossier (Phase 1.10). Client component — status
 * + workflow buttons, driver/vehicle assignment, manual metadata, POD + customs
 * gate warnings. Invokes server-action proxies only.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { nextStatuses } from "@/lib/transport/status";
import {
  assignTransport,
  changeTransportStatus,
  createTransport,
  deleteTransport,
  updateTransport,
} from "@/lib/transport/actions";
import type { ActionResult, TransportRecord } from "@/lib/transport/types";

const STATUS_STYLE: Record<string, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-600",
  PLANNED: "bg-sky-50 text-sky-700",
  DRIVER_ASSIGNED: "bg-sky-50 text-sky-700",
  PICKED_UP: "bg-amber-50 text-amber-700",
  IN_TRANSIT: "bg-amber-50 text-amber-700",
  DELIVERED: "bg-teal-50 text-teal-700",
  POD_RECEIVED: "bg-teal-50 text-teal-700",
  BLOCKED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

export function TransportPanel({
  fileId,
  record,
  podApproved,
  canCreate,
  canUpdate,
  canAssign,
  canComplete,
  canDelete,
}: {
  fileId: string;
  record: TransportRecord | null;
  podApproved: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canAssign: boolean;
  canComplete: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tr = t.transport;

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = tr.errors as Record<string, string>;
        setError(map[res.error] ?? tr.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  const header = <h2 className="text-sm font-semibold text-navy-900">{tr.panelTitle}</h2>;

  if (!record) {
    return (
      <section className="space-y-3">
        {header}
        <div className="surface flex items-center justify-between p-4 text-sm text-slate-500">
          <span>{tr.empty}</span>
          {canCreate && (
            <button
              onClick={() => run(() => createTransport(fileId))}
              disabled={pending}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {tr.start}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </section>
    );
  }

  const targets = nextStatuses(record.status);

  function onMeta(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      updateTransport(record!.id, {
        pickupLocation: String(fd.get("pickupLocation") ?? ""),
        deliveryLocation: String(fd.get("deliveryLocation") ?? ""),
        pickupPlanned: String(fd.get("pickupPlanned") ?? "") || null,
        deliveryPlanned: String(fd.get("deliveryPlanned") ?? "") || null,
        transportCompany: String(fd.get("transportCompany") ?? ""),
        deliveryReference: String(fd.get("deliveryReference") ?? ""),
        notes: String(fd.get("notes") ?? ""),
        customsOverride: fd.get("customsOverride") === "on",
      }),
    );
  }

  function onAssign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      assignTransport(record!.id, {
        driverName: String(fd.get("driverName") ?? ""),
        driverPhone: String(fd.get("driverPhone") ?? ""),
        vehiclePlate: String(fd.get("vehiclePlate") ?? ""),
        trailerOrContainer: String(fd.get("trailerOrContainer") ?? ""),
      }),
    );
  }

  const completeTargets = new Set(["DELIVERED", "POD_RECEIVED"]);

  return (
    <section className="space-y-3">
      {header}
      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[record.status]}`}>
            {tr.statuses[record.status]}
          </span>
          {record.customsOverride && <span className="text-xs text-amber-700">{tr.overrideOn}</span>}
          {record.driverName && (
            <span className="ml-auto text-xs text-slate-500">
              {record.driverName}
              {record.vehiclePlate ? ` · ${record.vehiclePlate}` : ""}
            </span>
          )}
        </div>

        {record.status === "DELIVERED" && !podApproved && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            {tr.podMissing}
          </div>
        )}

        {/* Workflow actions */}
        {targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {targets.map((s) => {
              const isComplete = completeTargets.has(s);
              const allowed = isComplete ? canComplete : canUpdate;
              if (!allowed) return null;
              const label =
                s === "BLOCKED" ? tr.statuses.BLOCKED : s === "CANCELLED" ? tr.statuses.CANCELLED : `→ ${tr.statuses[s]}`;
              return (
                <button
                  key={s}
                  onClick={() => run(() => changeTransportStatus(record.id, s))}
                  disabled={pending}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {label}
                </button>
              );
            })}
            {canDelete && (
              <button
                onClick={() => run(() => deleteTransport(record.id))}
                disabled={pending}
                className="ml-auto rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                {tr.statuses.CANCELLED}
              </button>
            )}
          </div>
        )}

        {/* Driver / vehicle assignment */}
        {canAssign && (
          <form onSubmit={onAssign} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={tr.fields.driverName} name="driverName" defaultValue={record.driverName} />
            <Field label={tr.fields.driverPhone} name="driverPhone" defaultValue={record.driverPhone} />
            <Field label={tr.fields.vehiclePlate} name="vehiclePlate" defaultValue={record.vehiclePlate} />
            <Field label={tr.fields.trailer} name="trailerOrContainer" defaultValue={record.trailerOrContainer} />
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {tr.assign}
              </button>
            </div>
          </form>
        )}

        {/* Manual metadata */}
        {canUpdate && (
          <form onSubmit={onMeta} className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <Field label={tr.fields.pickupLocation} name="pickupLocation" defaultValue={record.pickupLocation} />
            <Field label={tr.fields.deliveryLocation} name="deliveryLocation" defaultValue={record.deliveryLocation} />
            <Field label={tr.fields.pickupPlanned} name="pickupPlanned" type="datetime-local" defaultValue={toLocal(record.pickupPlanned)} />
            <Field label={tr.fields.deliveryPlanned} name="deliveryPlanned" type="datetime-local" defaultValue={toLocal(record.deliveryPlanned)} />
            <Field label={tr.fields.company} name="transportCompany" defaultValue={record.transportCompany} />
            <Field label={tr.fields.deliveryReference} name="deliveryReference" defaultValue={record.deliveryReference} />
            <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
              {tr.fields.notes}
              <textarea name="notes" defaultValue={record.notes ?? ""} rows={2} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
              <input type="checkbox" name="customsOverride" defaultChecked={record.customsOverride} />
              {tr.fields.customsOverride}
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
              >
                {pending ? tr.saving : tr.save}
              </button>
            </div>
          </form>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}

/** ISO timestamp -> value for <input type="datetime-local"> (yyyy-MM-ddThh:mm). */
function toLocal(iso: string | null): string {
  return iso ? iso.slice(0, 16) : "";
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string | null;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-md border border-slate-200 px-2 py-1 text-sm"
      />
    </label>
  );
}
