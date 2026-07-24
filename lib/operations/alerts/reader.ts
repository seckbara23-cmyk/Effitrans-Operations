/**
 * Unified Alert Center — composed reader (Phase 10.0E-1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * `getOperationalAlerts()` — the single composition point, in the exact KPI-engine
 * idiom: requireUser → resolve permissions → run every adapter under
 * Promise.allSettled → compose. CONSUME, NEVER OWN: this reader holds NO business
 * query of its own (zero `.from(`) — every alert comes from an adapter that wraps
 * an existing bounded reader. There is NO top-level permission gate (DEC-B49): a
 * viewer sees the union of alerts their SOURCE permissions already grant; each
 * adapter self-gates via `available` (omitted) and degrades via allSettled
 * (unavailable). Request-`cache()`d so page + future copilot share one pass.
 *
 * The seven ratified source adapters (DEC-B53) are registered in
 * ./adapters — this reader's architecture is unchanged from 10.0E-1; it only
 * iterates whatever the registry contains.
 */
import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { composeAlertSet, emptyAlertSet } from "./compose";
import { ALERT_ADAPTERS } from "./adapters";
import type { AlertAdapterContext, AlertSource, OperationalAlert, OperationalAlertSet } from "./types";

/** The registered source adapters (Phase 10.0E-2 — the seven ratified sources). */
const ADAPTERS = ALERT_ADAPTERS;

export const getOperationalAlerts = cache(async (): Promise<OperationalAlertSet> => {
  const generatedAt = new Date().toISOString();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return emptyAlertSet(generatedAt);

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const ctx: AlertAdapterContext = { userId: user.id, tenantId: user.tenantId, permissions };

  const sources: AlertSource[] = [];
  // Permission-shaped: a source the viewer cannot read is OMITTED (absent ≠ zero).
  const runnable = ADAPTERS.filter((a) => {
    if (a.available && !a.available(ctx)) {
      sources.push({ key: a.key, status: "omitted" });
      return false;
    }
    return true;
  });

  const results = await Promise.allSettled(runnable.map((a) => a.load(ctx)));
  const gathered: OperationalAlert[] = [];
  runnable.forEach((a, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      sources.push({ key: a.key, status: "ok" });
      gathered.push(...r.value);
    } else {
      // Dark flag / query failure ⇒ unavailable, NEVER a silent "0 alertes".
      sources.push({ key: a.key, status: "unavailable" });
    }
  });

  return composeAlertSet(gathered, sources, generatedAt);
});
