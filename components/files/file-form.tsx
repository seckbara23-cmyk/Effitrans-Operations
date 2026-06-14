"use client";

/**
 * Operational File create/edit form (Phase 1.2). Client component.
 * Invokes server-action proxies only — no server-only imports.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { createFile, updateFile } from "@/lib/files/actions";
import type {
  ActionResult,
  FileDetail,
  FileInput,
  FileType,
  Priority,
  TransportMode,
} from "@/lib/files/types";

function errorMessage(code: string): string {
  const map = t.files.errors as Record<string, string>;
  return map[code] ?? t.files.errors.generic;
}

const input =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20";

const FILE_TYPES: FileType[] = ["IMP", "EXP", "TRP", "HND"];
const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "critical"];

export function FileForm({
  mode,
  fileId,
  initial,
  clients,
  canUpdate = true,
}: {
  mode: "create" | "edit";
  fileId?: string;
  initial?: FileDetail;
  clients: { id: string; name: string }[];
  canUpdate?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<FileType>(initial?.type ?? "IMP");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "normal");
  const s = initial?.shipment;
  const [transportMode, setTransportMode] = useState<TransportMode | "">(s?.transportMode ?? "");
  const [incoterm, setIncoterm] = useState(s?.incoterm ?? "");
  const [origin, setOrigin] = useState(s?.origin ?? "");
  const [destination, setDestination] = useState(s?.destination ?? "");
  const [cargoType, setCargoType] = useState(s?.cargoType ?? "");
  const [carrierName, setCarrierName] = useState(s?.carrierName ?? "");
  const [vesselOrFlight, setVesselOrFlight] = useState(s?.vesselOrFlight ?? "");
  const [blAwbRef, setBlAwbRef] = useState(s?.blAwbRef ?? "");
  const [containerRef, setContainerRef] = useState(s?.containerRef ?? "");

  const editable = mode === "create" || canUpdate;

  function payload(): FileInput {
    return {
      type,
      clientId,
      priority,
      shipment: {
        transportMode: transportMode || null,
        incoterm,
        origin,
        destination,
        cargoType,
        carrierName,
        vesselOrFlight,
        blAwbRef,
        containerRef,
      },
    };
  }

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
    if (mode === "create") {
      run(() => createFile(payload()), (r) => router.push(r.id ? `/files/${r.id}` : "/files"));
    } else if (fileId) {
      run(() => updateFile(fileId, payload()), () => router.refresh());
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="surface border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="surface space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t.files.form.type}>
            <select className={input} value={type} disabled={!editable} onChange={(e) => setType(e.target.value as FileType)}>
              {FILE_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t.files.types[ty]} ({ty})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.files.form.client}>
            <select className={input} value={clientId} disabled={!editable} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{t.files.form.selectClient}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.files.form.priority}>
            <select className={input} value={priority} disabled={!editable} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t.files.priorities[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-navy-900">{t.files.form.shipment}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t.files.form.mode}>
              <select className={input} value={transportMode} disabled={!editable} onChange={(e) => setTransportMode(e.target.value as TransportMode | "")}>
                <option value="">{t.common.none}</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {t.files.modes[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.files.form.incoterm}>
              <input className={input} value={incoterm} disabled={!editable} onChange={(e) => setIncoterm(e.target.value)} />
            </Field>
            <Field label={t.files.form.cargoType}>
              <input className={input} value={cargoType} disabled={!editable} onChange={(e) => setCargoType(e.target.value)} />
            </Field>
            <Field label={t.files.form.origin}>
              <input className={input} value={origin} disabled={!editable} onChange={(e) => setOrigin(e.target.value)} />
            </Field>
            <Field label={t.files.form.destination}>
              <input className={input} value={destination} disabled={!editable} onChange={(e) => setDestination(e.target.value)} />
            </Field>
            <Field label={t.files.form.carrier}>
              <input className={input} value={carrierName} disabled={!editable} onChange={(e) => setCarrierName(e.target.value)} />
            </Field>
            <Field label={t.files.form.vesselFlight}>
              <input className={input} value={vesselOrFlight} disabled={!editable} onChange={(e) => setVesselOrFlight(e.target.value)} />
            </Field>
            <Field label={t.files.form.blAwb}>
              <input className={input} value={blAwbRef} disabled={!editable} onChange={(e) => setBlAwbRef(e.target.value)} />
            </Field>
            <Field label={t.files.form.container}>
              <input className={input} value={containerRef} disabled={!editable} onChange={(e) => setContainerRef(e.target.value)} />
            </Field>
          </div>
        </div>

        {editable && (
          <div className="pt-2">
            <button
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
            >
              {pending ? t.files.actions.saving : mode === "create" ? t.files.actions.create : t.files.actions.save}
            </button>
          </div>
        )}
      </div>
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
