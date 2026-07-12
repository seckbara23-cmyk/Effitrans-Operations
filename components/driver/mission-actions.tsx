"use client";

/**
 * Driver mission actions (Phase 3.4C-3). CLIENT component.
 * ---------------------------------------------------------------------------
 * Field controls for an assigned mission: record operational events, report a
 * delay or incident, capture photos / signature / POD, and confirm delivery.
 * Every control calls a driver server action which re-derives authority server-
 * side (assignment + live session + feature flag) — this UI only collects input.
 * The current position is attached best-effort when the device allows it; the
 * server never trusts it for authorization and geolocation ALONE never delivers.
 */
import { useState, useTransition } from "react";
import { t } from "@/lib/i18n";
import { recordDriverEvent, reportDelay, reportIncident } from "@/lib/driver/ops";
import { uploadDriverEvidence } from "@/lib/driver/upload";
import { confirmDelivery } from "@/lib/driver/delivery";
import { DRIVER_EVENT_KINDS, DELAY_CATEGORIES, INCIDENT_CATEGORIES, INCIDENT_SEVERITIES } from "@/lib/driver/event-kinds";
import type { MissionEvidence } from "@/lib/driver/service";

type Result = { ok: true; id?: string } | { ok: false; error: string };

type Props = {
  transportId: string;
  sessionActive: boolean;
  status: string;
  evidence: MissionEvidence[];
  trackingEnabled: boolean;
};

const EVIDENCE_KINDS = ["pickup", "cargo", "seal", "incident", "delivery", "signature", "pod"] as const;
const DELIVERED_STATES = new Set(["DELIVERED", "POD_RECEIVED", "CANCELLED"]);

function currentCoords(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 },
    );
  });
}

export function MissionActions({ transportId, sessionActive, status, evidence, trackingEnabled }: Props) {
  const d = t.driver;
  const o = d.ops;
  const [panel, setPanel] = useState<"delay" | "incident" | "photo" | "delivery" | null>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const errText = (code?: string) => (d.errors as Record<string, string>)[code ?? "generic"] ?? d.errors.generic;

  function run(action: () => Promise<Result>, okMsg: string, after?: () => void) {
    setFeedback(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setFeedback({ ok: false, msg: errText(r.error) });
        return;
      }
      setFeedback({ ok: true, msg: okMsg });
      after?.();
    });
  }

  if (!trackingEnabled) {
    return (
      <section className="surface p-4">
        <h2 className="text-sm font-semibold text-navy-900">{o.title}</h2>
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">{d.tracking.disabled}</p>
      </section>
    );
  }

  const delivered = DELIVERED_STATES.has(status);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">{o.title}</h2>
      </div>

      {!sessionActive && !delivered && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{o.needSession}</p>
      )}

      {feedback && (
        <p className={`rounded-lg border p-2 text-xs ${feedback.ok ? "border-teal-200 bg-teal-50 text-teal-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {feedback.msg}
        </p>
      )}

      {/* Operational events — quick taps */}
      <div className="surface space-y-2 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{o.events.title}</h3>
        <div className="grid grid-cols-2 gap-2">
          {DRIVER_EVENT_KINDS.map((kind) => (
            <button
              key={kind}
              disabled={pending}
              onClick={async () => {
                const coords = await currentCoords();
                run(() => recordDriverEvent(transportId, { type: kind, ...(coords ?? {}) }), o.events.recorded);
              }}
              className="rounded-lg border border-slate-200 px-2 py-2.5 text-xs font-medium text-navy-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {(o.events as Record<string, string>)[kind] ?? kind}
            </button>
          ))}
        </div>
      </div>

      {/* Accordions */}
      <div className="space-y-2">
        <PanelButton label={o.delay.title} active={panel === "delay"} onClick={() => setPanel(panel === "delay" ? null : "delay")} />
        {panel === "delay" && <DelayForm o={o} pending={pending} onSubmit={(input) => run(() => reportDelay(transportId, input), o.delay.reported, () => setPanel(null))} />}

        <PanelButton label={o.incident.title} active={panel === "incident"} onClick={() => setPanel(panel === "incident" ? null : "incident")} />
        {panel === "incident" && <IncidentForm o={o} pending={pending} onSubmit={(input) => run(() => reportIncident(transportId, input), o.incident.reported, () => setPanel(null))} />}

        <PanelButton label={o.photos.title} active={panel === "photo"} onClick={() => setPanel(panel === "photo" ? null : "photo")} />
        {panel === "photo" && (
          <PhotoForm
            o={o}
            pending={pending}
            evidence={evidence}
            onSubmit={(fd, okMsg) => run(() => uploadDriverEvidence(transportId, fd) as Promise<Result>, okMsg)}
          />
        )}

        {!delivered ? (
          <>
            <PanelButton label={o.delivery.title} active={panel === "delivery"} onClick={() => setPanel(panel === "delivery" ? null : "delivery")} primary />
            {panel === "delivery" && (
              <DeliveryForm
                o={o}
                pending={pending}
                onSubmit={async (input) => {
                  const coords = await currentCoords();
                  run(() => confirmDelivery(transportId, { ...input, ...(coords ?? {}) }), o.delivery.confirmed, () => setPanel(null));
                }}
              />
            )}
          </>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center text-xs font-medium text-slate-500">{o.delivery.done}</p>
        )}
      </div>

      <p className="text-[11px] text-slate-400">{o.locationNote}</p>
    </section>
  );
}

function PanelButton({ label, active, onClick, primary }: { label: string; active: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm font-medium ${
        primary ? "bg-navy-900 text-white hover:bg-navy-800" : "border border-slate-200 text-navy-800 hover:bg-slate-50"
      }`}
    >
      <span>{label}</span>
      <span className={primary ? "text-white/70" : "text-slate-400"}>{active ? "−" : "+"}</span>
    </button>
  );
}

type Ops = (typeof t)["driver"]["ops"];

function DelayForm({ o, pending, onSubmit }: { o: Ops; pending: boolean; onSubmit: (input: { category: string; customerMessage: string; internalNote?: string; expectedDelayMinutes?: number | null }) => void }) {
  const [category, setCategory] = useState<string>(DELAY_CATEGORIES[0]);
  const [customerMessage, setCustomerMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [expected, setExpected] = useState("");
  return (
    <div className="surface space-y-2 p-4">
      <Label text={o.delay.category}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
          {DELAY_CATEGORIES.map((c) => (
            <option key={c} value={c}>{(o.delay.categories as Record<string, string>)[c] ?? c}</option>
          ))}
        </select>
      </Label>
      <Label text={o.delay.customerMessage} hint={o.delay.customerHint}>
        <textarea value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} rows={2} className="input" />
      </Label>
      <Label text={o.delay.expected}>
        <input type="number" min={0} value={expected} onChange={(e) => setExpected(e.target.value)} className="input" />
      </Label>
      <Label text={o.delay.internalNote}>
        <textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={2} className="input" />
      </Label>
      <button
        disabled={pending || customerMessage.trim().length === 0}
        onClick={() => onSubmit({ category, customerMessage, internalNote: internalNote || undefined, expectedDelayMinutes: expected ? Number(expected) : null })}
        className="w-full rounded-lg bg-amber-600 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {o.delay.submit}
      </button>
    </div>
  );
}

function IncidentForm({ o, pending, onSubmit }: { o: Ops; pending: boolean; onSubmit: (input: { category: string; severity: string; internalNote: string; customerMessage?: string }) => void }) {
  const [category, setCategory] = useState<string>(INCIDENT_CATEGORIES[0]);
  const [severity, setSeverity] = useState<string>(INCIDENT_SEVERITIES[1]);
  const [internalNote, setInternalNote] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  return (
    <div className="surface space-y-2 p-4">
      <Label text={o.incident.category}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
          {INCIDENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{(o.incident.categories as Record<string, string>)[c] ?? c}</option>
          ))}
        </select>
      </Label>
      <Label text={o.incident.severity}>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="input">
          {INCIDENT_SEVERITIES.map((s) => (
            <option key={s} value={s}>{(o.incident.severities as Record<string, string>)[s] ?? s}</option>
          ))}
        </select>
      </Label>
      <Label text={o.incident.internalNote} hint={o.incident.internalHint}>
        <textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={3} className="input" />
      </Label>
      <Label text={o.incident.customerMessage}>
        <textarea value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} rows={2} className="input" />
      </Label>
      <button
        disabled={pending || internalNote.trim().length === 0}
        onClick={() => onSubmit({ category, severity, internalNote, customerMessage: customerMessage || undefined })}
        className="w-full rounded-lg bg-red-600 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {o.incident.submit}
      </button>
    </div>
  );
}

const CODE_LABELS = (o: Ops): Record<string, string> => ({
  PICKUP_PHOTO: o.photos.kinds.pickup,
  CARGO_PHOTO: o.photos.kinds.cargo,
  SEAL_PHOTO: o.photos.kinds.seal,
  INCIDENT_PHOTO: o.photos.kinds.incident,
  DELIVERY_PHOTO: o.photos.kinds.delivery,
  DRIVER_SIGNATURE: o.photos.kinds.signature,
  DELIVERY_NOTE: o.photos.kinds.pod,
});

function PhotoForm({ o, pending, evidence, onSubmit }: { o: Ops; pending: boolean; evidence: MissionEvidence[]; onSubmit: (fd: FormData, okMsg: string) => void }) {
  const [kind, setKind] = useState<string>(EVIDENCE_KINDS[0]);
  const [file, setFile] = useState<File | null>(null);
  const labels = CODE_LABELS(o);
  return (
    <div className="surface space-y-2 p-4">
      <Label text={o.photos.kind}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input">
          {EVIDENCE_KINDS.map((k) => (
            <option key={k} value={k}>{(o.photos.kinds as Record<string, string>)[k] ?? k}</option>
          ))}
        </select>
      </Label>
      <input
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-medium"
      />
      <p className="text-[11px] text-slate-400">{o.photos.hint}</p>
      <button
        disabled={pending || !file}
        onClick={() => {
          if (!file) return;
          const fd = new FormData();
          fd.set("kind", kind);
          fd.set("file", file);
          onSubmit(fd, o.photos.uploaded);
          setFile(null);
        }}
        className="w-full rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? o.photos.uploading : o.photos.add}
      </button>

      <div className="pt-1">
        {evidence.length === 0 ? (
          <p className="text-xs text-slate-400">{o.photos.empty}</p>
        ) : (
          <ul className="space-y-1">
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-medium text-navy-800">{labels[e.typeCode] ?? e.typeCode}</span>
                <span className="text-slate-400">{new Date(e.createdAt).toLocaleTimeString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DeliveryForm({ o, pending, onSubmit }: { o: Ops; pending: boolean; onSubmit: (input: { recipientName: string; customerMessage?: string }) => void }) {
  const [recipientName, setRecipientName] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  return (
    <div className="surface space-y-2 p-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{o.delivery.warning}</p>
      <Label text={o.delivery.recipient} hint={o.delivery.recipientHint}>
        <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="input" />
      </Label>
      <Label text={o.delivery.customerMessage}>
        <textarea value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} rows={2} className="input" />
      </Label>
      <button
        disabled={pending || recipientName.trim().length === 0}
        onClick={() => onSubmit({ recipientName, customerMessage: customerMessage || undefined })}
        className="w-full rounded-lg bg-navy-900 px-3 py-3 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
      >
        {pending ? o.delivery.confirming : o.delivery.confirm}
      </button>
    </div>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{text}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
