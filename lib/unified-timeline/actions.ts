"use server";
/**
 * UT-4 — the timeline's only server action. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * "Load more" and filter changes both come back through here. It adds no
 * authorization of its own and no query of its own: it forwards to
 * `readUnifiedTimeline`, which resolves the caller, gates the Decision Plane
 * through RLS and the Observation Plane through `isFileVisible`, and re-scopes
 * every entry to the requested dossier and the caller's tenant.
 *
 * That is deliberate. A second gate here would be a second copy of the rule,
 * and the copy is what drifts. The dossierId arriving from the browser is
 * untrusted and is treated as such by the reader — an unauthorized dossier
 * yields an empty page, not an error, exactly as it does on first render.
 */
import "server-only";
import { readUnifiedTimeline, type UnifiedPage } from "./unified";
import type { TimelineFilter } from "./presentation";
import type { Plane } from "./merged";
import type { EventOrigin } from "./contract";

export type TimelinePageRequest = {
  dossierId: string;
  cursor?: string;
  filter?: TimelineFilter;
  plane?: Plane | null;
  origin?: EventOrigin | null;
  limit?: number;
};

export async function loadTimelinePage(req: TimelinePageRequest): Promise<UnifiedPage> {
  return readUnifiedTimeline({
    dossierId: req.dossierId,
    cursor: req.cursor,
    filter: req.filter,
    plane: req.plane ?? null,
    origin: req.origin ?? null,
    limit: req.limit,
  });
}
