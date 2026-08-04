/**
 * Dossier operational history — the CANONICAL timeline surface.
 *
 * UT-4 ABSORBED this component rather than adding a route. A dossier timeline
 * already existed here (WES-9L: Decision Plane only, unpaginated, rendering raw
 * metadata chips); creating `/files/[id]/timeline` beside it would have left two
 * histories of the same dossier free to disagree about what happened. There is
 * one entry point, and this is it.
 *
 * What changed underneath: it reads `readUnifiedTimeline` — both planes, ordered
 * and grouped by the frozen chronology rules — instead of `readDossierTimeline`,
 * which saw only decisions. What did not change: the call site, the section's
 * place on the dossier page, and the rule that visibility is the reader's
 * business rather than this component's.
 *
 * The old footnote here warned that inter-department handoffs and expense visas
 * were absent. UT-3B's emitters landed both, so the warning is retired rather
 * than left to mislead — its replacement is the ledger-boundary statement in the
 * view, which is about a real and current limit.
 *
 * Server component: it fetches the FIRST PAGE only and hands presentation to the
 * client view. No full history is ever loaded.
 */
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { readUnifiedTimeline } from "@/lib/unified-timeline/unified";
import { UnifiedTimelineView } from "./unified-timeline-view";

const FIRST_PAGE = 40;

/**
 * Has this tenant stated where its recorded history begins?
 *
 * Read on the admin client, AFTER the caller is resolved and scoped to their own
 * tenant — the marker is a tenant-level fact with no dossier, so no dossier
 * policy covers it. It returns a boolean about the tenant's own ledger and no
 * event content. If the read fails the UI assumes NO boundary, which is the
 * conservative direction: it then declines to imply the history is complete.
 */
async function hasLedgerBoundary(tenantId: string): Promise<boolean> {
  try {
    const admin = getAdminSupabaseClient();
    const { count } = await admin
      .from("business_event")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("event_type", "HISTORICAL_EVENTS_NOT_BACKFILLED");
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function EventTimeline({ fileId }: { fileId: string }) {
  const user = await requireUser();
  const [permissions, page, boundary] = await Promise.all([
    getEffectivePermissions(user.id),
    // ONE call. The reader gates both planes and re-scopes every entry to this
    // dossier and this tenant, so nothing here queries a module table and there
    // is no per-entry lookup.
    readUnifiedTimeline({ dossierId: fileId, limit: FIRST_PAGE }),
    hasLedgerBoundary(user.tenantId),
  ]);

  return (
    <UnifiedTimelineView
      dossierId={fileId}
      initialEntries={page.entries}
      initialCursor={page.nextCursor}
      permissions={permissions}
      hasLedgerBoundary={boundary}
    />
  );
}
