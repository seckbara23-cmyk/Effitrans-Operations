"use client";

/**
 * Mission tracker (Phase 3.4C). CLIENT component — the driver's tracking control.
 * ---------------------------------------------------------------------------
 * Consent-gated browser geolocation with a bounded offline queue. Geolocation is
 * requested ONLY after the driver starts the mission AND confirms consent AND the
 * feature flag is on — never on page load. Positions are batched (min interval /
 * distance, reusing lib/tracking/position), queued locally, and flushed to the
 * secure batch endpoint; the UI never claims "synced" before the server confirms.
 * Pause/resume/stop map to the session lifecycle actions. No dossier data is stored
 * locally — only coordinates + timing + an idempotency key.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { startMission, pauseTracking, resumeTracking, stopMission, type SessionActionResult } from "@/lib/driver/actions";
import { isValidCoordinate, shouldRecordPosition, DEFAULT_POSITION_THRESHOLDS } from "@/lib/tracking/position";
import { enqueue, loadQueue, removeKeys, type QueuedPosition } from "./queue";
import type { TrackingSessionStatus } from "@/lib/tracking/types";

type Props = {
  transportId: string;
  initialSessionId: string | null;
  initialSessionStatus: TrackingSessionStatus | null;
  trackingEnabled: boolean;
};

const MAX_FLUSH = 200;

export function MissionTracker({ transportId, initialSessionId, initialSessionStatus, trackingEnabled }: Props) {
  const d = t.driver;
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [status, setStatus] = useState<TrackingSessionStatus | null>(initialSessionStatus);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied" | "unsupported">("unknown");

  const watchIdRef = useRef<number | null>(null);
  const lastRecordedRef = useRef<{ latitude: number; longitude: number; recordedAt: string } | null>(null);
  const flushingRef = useRef(false);

  const errText = (code?: string) => (d.errors as Record<string, string>)[code ?? "generic"] ?? d.errors.generic;
  const refreshPending = useCallback((sid: string | null) => setPendingCount(sid ? loadQueue(sid).length : 0), []);

  const flush = useCallback(async (sid: string) => {
    if (flushingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const q = loadQueue(sid);
    if (q.length === 0) return;
    flushingRef.current = true;
    try {
      const batch = q.slice(0, MAX_FLUSH);
      const res = await fetch("/api/driver/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingSessionId: sid, positions: batch }),
      });
      if (res.ok) {
        // Every SENT key is now resolved server-side (stored or permanently rejected).
        removeKeys(sid, batch.map((p) => p.idempotencyKey));
        setLastSync(new Date().toISOString());
        refreshPending(sid);
      }
    } catch {
      /* offline / failed — keep queued, retry later */
    } finally {
      flushingRef.current = false;
    }
  }, [refreshPending]);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const startWatch = useCallback((sid: string) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPermission("unsupported");
      return;
    }
    stopWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setPermission("granted");
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        if (!isValidCoordinate(lat, lng)) return;
        const recordedAt = new Date(p.timestamp).toISOString();
        const prev = lastRecordedRef.current;
        // Batching: skip unless enough time OR movement (never write every callback).
        if (!shouldRecordPosition(prev, { latitude: lat, longitude: lng, recordedAt }, DEFAULT_POSITION_THRESHOLDS)) return;
        lastRecordedRef.current = { latitude: lat, longitude: lng, recordedAt };
        const pos: QueuedPosition = {
          latitude: lat,
          longitude: lng,
          accuracyMeters: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
          headingDegrees: p.coords.heading != null && Number.isFinite(p.coords.heading) ? p.coords.heading : null,
          speedKph: p.coords.speed != null && Number.isFinite(p.coords.speed) ? p.coords.speed * 3.6 : null,
          recordedAt,
          idempotencyKey: crypto.randomUUID(),
        };
        enqueue(sid, pos);
        refreshPending(sid);
        void flush(sid);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setPermission("denied");
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 },
    );
  }, [flush, refreshPending, stopWatch]);

  // Reflect queue; if the mission is already ACTIVE, resume watching + flush.
  useEffect(() => {
    refreshPending(sessionId);
    if (sessionId && status === "ACTIVE" && trackingEnabled) {
      startWatch(sessionId);
      void flush(sessionId);
    }
    return () => stopWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, status, trackingEnabled]);

  // Flush pending positions when connectivity returns.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      if (sessionId && status === "ACTIVE") void flush(sessionId);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sessionId, status, flush]);

  async function act(fn: () => Promise<SessionActionResult>, onOk: (r: SessionActionResult) => void) {
    setError(null);
    setPending(true);
    try {
      const r = await fn();
      if (!r.ok) {
        setError(errText(r.error));
        return;
      }
      onOk(r);
    } finally {
      setPending(false);
    }
  }

  function onStartClick() {
    if (!trackingEnabled) {
      setError(d.tracking.disabled);
      return;
    }
    setConsentOpen(true);
  }
  async function onConsent() {
    setConsentOpen(false);
    await act(() => startMission(transportId), (r) => {
      setSessionId(r.sessionId ?? null);
      setStatus("ACTIVE");
    });
  }
  async function onPause() {
    if (!sessionId) return;
    stopWatch();
    await act(() => pauseTracking(sessionId), () => setStatus("PAUSED"));
  }
  async function onResume() {
    if (!sessionId) return;
    await act(() => resumeTracking(sessionId), () => setStatus("ACTIVE"));
  }
  async function onStop() {
    if (!sessionId) return;
    stopWatch();
    await flush(sessionId);
    await act(() => stopMission(sessionId), () => setStatus("COMPLETED"));
  }

  const tk = d.tracking;
  const active = status === "ACTIVE";
  const paused = status === "PAUSED";
  const completed = status === "COMPLETED";

  return (
    <section className="space-y-3">
      <div className="surface space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-navy-900">{tk.statusLabel}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              active ? "bg-teal-50 text-teal-700" : paused ? "bg-amber-50 text-amber-700" : completed ? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-600"
            }`}
          >
            {active ? tk.active : paused ? d.health.paused : completed ? d.health.completed : d.health.not_started}
          </span>
        </div>

        {!trackingEnabled ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">{tk.disabled}</p>
        ) : (
          <>
            {!sessionId && !completed && (
              <button
                onClick={onStartClick}
                disabled={pending}
                className="w-full rounded-lg bg-navy-900 px-3 py-3 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
              >
                {pending ? tk.starting : tk.start}
              </button>
            )}

            {active && (
              <div className="flex gap-2">
                <button onClick={onPause} disabled={pending} className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-800 disabled:opacity-50">
                  {tk.pause}
                </button>
                <button onClick={onStop} disabled={pending} className="flex-1 rounded-lg border border-slate-200 px-3 py-3 text-sm font-medium text-slate-600 disabled:opacity-50">
                  {tk.stop}
                </button>
              </div>
            )}
            {paused && (
              <div className="flex gap-2">
                <button onClick={onResume} disabled={pending} className="flex-1 rounded-lg bg-teal-600 px-3 py-3 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                  {tk.resume}
                </button>
                <button onClick={onStop} disabled={pending} className="flex-1 rounded-lg border border-slate-200 px-3 py-3 text-sm font-medium text-slate-600 disabled:opacity-50">
                  {tk.stop}
                </button>
              </div>
            )}

            {(active || paused) && (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {tk.pending} : <strong className="text-navy-800">{pendingCount}</strong>
                </span>
                <span>
                  {tk.lastSync} : {lastSync ? new Date(lastSync).toLocaleTimeString("fr-FR") : tk.never}
                </span>
              </div>
            )}

            {permission === "denied" && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{tk.permissionDenied}</p>}
            {permission === "unsupported" && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{tk.unsupported}</p>}
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {consentOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-navy-900">{tk.consentTitle}</h2>
            <p className="mt-2 text-sm font-medium text-navy-800">{tk.consentMessage}</p>
            <p className="mt-2 text-xs text-slate-500">{tk.consentDetails}</p>
            <div className="mt-5 flex flex-col gap-2">
              <button onClick={onConsent} className="w-full rounded-lg bg-navy-900 px-3 py-3 text-sm font-medium text-white hover:bg-navy-800">
                {tk.consentConfirm}
              </button>
              <button onClick={() => setConsentOpen(false)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-600">
                {tk.consentCancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
