/**
 * ICAM-1 — the read contract: derive the four sourced terms, attribute each
 * qualifying act to the Account Manager who owned the dossier at the time, and
 * roll up by closure month.
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIVERS AND WHAT IT DOES NOT. Six of the eight terms have
 * authoritative sources — NDOC, NFACT, NAD, NCOUR, NINC (ICAM-2) and NPAY
 * (ICAM-2B). NREP and NCOORD are blocked on business definitions Effitrans has
 * not ratified, and are reported as SOURCE_UNAVAILABLE — never as zero — so
 * every result still says its basis is incomplete. It is.
 *
 * NPAY IS THE ONE THAT MEASURES ZERO RATHER THAN NOTHING. « Paiements en
 * ligne » is ratified as {WAVE, ORANGE_MONEY} (Q5-R), a vocabulary the payment
 * register already carries. A dossier with no mobile-money payment therefore
 * has NPAY = 0 OBSERVED, not NPAY unknown — the register's silence is a
 * measurement, because the register is where an online payment would be. That
 * distinction is the whole point of Q14 and must survive to the reader.
 *
 * THE ACTIVITY INSTANT IS THE HARD PART, and it differs per term:
 *
 *   NAD   `expense_visa.decided_at`         — the visa decision, on its own row
 *   NCOUR `invoice_deposit_event.occurred_at` — the custody event, on its own row
 *   NINC  `operational_incident.treated_at`   — TREATMENT COMPLETION (R2), not
 *         the recording and not the adjudication. « Traité » is a distinct act
 *         (R1), so the instant that carries the workload is the moment the
 *         Account Manager finished handling the return.
 *   NPAY  `payment.verified_at`               — the VERIFICATION instant, and
 *         deliberately NOT `paid_at`. `paid_at` is a DATE, it is supplied by
 *         whoever records the payment, and it can be back-dated — so using it
 *         would let a data-entry choice move a colleague's credit into a month
 *         they did not own the dossier. `verified_at` is written by the server
 *         when Finance confirms the money, and it is paired with `verified_by`.
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
export const ICAM1_SOURCED_TERMS: readonly IcamTerm[] = ["NDOC", "NFACT", "NAD", "NCOUR", "NINC", "NPAY"];
export const ICAM1_UNSOURCED_TERMS: readonly IcamTerm[] = ["NREP", "NCOORD"];

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

/**
 * THE NINC ELIGIBILITY PREDICATE — one authoritative definition, here and
 * nowhere else. The frozen term is « retours / non-conformités NON imputables
 * traités », and every word of it is a condition:
 *
 *   status       = 'TRAITE'      — traité: the treatment-completion act (R1)
 *   imputability = 'NON'         — NON imputable, definitively
 *   decided_at  IS NOT NULL      — and that verdict is FINAL: EN_ANALYSE is not
 *                                  a decision, and a governed correction clears
 *                                  finality until someone else confirms it
 *
 * ANNULE is excluded by the status test. OUI and NON_EVALUE are excluded by the
 * imputability test — an incident imputable to the Account Manager contributes
 * nothing (F-ICAM-06), while remaining recorded and available to IPAM later.
 *
 * Expressed as a query filter rather than a TypeScript predicate so the
 * database does the counting; the shape is asserted by tests so it cannot drift
 * into the UI or into three different places.
 */
export const NINC_ELIGIBILITY = {
  status: "TRAITE",
  imputability: "NON",
} as const;

/**
 * NINC — treated, definitively non-imputable incidents, at their TREATMENT
 * instant. Each distinct incident counts once (Q10 allows several per dossier;
 * the frozen 0,50/1,00 plafond does the bounding).
 */
async function incidentActivities(
  tenantId: string,
  fileIds: readonly string[],
): Promise<TermActivity[]> {
  if (fileIds.length === 0) return [];
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("operational_incident")
    .select("id, file_id, treated_at")
    .eq("tenant_id", tenantId)
    .in("file_id", fileIds)
    .eq("status", NINC_ELIGIBILITY.status)
    .eq("imputability", NINC_ELIGIBILITY.imputability)
    .not("imputability_decided_at", "is", null);

  // One row per incident already: the register holds one record per event, so
  // there is nothing to de-duplicate — but the id is carried so a future join
  // cannot silently multiply it.
  const seen = new Set<string>();
  const out: TermActivity[] = [];
  for (const r of data ?? []) {
    const id = r.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      fileId: r.file_id as string,
      atISO: (r.treated_at as string | null) ?? null,
      term: "NINC" as IcamTerm,
    });
  }
  return out;
}

/**
 * THE « EN LIGNE » VOCABULARY, ratified by Q5-R. A WHITELIST, never a blacklist:
 * a payment method the methodology has not admitted must not start counting
 * because somebody added it to a CHECK constraint. CASH, BANK_TRANSFER, CHEQUE
 * and OTHER are excluded by construction rather than by being listed anywhere.
 *
 * This is the platform's own definition of an online rail, not an invention:
 * `payment_intent.provider` admits exactly WAVE, ORANGE_MONEY and MOCK.
 */
export const NPAY_ONLINE_METHODS = ["WAVE", "ORANGE_MONEY"] as const;

/**
 * THE QUALIFYING PAYMENT STATE. Both conditions are required and neither
 * implies the other:
 *
 *   verification_status = 'VERIFIED'  — Finance confirmed the money arrived.
 *                                       PENDING is a claim, not a receipt.
 *   reversed_at IS NULL              — and it was not undone. REJECTED sets
 *                                       `reversed_at` too, so this single test
 *                                       excludes both reversals and rejections,
 *                                       and matches the platform's own paid
 *                                       total (Σ non-reversed).
 */
export const NPAY_ELIGIBILITY = { verificationStatus: "VERIFIED" } as const;

/**
 * NPAY — verified, non-reversed online payments, at their VERIFICATION instant.
 *
 * A payment carries no dossier of its own: it belongs to an invoice, and the
 * invoice carries `file_id` — which is NULLABLE, so an invoice with no dossier
 * simply contributes nothing rather than being guessed at.
 *
 * DISJOINTNESS (Q13). This function reads `payment` and `invoice` and nothing
 * else. It can therefore never inherit an act already counted elsewhere: NAD
 * lives on `expense_visa` (an outgoing expense approval — `payment` rows are
 * written in exactly one place, `recordPayment`, and never from the expense
 * lane), NFACT on controlled vendor invoices, NCOUR on the physical custody
 * event. Confirming that money arrived is its own decision, by its own role.
 */
async function onlinePaymentActivities(
  tenantId: string,
  fileIds: readonly string[],
): Promise<TermActivity[]> {
  if (fileIds.length === 0) return [];
  const admin = getAdminSupabaseClient();
  const { data: invoices } = await admin
    .from("invoice")
    .select("id, file_id")
    .eq("tenant_id", tenantId)
    .in("file_id", fileIds);
  if (!invoices || invoices.length === 0) return [];

  const fileOfInvoice = new Map(
    invoices.map((i) => [i.id as string, i.file_id as string]),
  );

  const { data } = await admin
    .from("payment")
    .select("id, invoice_id, verified_at")
    .eq("tenant_id", tenantId)
    .in("invoice_id", [...fileOfInvoice.keys()])
    .in("method", [...NPAY_ONLINE_METHODS])
    .eq("verification_status", NPAY_ELIGIBILITY.verificationStatus)
    .is("reversed_at", null);

  const seen = new Set<string>();
  const out: TermActivity[] = [];
  for (const r of data ?? []) {
    const id = r.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const fileId = fileOfInvoice.get(r.invoice_id as string);
    if (!fileId) continue;
    out.push({
      fileId,
      // No CHECK binds VERIFIED to an instant, so a verified payment without
      // one is NOT_ATTRIBUTABLE. It is never dated from `paid_at` or `now`.
      atISO: (r.verified_at as string | null) ?? null,
      term: "NPAY" as IcamTerm,
    });
  }
  return out;
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
  const [files, timelines, docActs, nadActs, courActs, nincActs, npayActs] = await Promise.all([
    admin.from("operational_file").select("id, file_number").eq("tenant_id", tenantId).in("id", fileIds),
    ownershipTimelines(tenantId, fileIds),
    verifiedDocumentActivities(tenantId, fileIds),
    visaActivities(tenantId, fileIds),
    courierActivities(tenantId, fileIds),
    incidentActivities(tenantId, fileIds),
    onlinePaymentActivities(tenantId, fileIds),
  ]);
  const numberOf = new Map((files.data ?? []).map((f) => [f.id as string, f.file_number as string]));

  const all = [...docActs, ...nadActs, ...courActs, ...nincActs, ...npayActs];
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

  const [timelines, docActs, nadActs, courActs, nincActs, npayActs] = await Promise.all([
    ownershipTimelines(tenantId, [fileId]),
    verifiedDocumentActivities(tenantId, [fileId]),
    visaActivities(tenantId, [fileId]),
    courierActivities(tenantId, [fileId]),
    incidentActivities(tenantId, [fileId]),
    onlinePaymentActivities(tenantId, [fileId]),
  ]);
  const { byOwner, unattributable } = attributeByActTime(
    [...docActs, ...nadActs, ...courActs, ...nincActs, ...npayActs],
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
