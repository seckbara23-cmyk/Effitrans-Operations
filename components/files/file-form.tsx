"use client";

/**
 * Operational File create/edit form (Phase 1.2). Client component.
 * Invokes server-action proxies only — no server-only imports.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { CARGO_FORMS, CARGO_FORM_LABELS_FR } from "@/lib/files/taxonomy";
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

/** An empty field means "not recorded" — never 0. */
function numberOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const FILE_TYPES: FileType[] = ["IMP", "EXP", "TRP", "HND"];
const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "critical"];

export function FileForm({
  mode,
  fileId,
  initial,
  clients,
  parents = [],
  canUpdate = true,
  ports = [],
  airports = [],
}: {
  mode: "create" | "edit";
  fileId?: string;
  initial?: FileDetail;
  clients: { id: string; name: string }[];
  /**
   * MAYA-P0.5-B — dossiers this one may be attached to (« Dossier mère »).
   * Optional: with none supplied the picker is simply absent. Choosing a
   * parent records a LINK and nothing else — no groupage, no cascade, no
   * shared lifecycle (Q5 unanswered).
   */
  parents?: { id: string; fileNumber: string }[];
  canUpdate?: boolean;
  /**
   * TMS-2 — controlled geography (ocean_port / air_airport of THIS tenant),
   * loaded only for transport:read holders. Optional: with none supplied the
   * pickers are simply absent and the free-text origin/destination — which
   * remain the label either way — are all there is.
   */
  ports?: { id: string; label: string }[];
  airports?: { id: string; label: string }[];
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
  // TMS-2 — geographic anchors (optional; free text above stays the label).
  const [originPortId, setOriginPortId] = useState(s?.originPortId ?? "");
  const [destinationPortId, setDestinationPortId] = useState(s?.destinationPortId ?? "");
  const [originAirportId, setOriginAirportId] = useState(s?.originAirportId ?? "");
  const [destinationAirportId, setDestinationAirportId] = useState(s?.destinationAirportId ?? "");
  // MAYA-P0.5-B — cargo declaration + dossier facts. Optional throughout.
  const [cargoForm, setCargoForm] = useState(s?.cargoForm ?? "");
  const [quantity, setQuantity] = useState(s?.quantity != null ? String(s.quantity) : "");
  const [quantityUnit, setQuantityUnit] = useState(s?.quantityUnit ?? "");
  const [netWeightKg, setNetWeightKg] = useState(s?.netWeightKg != null ? String(s.netWeightKg) : "");
  const [grossWeightKg, setGrossWeightKg] = useState(s?.grossWeightKg != null ? String(s.grossWeightKg) : "");
  const [volumeM3, setVolumeM3] = useState(s?.volumeM3 != null ? String(s.volumeM3) : "");
  const [packageCount, setPackageCount] = useState(s?.packageCount != null ? String(s.packageCount) : "");
  const [goodsDescription, setGoodsDescription] = useState(s?.goodsDescription ?? "");
  const [supplierName, setSupplierName] = useState(s?.supplierName ?? "");
  const [warehouseEntryDate, setWarehouseEntryDate] = useState(s?.warehouseEntryDate ?? "");
  const [parentFileId, setParentFileId] = useState(initial?.parentFileId ?? "");
  const [clientReference, setClientReference] = useState(initial?.clientReference ?? "");
  const [onBehalfOf, setOnBehalfOf] = useState(initial?.onBehalfOf ?? "");
  const [processingDueDate, setProcessingDueDate] = useState(initial?.processingDueDate ?? "");

  const editable = mode === "create" || canUpdate;
  // TMS-2 — which anchor pickers apply to the declared transport mode.
  const showPorts = (transportMode === "SEA" || transportMode === "MULTIMODAL") && ports.length > 0;
  const showAirports = (transportMode === "AIR" || transportMode === "MULTIMODAL") && airports.length > 0;

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
        // Anchors follow the declared mode: switching away from a mode drops
        // the anchors that no longer apply (the server refuses mismatches too).
        originPortId: showPorts ? originPortId || null : null,
        destinationPortId: showPorts ? destinationPortId || null : null,
        originAirportId: showAirports ? originAirportId || null : null,
        destinationAirportId: showAirports ? destinationAirportId || null : null,
        cargoForm: cargoForm || null,
        quantity: numberOrNull(quantity),
        quantityUnit,
        netWeightKg: numberOrNull(netWeightKg),
        grossWeightKg: numberOrNull(grossWeightKg),
        volumeM3: numberOrNull(volumeM3),
        packageCount: numberOrNull(packageCount),
        goodsDescription,
        supplierName,
        warehouseEntryDate: warehouseEntryDate || null,
      },
      parentFileId: parentFileId || null,
      clientReference,
      onBehalfOf,
      processingDueDate: processingDueDate || null,
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
            {/* TMS-2 — controlled geographic anchors. The text above stays the
                label; these link the SAME fact to the port/airport referential
                so the tracking architecture can key on it. */}
            {showPorts && (
              <>
                <Field label="Port d'origine (référentiel)">
                  <select className={input} value={originPortId} disabled={!editable} onChange={(e) => setOriginPortId(e.target.value)}>
                    <option value="">— Non associé —</option>
                    {ports.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Port de destination (référentiel)">
                  <select className={input} value={destinationPortId} disabled={!editable} onChange={(e) => setDestinationPortId(e.target.value)}>
                    <option value="">— Non associé —</option>
                    {ports.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {showAirports && (
              <>
                <Field label="Aéroport d'origine (référentiel)">
                  <select className={input} value={originAirportId} disabled={!editable} onChange={(e) => setOriginAirportId(e.target.value)}>
                    <option value="">— Non associé —</option>
                    {airports.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Aéroport de destination (référentiel)">
                  <select className={input} value={destinationAirportId} disabled={!editable} onChange={(e) => setDestinationAirportId(e.target.value)}>
                    <option value="">— Non associé —</option>
                    {airports.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
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

        {/* MAYA-P0.5-B — the cargo declaration. Every dossier can describe what
            it carries, whatever its mode: a bulk export and a road-only file
            had nowhere to record this before. All fields optional. */}
        <div>
          <p className="mb-2 text-sm font-semibold text-navy-900">Marchandise</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Forme">
              <select className={input} value={cargoForm} disabled={!editable} onChange={(e) => setCargoForm(e.target.value)}>
                <option value="">{t.common.none}</option>
                {CARGO_FORMS.map((f) => (
                  <option key={f} value={f}>{CARGO_FORM_LABELS_FR[f]}</option>
                ))}
              </select>
            </Field>
            <Field label="Désignation">
              <input className={input} value={goodsDescription} disabled={!editable} onChange={(e) => setGoodsDescription(e.target.value)} />
            </Field>
            <Field label="Fournisseur">
              <input className={input} value={supplierName} disabled={!editable} onChange={(e) => setSupplierName(e.target.value)} />
            </Field>
            <Field label="Quantité">
              <input className={input} inputMode="decimal" value={quantity} disabled={!editable} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field label="Unité">
              <input className={input} value={quantityUnit} disabled={!editable} onChange={(e) => setQuantityUnit(e.target.value)} />
            </Field>
            <Field label="Nombre de colis">
              <input className={input} inputMode="numeric" value={packageCount} disabled={!editable} onChange={(e) => setPackageCount(e.target.value)} />
            </Field>
            <Field label="Poids net (kg)">
              <input className={input} inputMode="decimal" value={netWeightKg} disabled={!editable} onChange={(e) => setNetWeightKg(e.target.value)} />
            </Field>
            <Field label="Poids brut (kg)">
              <input className={input} inputMode="decimal" value={grossWeightKg} disabled={!editable} onChange={(e) => setGrossWeightKg(e.target.value)} />
            </Field>
            <Field label="Volume (m³)">
              <input className={input} inputMode="decimal" value={volumeM3} disabled={!editable} onChange={(e) => setVolumeM3(e.target.value)} />
            </Field>
          </div>
        </div>

        {/* MAYA-P0.5-B — dossier facts. References and dates only: none of
            them gates, routes or advances anything. */}
        <div>
          <p className="mb-2 text-sm font-semibold text-navy-900">Références & échéances</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Référence client">
              <input className={input} value={clientReference} disabled={!editable} onChange={(e) => setClientReference(e.target.value)} />
            </Field>
            <Field label="Pour le compte de">
              <input className={input} value={onBehalfOf} disabled={!editable} onChange={(e) => setOnBehalfOf(e.target.value)} />
            </Field>
            <Field label="Entrée en magasin">
              <input type="date" className={input} value={warehouseEntryDate} disabled={!editable} onChange={(e) => setWarehouseEntryDate(e.target.value)} />
            </Field>
            <Field label="Échéance de traitement">
              <input type="date" className={input} value={processingDueDate} disabled={!editable} onChange={(e) => setProcessingDueDate(e.target.value)} />
            </Field>
            {parents.length > 0 && (
              <Field label="Dossier mère">
                <select className={input} value={parentFileId} disabled={!editable} onChange={(e) => setParentFileId(e.target.value)}>
                  <option value="">{t.common.none}</option>
                  {parents.filter((p) => p.id !== fileId).map((p) => (
                    <option key={p.id} value={p.id}>{p.fileNumber}</option>
                  ))}
                </select>
              </Field>
            )}
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
