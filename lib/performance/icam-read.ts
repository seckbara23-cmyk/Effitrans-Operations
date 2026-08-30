/**
 * ICAM-1 — the read contract: derive the four sourced terms, attribute each
 * qualifying act to the Account Manager who owned the dossier at the time, and
 * roll up by closure month.
 * ---------------------------------------------------------------------------
 * WHAT ICAM-1 DELIVERS AND WHAT IT DOES NOT. Four of the eight terms have
 * authoritative sources today — NDOC, NFACT, NAD, NCOUR. NREP, NPAY and NCOORD
 * await rulings; NINC awaits its register (ICAM-2). Those four are reported as
 * SOURCE_UNAVAILABLE, never as zero, and every result says whether its basis is
 * complete. It is not.
 *
 * THE ACTIVITY INSTANT IS THE HARD PART, and it differs per term:
 *
 *   NAD   `expense_visa.decided_at`         — the visa decision, on its own row
 *   NCOUR `invoice_deposit_event.occurred_at` — the custody event, on its own row
 *   NDOC  ⚠ `document` has NO `reviewed_at`. The verification instant lives in
 *   NFACT   `audit_log` (`document.approved`, `occurred_at`, DB time). Where no
 *           audit row exists the instant is genuinely unknown, so those
 *           documents are NOT_ATTRIBUTABLE and are excluded and counted — the
 *           Q9 ruling forbids falling back to the current owner. Production
 *           currently shows 16 of 19 verified documents carrying that row.
 *
 * POPULATION (F-ICAM-05). The monthly roll-up contains CLOSED dossiers only,
 * placed by `file_state_transition.occurred_at` where `to_status = 'CLOSED'` —
 * immutable (`trg_fst_no_update`), database-timed, and the only closure fact
 * the dossier has. NOT `process_instance.closed_at` (a different object, C-4),
 * NOT `updated_at`, NOT `archived_at`. An open dossier may compute a
 * provisional ICAM and is excluded from every month.
 *
 * No BI, no report, no UI: ICAM-3 owns integration. This module is the contract
 * it will consume.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { VERIFIED_STORED_STATUSES } from "@/lib/documents/doctrine";
import { computeIcamDossier, type IcamCounts, type IcamDossierResult, type IcamTerm } from "./icam";
import {
  buildTimelines,
  attributeByActTime,
  type OwnershipEvent,
  type OwnershipTimeline,
} from "./attribution";
import type { PerformancePeriod } from "./period";

/** Terms ICAM-1 can source. The rest are disclosed, never zeroed. */
export const ICAM1_SOURCED_TERMS: readonly IcamTerm[] = ["NDOC", "NFACT", "NAD", "NCOUR"];
export const ICAM1_UNSOURCED_TERMS: readonly IcamTerm[] = ["NREP", "NPAY", "NCOORD", "NINC"];

export type IcamDossierRow = {
  fileId: string;
  fileNumber: string;
  /** The dossier's closure instant, or null while it is open. */
  closedAtISO: string | null;
  /** Per-owner results: one dossier can split across Account Managers. */
  byOwner: { userId: string; result: IcamDossierResult }[];
  /** Acts excluded for want of a persisted instant, across all terms. */
  unattributableActs: number;
};

export type IcamCollaboratorRow = {
  userId: string;
  /** Dossiers in which this AM held at least one attributed act. */
  dossierCount: number;
  /** Σ ICAM over the dossiers, for their own share. */
  icamTotal: number;
  basisComplete: boolean;
  unavailableTerms: IcamTerm[];
};

/** One qualifying act, already reduced to what attribution needs. */
type TermActivity = { fileId: string; atISO: string | null; term: IcamTerm };

// ---------------------------------------------------------------- sources ----

/**
 * Dossiers CLOSED within the period, with their closure instant. This IS the
 * F-ICAM-05 population: nothing open is here, by construction rather than by a
 * filter a caller might forget.
 */
async function closedDossiers(tenantId: string, period: PerformancePeriod) {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("file_state_transition")
    .select("file_id, occurred_at")
    .eq("tenant_id", tenantId)
    .eq("to_status", "CLOSED")
    .gte("occurred_at", `${period.startISO}T00:00:00Z`)
    .lte("occurred_at", `${period.endISO}T23:59:59.999Z`);

  // CLOSED is terminal (`status.ts`: `CLOSED: []`), so a dossier has at most one
  // closure and this map cannot collide.
  const closedAt = new Map<string, string>();
  for (const r of data ?? []) closedAt.set(r.file_id as string, r.occurred_at as string);
  return closedAt;
}

/** The ownership timelines for a set of dossiers. */
async function ownershipTimelines(
  tenantId: string,
  fileIds: readonly string[],
): Promise<Map<string, OwnershipTimeline>> {
  if (fileIds.length === 0) return new Map();
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("assignment_event")
    .select("file_id, previous_user_id, new_user_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("subject_type", "COMMERCIAL_OWNER")
    .in("file_id", fileIds);

  const events: OwnershipEvent[] = (data ?? [])
    .filter((r) => r.file_id !== null)
    .map((r) => ({
      fileId: r.file_id as string,
      previousUserId: (r.previous_user_id as string | null) ?? null,
      newUserId: (r.new_user_id as string | null) ?? null,
      atISO: r.created_at as string,
    }));
  return buildTimelines(events);
}

/**
 * NDOC + NFACT — verified documents, with their verification instant taken from
 * the audit trail because `document` does not persist one.
 *
 * `VERIFIED_STORED_STATUSES` is the shared doctrine's own list (VERIFIED,
 * CONSUMED_AS_EVIDENCE and the legacy APPROVED alias), used here rather than a
 * hand-written `= 'VERIFIED'` that would silently drop two of the three.
 */
async function verifiedDocumentActivities(
  tenantId: string,
  fileIds: readonly string[],
): Promise<TermActivity[]> {
  if (fileIds.length === 0) return [];
  const admin = getAdminSupabaseClient();
  const { data: docs } = await admin
    .from("document")
    .select("id, file_id, type_code, status")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .in("file_id", fileIds)
    .in("status", [...VERIFIED_STORED_STATUSES]);
  if (!docs || docs.length === 0) return [];

  const { data: audits } = await admin
    .from("audit_log")
    .select("entity_id, occurred_at")
    .eq("tenant_id", tenantId)
    .eq("entity", "document")
    .eq("action", "document.approved")
    .in("entity_id", docs.map((d) => d.id as string));

  // Earliest approval wins: a document verified once and later re-reviewed was
  // CONTROLLED at the first verification, and that is the act ICAM counts.
  const approvedAt = new Map<string, string>();
  for (const a of audits ?? []) {
    const id = a.entity_id as string;
    const at = a.occurred_at as string;
    const cur = approvedAt.get(id);
    if (!cur || at < cur) approvedAt.set(id, at);
  }

  return docs.map((d) => ({
    fileId: d.file_id as string,
    atISO: approvedAt.get(d.id as string) ?? null, // null ⇒ NOT_ATTRIBUTABLE
    term: (d.type_code === "VENDOR_INVOICE" ? "NFACT" : "NDOC") as IcamTerm,
  }));
}

/** NAD — expense authorizations that were actually visa'd, at the visa instant. */
async function visaActivities(
  tenantId: string,
  fileIds: readonly string[],
): Promise<TermActivity[]> {
  if (fileIds.length === 0) return [];
  const admin = getAdminSupabaseClient();
  const { data: auths } = await admin
    .from("expense_authorization")
    .select("id, file_id")
    .eq("tenant_id", tenantId)
    .in("file_id", fileIds);
  if (!auths || auths.length === 0) return [];

  const fileOfAuth = new Map((auths ?? []).map((a) => [a.id as string, a.file_id as string]));
  const { data: visas } = await admin
    .from("expense_visa")
    .select("authorization_id, decision, decided_at")
    .eq("tenant_id", tenantId)
    .in("authorization_id", [...fileOfAuth.keys()]);

  // One authorization counts ONCE, at its first approving visa — an approval
  // chain of several signatures is one authorization obtained, not several.
  const firstApproval = new Map<string, string>();
  for (const v of visas ?? []) {
    if (String(v.decision) !== "APPROVED") continue;
    const authId = v.authorization_id as string;
    const at = v.decided_at as string;
    if (!at) continue;
    const cur = firstApproval.get(authId);
    if (!cur || at < cur) firstApproval.set(authId, at);
  }

  return [...firstApproval.entries()].map(([authId, at]) => ({
    fileId: fileOfAuth.get(authId)!,
    atISO: at,
    term: "NAD" as IcamTerm,
  }));
}

/** NCOUR — physical recoveries, at the custody event's own instant. */
async function courierActivities(
  tenantId: string,
  fileIds: readonly string[],
): Promise<TermActivity[]> {
  if (fileIds.length === 0) return [];
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("invoice_deposit_event")
    .select("file_id, deposit_id, event, to_status, occurred_at")
    .eq("tenant_id", tenantId)
    .in("file_id", fileIds)
    .eq("to_status", "DEPOSITED");

  // One deposit = one physical recovery. The custody ladder passes through
  // DEPOSITED once per deposit; counting every custody event instead would
  // score the same run up to eight times.
  const firstPerDeposit = new Map<string, { fileId: string; atISO: string }>();
  for (const e of data ?? []) {
    const key = e.deposit_id as string;
    const at = e.occurred_at as string;
    const cur = firstPerDeposit.get(key);
    if (!cur || at < cur.atISO) firstPerDeposit.set(key, { fileId: e.file_id as string, atISO: at });
  }
  return [...firstPerDeposit.values()].map((v) => ({ ...v, term: "NCOUR" as IcamTerm }));
}

// ------------------------------------------------------------- assembly ----

/**
 * ICAM per dossier for the period's CLOSED population, split by the Account
 * Manager who owned the dossier when each act occurred.
 */
export async function icamDossiers(
  tenantId: string,
  period: PerformancePeriod,
): Promise<IcamDossierRow[]> {
  const closedAt = await closedDossiers(tenantId, period);
  const fileIds = [...closedAt.keys()];
  if (fileIds.length === 0) return [];

  const admin = getAdminSupabaseClient();
  const [files, timelines, docActs, nadActs, courActs] = await Promise.all([
    admin.from("operational_file").select("id, file_number").eq("tenant_id", tenantId).in("id", fileIds),
    ownershipTimelines(tenantId, fileIds),
    verifiedDocumentActivities(tenantId, fileIds),
    visaActivities(tenantId, fileIds),
    courierActivities(tenantId, fileIds),
  ]);
  const numberOf = new Map((files.data ?? []).map((f) => [f.id as string, f.file_number as string]));

  const all = [...docActs, ...nadActs, ...courActs];
  const { byOwner, unattributable } = attributeByActTime(all, timelines);

  // Regroup: dossier → owner → per-term counts.
  const perFile = new Map<string, Map<string, Partial<Record<IcamTerm, number>>>>();
  for (const [userId, acts] of byOwner) {
    for (const a of acts) {
      const owners = perFile.get(a.fileId) ?? new Map();
      const counts = owners.get(userId) ?? {};
      counts[a.term] = (counts[a.term] ?? 0) + 1;
      owners.set(userId, counts);
      perFile.set(a.fileId, owners);
    }
  }
  const droppedPerFile = new Map<string, Partial<Record<IcamTerm, number>>>();
  for (const a of unattributable) {
    const d = droppedPerFile.get(a.fileId) ?? {};
    d[a.term] = (d[a.term] ?? 0) + 1;
    droppedPerFile.set(a.fileId, d);
  }

  return fileIds.map((fileId) => {
    const owners = perFile.get(fileId) ?? new Map<string, Partial<Record<IcamTerm, number>>>();
    const dropped = droppedPerFile.get(fileId) ?? {};

    const byOwnerResults = [...owners.entries()].map(([userId, counts]) => {
      // Sourced terms present as numbers (0 included: a MEASURED zero).
      // Unsourced terms are OMITTED, so the engine marks them
      // SOURCE_UNAVAILABLE rather than reporting a zero nobody measured.
      const icamCounts: IcamCounts = { unattributable: dropped };
      for (const t of ICAM1_SOURCED_TERMS) icamCounts[t] = counts[t] ?? 0;
      return { userId, result: computeIcamDossier(icamCounts) };
    });

    return {
      fileId,
      fileNumber: numberOf.get(fileId) ?? "—",
      closedAtISO: closedAt.get(fileId) ?? null,
      byOwner: byOwnerResults,
      unattributableActs: Object.values(dropped).reduce((a: number, b) => a + (b ?? 0), 0),
    };
  });
}

/** ICAM per Account Manager for the period. */
export async function icamByCollaborator(
  tenantId: string,
  period: PerformancePeriod,
): Promise<IcamCollaboratorRow[]> {
  const rows = await icamDossiers(tenantId, period);
  const acc = new Map<string, { total: number; files: Set<string>; unavailable: Set<IcamTerm> }>();

  for (const row of rows) {
    for (const { userId, result } of row.byOwner) {
      const cur = acc.get(userId) ?? { total: 0, files: new Set<string>(), unavailable: new Set<IcamTerm>() };
      cur.total += result.icam;
      cur.files.add(row.fileId);
      for (const t of result.unavailableTerms) cur.unavailable.add(t);
      acc.set(userId, cur);
    }
  }

  return [...acc.entries()]
    .map(([userId, v]) => ({
      userId,
      dossierCount: v.files.size,
      icamTotal: Math.round(v.total * 100) / 100,
      basisComplete: v.unavailable.size === 0,
      unavailableTerms: [...v.unavailable],
    }))
    .sort((a, b) => b.icamTotal - a.icamTotal);
}

/**
 * A dossier's PROVISIONAL ICAM, open or closed. For a live per-dossier view
 * only — it deliberately does not consult the closure population, and its
 * result must never be summed into a month. F-ICAM-05 lives in
 * `icamDossiers`, which is the only door to the monthly figures.
 */
export async function provisionalIcamForFile(
  tenantId: string,
  fileId: string,
): Promise<IcamDossierRow | null> {
  const admin = getAdminSupabaseClient();
  const { data: file } = await admin
    .from("operational_file")
    .select("id, file_number")
    .eq("id", fileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!file) return null;

  const [timelines, docActs, nadActs, courActs] = await Promise.all([
    ownershipTimelines(tenantId, [fileId]),
    verifiedDocumentActivities(tenantId, [fileId]),
    visaActivities(tenantId, [fileId]),
    courierActivities(tenantId, [fileId]),
  ]);
  const { byOwner, unattributable } = attributeByActTime(
    [...docActs, ...nadActs, ...courActs],
    timelines,
  );

  const dropped: Partial<Record<IcamTerm, number>> = {};
  for (const a of unattributable) dropped[a.term] = (dropped[a.term] ?? 0) + 1;

  const byOwnerResults = [...byOwner.entries()].map(([userId, acts]) => {
    const counts: IcamCounts = { unattributable: dropped };
    for (const t of ICAM1_SOURCED_TERMS) counts[t] = acts.filter((a) => a.term === t).length;
    return { userId, result: computeIcamDossier(counts) };
  });

  return {
    fileId,
    fileNumber: file.file_number as string,
    closedAtISO: null, // provisional: the caller must not treat this as a month
    byOwner: byOwnerResults,
    unattributableActs: unattributable.length,
  };
}
