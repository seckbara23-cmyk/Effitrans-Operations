/**
 * Act-time Account Manager attribution (Q9, RATIFIED 2026-08-30).
 * ---------------------------------------------------------------------------
 * ICAM measures workload, so each qualifying activity belongs to whoever owned
 * the dossier WHEN IT HAPPENED. A later reassignment must not transfer history:
 * if AM-A did three things and AM-B two, the score splits three/two, whatever
 * the dossier says today.
 *
 * THE FALLBACK THAT MUST NOT EXIST. `operational_file.account_manager_id` is
 * the CURRENT owner. Reading it for a past activity is the exact mistake this
 * module exists to prevent, and it would be invisible in the output — a
 * plausible number attributed to the wrong person. So this file never reads
 * that column, and when ownership at an instant is unknown it returns null and
 * the caller drops the event rather than guessing.
 *
 * THE HISTORY. `assignment_event` with `subject_type = 'COMMERCIAL_OWNER'` is
 * the audited record: `previous_user_id` → `new_user_id` at `created_at`,
 * written only by the `assign_commercial_owner` RPC, which demands a reason on
 * reassignment and refuses terminal dossiers. Migration 20260906000001 also
 * backfilled one INITIAL row per dossier that already carried an owner, so the
 * timeline starts at the beginning rather than at the first reassignment.
 */

/** One ownership change, as `assignment_event` records it. */
export type OwnershipEvent = {
  fileId: string;
  previousUserId: string | null;
  newUserId: string | null;
  /** `assignment_event.created_at` — database time. */
  atISO: string;
};

/**
 * A dossier's ownership timeline, ordered oldest-first. Built once per period
 * and queried many times, because a dossier has few events and many activities.
 */
export type OwnershipTimeline = {
  fileId: string;
  events: OwnershipEvent[];
};

export function buildTimelines(events: readonly OwnershipEvent[]): Map<string, OwnershipTimeline> {
  const byFile = new Map<string, OwnershipEvent[]>();
  for (const e of events) {
    const list = byFile.get(e.fileId) ?? [];
    list.push(e);
    byFile.set(e.fileId, list);
  }
  const out = new Map<string, OwnershipTimeline>();
  for (const [fileId, list] of byFile) {
    out.set(fileId, {
      fileId,
      events: [...list].sort((a, b) => (a.atISO < b.atISO ? -1 : a.atISO > b.atISO ? 1 : 0)),
    });
  }
  return out;
}

/**
 * Who owned `fileId` at `atISO`.
 *
 * The event at exactly `atISO` counts as already applied: an activity recorded
 * in the same instant as a handover belongs to the incoming owner. That is a
 * boundary choice and it is stated here rather than left to sort order.
 *
 * Returns null when ownership at that instant is unknowable — no timeline, or
 * an instant before the first recorded event whose `previous_user_id` is null.
 * The caller must then EXCLUDE the activity, never fall back to today's owner.
 */
export function ownerAt(
  timeline: OwnershipTimeline | undefined,
  atISO: string | null,
): string | null {
  if (!timeline || !atISO || timeline.events.length === 0) return null;

  let owner: string | null = null;
  let sawAny = false;
  for (const e of timeline.events) {
    if (e.atISO > atISO) break;
    owner = e.newUserId;
    sawAny = true;
  }

  if (!sawAny) {
    // The activity predates every recorded change. The owner before the first
    // one is what that event replaced — which the INITIAL backfill records.
    return timeline.events[0].previousUserId;
  }
  return owner;
}

/** One qualifying activity: what it was, when, and on which dossier. */
export type Activity = {
  fileId: string;
  /** The authoritative instant of the ACT, from the source's own timestamp. */
  atISO: string | null;
};

export type AttributionResult<T extends Activity> = {
  /** userId → the activities that belong to them. */
  byOwner: Map<string, T[]>;
  /** Activities whose owner-at-the-time could not be established. */
  unattributable: T[];
};

/**
 * Split activities across the Account Managers who owned the dossier when each
 * one happened. Activities with no instant, or no resolvable owner, land in
 * `unattributable` — visible, countable, and never silently reassigned.
 */
export function attributeByActTime<T extends Activity>(
  activities: readonly T[],
  timelines: Map<string, OwnershipTimeline>,
): AttributionResult<T> {
  const byOwner = new Map<string, T[]>();
  const unattributable: T[] = [];

  for (const a of activities) {
    const owner = a.atISO ? ownerAt(timelines.get(a.fileId), a.atISO) : null;
    if (!owner) {
      unattributable.push(a);
      continue;
    }
    const list = byOwner.get(owner) ?? [];
    list.push(a);
    byOwner.set(owner, list);
  }
  return { byOwner, unattributable };
}
