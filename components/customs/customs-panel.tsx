"use client";

/**
 * Customs panel embedded on a dossier (Phase 1.9). Client component — status +
 * workflow buttons, editable manual-reference metadata, and the missing-docs
 * warning. Invokes server-action proxies only.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { nextStatuses } from "@/lib/customs/status";
import {
  changeCustomsStatus,
  createCustoms,
  deleteCustoms,
  releaseCustoms,
  updateCustoms,
} from "@/lib/customs/actions";
import type { ActionResult, CustomsRecord, MissingCustomsDoc } from "@/lib/customs/types";

const STATUS_STYLE: Record<string, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-600",
  DOCUMENTS_PENDING: "bg-slate-100 text-slate-600",
  DECLARATION_PREPARED: "bg-sky-50 text-sky-700",
  DECLARED: "bg-sky-50 text-sky-700",
  UNDER_REVIEW: "bg-amber-50 text-amber-700",
  INSPECTION: "bg-amber-50 text-amber-700",
  DUTIES_ASSESSED: "bg-amber-50 text-amber-700",
  RELEASED: "bg-teal-50 text-teal-700",
  BLOCKED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

const REGIMES = [
  "Mise à la consommation",
  "Exportation",
  "Transit",
  "Admission temporaire",
  "Entrepôt",
  "Réexportation",
];

export function CustomsPanel({
  fileId,
  record,
  missing,
  canCreate,
  canUpdate,
  canRelease,
  canDelete,
}: {
  fileId: string;
  record: CustomsRecord | null;
  missing: MissingCustomsDoc[];
  canCreate: boolean;
  canUpdate: boolean;
  canRelease: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const c = t.customs;

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = c.errors as Record<string, string>;
        setError(map[res.error] ?? c.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  const header = (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-navy-900">{c.panelTitle}</h2>
    </div>
  );

  if (!record) {
    return (
      <section className="space-y-3">
        {header}
        <div className="surface flex items-center justify-between p-4 text-sm text-slate-500">
          <span>{c.empty}</span>
          {canCreate && (
            <button
              onClick={() => run(() => createCustoms(fileId))}
              disabled={pending}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {c.start}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </section>
    );
  }

  const targets = nextStatuses(record.status);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      updateCustoms(record!.id, {
        declarationNumber: String(fd.get("declarationNumber") ?? ""),
        customsOffice: String(fd.get("customsOffice") ?? ""),
        regime: String(fd.get("regime") ?? ""),
        declarationDate: String(fd.get("declarationDate") ?? "") || null,
        inspectionStatus: fd.get("inspectionStatus") as CustomsRecord["inspectionStatus"],
        externalRef: String(fd.get("externalRef") ?? ""),
        notes: String(fd.get("notes") ?? ""),
        required: fd.get("required") === "on",
      }),
    );
  }

  return (
    <section className="space-y-3">
      {header}

      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[record.status]}`}>
            {c.statuses[record.status]}
          </span>
          <span className="text-xs text-slate-500">
            {record.required ? c.required : c.optional}
          </span>
          {record.baeReference && (
            <span className="ml-auto text-xs text-teal-700">
              {c.fields.bae}: <span className="tabular font-medium">{record.baeReference}</span>
            </span>
          )}
        </div>

        {missing.length > 0 && record.status !== "RELEASED" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            <span className="font-semibold">{c.missingTitle}:</span> {missing.map((m) => m.label).join(", ")}
          </div>
        )}

        {/* Workflow actions */}
        {(canUpdate || canRelease) && targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {targets.map((s) => {
              if (s === "RELEASED") {
                return canRelease ? (
                  <button
                    key={s}
                    onClick={() => {
                      const bae = window.prompt(c.baePrompt);
                      if (bae && bae.trim()) run(() => releaseCustoms(record.id, bae.trim()));
                    }}
                    disabled={pending}
                    className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                  >
                    {c.release}
                  </button>
                ) : null;
              }
              if (!canUpdate) return null;
              const label = s === "BLOCKED" ? c.block : s === "CANCELLED" ? c.cancel : `→ ${c.statuses[s]}`;
              return (
                <button
                  key={s}
                  onClick={() => run(() => changeCustomsStatus(record.id, s))}
                  disabled={pending}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {label}
                </button>
              );
            })}
            {canDelete && (
              <button
                onClick={() => run(() => deleteCustoms(record.id))}
                disabled={pending}
                className="ml-auto rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                {c.cancel}
              </button>
            )}
          </div>
        )}

        {/* Editable manual-reference metadata */}
        {canUpdate && (
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={c.fields.declarationNumber} name="declarationNumber" defaultValue={record.declarationNumber} />
            <Field label={c.fields.customsOffice} name="customsOffice" defaultValue={record.customsOffice} />
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              {c.fields.regime}
              <input
                name="regime"
                list="customs-regimes"
                defaultValue={record.regime ?? ""}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
              <datalist id="customs-regimes">
                {REGIMES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
            <Field label={c.fields.declarationDate} name="declarationDate" type="date" defaultValue={record.declarationDate} />
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              {c.fields.inspection}
              <select
                name="inspectionStatus"
                defaultValue={record.inspectionStatus}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              >
                {(["NOT_REQUIRED", "PENDING", "PASSED", "FAILED"] as const).map((s) => (
                  <option key={s} value={s}>
                    {c.inspection[s]}
                  </option>
                ))}
              </select>
            </label>
            <Field label={c.fields.externalRef} name="externalRef" defaultValue={record.externalRef} />
            <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
              {c.fields.notes}
              <textarea
                name="notes"
                defaultValue={record.notes ?? ""}
                rows={2}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="required" defaultChecked={record.required} />
              {c.required}
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
              >
                {pending ? c.saving : c.save}
              </button>
            </div>
          </form>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
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
