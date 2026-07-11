/**
 * Driver offline position queue (Phase 3.4C) — CLIENT util (localStorage).
 * ---------------------------------------------------------------------------
 * A bounded, per-session queue of UNSENT positions with idempotency keys. Weak
 * connectivity is tolerated: positions are enqueued locally and flushed when the
 * server confirms. NEVER stores dossier/customer records or credentials — only
 * coordinates + timing + a key. Bounded (oldest dropped past the cap).
 */
export type QueuedPosition = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedKph?: number | null;
  recordedAt: string;
  idempotencyKey: string;
};

export const MAX_QUEUE = 500;
const PREFIX = "effitrans.driver.queue.";

function key(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function loadQueue(sessionId: string): QueuedPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedPosition[]) : [];
  } catch {
    return [];
  }
}

function save(sessionId: string, q: QueuedPosition[]): void {
  if (typeof window === "undefined") return;
  try {
    // Bounded: keep the most recent MAX_QUEUE (drop oldest low-value positions).
    const bounded = q.length > MAX_QUEUE ? q.slice(q.length - MAX_QUEUE) : q;
    window.localStorage.setItem(key(sessionId), JSON.stringify(bounded));
  } catch {
    /* storage full / unavailable — best-effort */
  }
}

export function enqueue(sessionId: string, pos: QueuedPosition): QueuedPosition[] {
  const q = loadQueue(sessionId);
  q.push(pos);
  save(sessionId, q);
  return loadQueue(sessionId);
}

/** Remove the given idempotency keys (server-confirmed or permanently rejected). */
export function removeKeys(sessionId: string, keys: string[]): QueuedPosition[] {
  const drop = new Set(keys);
  const q = loadQueue(sessionId).filter((p) => !drop.has(p.idempotencyKey));
  save(sessionId, q);
  return q;
}

export function clearQueue(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(sessionId));
  } catch {
    /* best-effort */
  }
}
