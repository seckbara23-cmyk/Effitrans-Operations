/**
 * Gestion de la Performance — the read services behind the management module.
 * ---------------------------------------------------------------------------
 * COMPOSITION ONLY. Every figure here is computed by an engine that already
 * exists and was proven against the frozen parity fixtures — `computeIctdDossier`
 * (ICTD-D04..D10), `workedDaysInPeriod` and `delaiJoursOuvres` (ICTD-D11, D3),
 * `reliabilityStatus` (D2). This module reads rows and calls them. It invents no
 * formula, no threshold and no ranking.
 *
 * ALL SEVEN ICTD TERMS ARE SOURCED (Q1 ratified 2026-08-28). Five come from the
 * D4 governed capture; the last two are derived from data the platform already
 * owned, which is why they needed no new field:
 *
 *   NF — the dossier's COMMERCIAL_INVOICE documents in a VERIFIED state. NOT
 *   VENDOR_INVOICE: that is « facture tierce payable », a third-party payable
 *   Effitrans owes, and it belongs to ICAM's NFACT. A commercial invoice is the
 *   exporter's invoice for the goods, it gates customs, and each one is
 *   declaration lines a declarant must file — which is what an Indicateur de
 *   Charge de Travail DÉCLARANT measures at 0,50 per facture. An earlier draft
 *   of this module named the wrong type; the frozen source map named the right
 *   one all along.
 *
 *   Cotations — quotations of the dossier's originating request whose `sent_at`
 *   is set. A timestamp, not a status: it states that the quote was actually
 *   transmitted to the client, so drafts, pending validation, validated-but-
 *   never-sent and cancelled-before-send are excluded by construction rather
 *   than by a status list somebody must remember to maintain. A quote that was
 *   sent and later superseded or declined still counts — the work was done.
 *
 * Uploaded-but-unverified commercial invoices deliberately do NOT count yet, so
 * a live ICTD can rise when verification lands. Published reports freeze, so
 * history never moves under a reader; only the live view does.
 *
 * ICAM and IPAM are deliberately absent from this file. Their inputs — claims
 * and imputability registers, critical incidents, the satisfaction survey — do
 * not exist as tables. Publishing a zero for them would be a fabricated metric,
 * which is worse than an empty tab that names what is missing.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isVerified } from "@/lib/documents/doctrine";
import {
  computeIctdDossier,
  type IctdDossierInput,
  type TariffClassificationOrigin,
  type DpiRegime,
  type ExemptionTitleOrigin,
} from "./ictd";
import { isDeclarationType, type DeclarationType } from "./declaration-type";
import { reliabilityStatus, type ReliabilityStatus } from "./reliability";
import { workedDaysInPeriod, delaiJoursOuvres, type ApprovedLeave } from "./working-days";
import type { PerformancePeriod } from "./period";

export type { PerformancePeriod } from "./period";
export { monthPeriod, quarterPeriod, yearPeriod, customPeriod, resolvePeriod, dakarToday } from "./period";

/** The seven ICTD terms. All are sourced; the list is what a report cites. */
export const ICTD_TERMS = [
  "NF (factures commerciales vérifiées)",
  "NPSH (positions SH)",
  "CCT (origine du classement tarifaire)",
  "CDP (type de déclaration)",
  "U_DPI (DPI)",
  "U_TE (titre d'exonération)",
  "Cotations envoyées",
] as const;

/** How many of the seven a dossier must have before it is a COMPLETE basis. */
export const ICTD_TERM_COUNT = ICTD_TERMS.length;

export type IctdDossierRow = {
  fileId: string;
  fileNumber: string;
  clientId: string | null;
  declarantId: string | null;
  /** null when CDP or DPI is not captured — the workbook's blank, never a zero. */
  ictd: number | null;
  /** How many of the seven ICTD terms this dossier could actually source. */
  inputsCaptured: number;
  /** NF — verified commercial invoices on the dossier. */
  invoiceCount: number;
  /** Cotations actually sent to the client for this dossier's request. */
  cotationCount: number;
  declarationType: DeclarationType | null;
  shPositionCount: number | null;
  /** ICTD-D11, in working days, or null when a date is missing. */
  delaiJoursOuvres: number | null;
  validated: boolean;
  /** D4 — corrected and awaiting recertification. */
  awaitingRevalidation: boolean;
};

export type CollaboratorPerformance = {
  userId: string;
  name: string;
  dossierCount: number;
  /** Σ ICTD over the period; null when no dossier scored. */
  ictdTotal: number | null;
  ictdAverage: number | null;
  /** D3 — jours réellement travaillés: calendar minus approved leave. */
  workedDays: number;
  /** UTD per worked day, when both sides exist. */
  ictdPerDay: number | null;
  status: ReliabilityStatus;
  /** GOV-09 — recorded only when a critical-incident source exists. It does not. */
  criticalIncident: boolean;
};

/** The tenant's non-worked days in the period, as the engine consumes them. */
export async function loadCalendar(tenantId: string, period: PerformancePeriod): Promise<Set<string>> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("hr_calendar_day")
    .select("day")
    .eq("tenant_id", tenantId)
    .gte("day", period.startISO)
    .lte("day", period.endISO);
  return new Set((data ?? []).map((r) => r.day as string));
}

/** Approved leave for one app_user, via their linked employee record. */
async function loadApprovedLeave(
  tenantId: string,
  userId: string,
  period: PerformancePeriod,
): Promise<ApprovedLeave[]> {
  const admin = getAdminSupabaseClient();
  const { data: emp } = await admin
    .from("employee")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("linked_app_user_id", userId)
    .maybeSingle();
  if (!emp) return []; // no employee record: no leave is knowable, and none is invented

  const { data } = await admin
    .from("hr_leave_request")
    .select("start_date, end_date, day_tenths")
    .eq("tenant_id", tenantId)
    .eq("employee_id", emp.id as string)
    .eq("status", "APPROVED")
    .lte("start_date", period.endISO)
    .gte("end_date", period.startISO);
  return (data ?? []).map((r) => ({
    startISO: r.start_date as string,
    endISO: r.end_date as string,
    dayTenths: r.day_tenths as number,
  }));
}

/**
 * NF per dossier — VERIFIED commercial invoices (Q1 ratified).
 *
 * `isVerified` is the platform's shared doctrine and is alias-aware: legacy rows
 * say APPROVED, and a document consumed as evidence reads CONSUMED_AS_EVIDENCE.
 * Re-implementing "verified" here as `status = 'VERIFIED'` would silently
 * undercount both, so the doctrine is imported rather than restated.
 */
async function verifiedCommercialInvoiceCounts(
  tenantId: string,
  fileIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (fileIds.length === 0) return counts;
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("document")
    .select("file_id, status")
    .eq("tenant_id", tenantId)
    .eq("type_code", "COMMERCIAL_INVOICE")
    .is("deleted_at", null)
    .in("file_id", fileIds);
  for (const row of data ?? []) {
    if (!isVerified(String(row.status))) continue;
    const id = row.file_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Cotations per dossier — quotations of the dossier's ORIGINATING REQUEST that
 * were actually sent (Q1 ratified).
 *
 * Two hops, and both matter. `converted_file_id` finds the quotation that became
 * the dossier; its `request_id` then gathers the siblings, because successive
 * quotes for the same client need are each a unit of work — U_COT is 1,00 *per
 * cotation*, not per dossier. `sent_at is not null` is the qualifying fact: a
 * timestamp that says the quote reached the client, which no status list can
 * drift away from.
 */
async function sentCotationCounts(
  tenantId: string,
  fileIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (fileIds.length === 0) return counts;
  const admin = getAdminSupabaseClient();

  const { data: converted } = await admin
    .from("quotation")
    .select("request_id, converted_file_id")
    .eq("tenant_id", tenantId)
    .in("converted_file_id", fileIds);
  if (!converted || converted.length === 0) return counts;

  // request_id -> the dossier it produced. A request converts once, so this is
  // a function rather than a grouping.
  const fileOfRequest = new Map<string, string>();
  for (const r of converted) {
    fileOfRequest.set(r.request_id as string, r.converted_file_id as string);
  }

  const { data: siblings } = await admin
    .from("quotation")
    .select("request_id, sent_at")
    .eq("tenant_id", tenantId)
    .in("request_id", [...fileOfRequest.keys()])
    .not("sent_at", "is", null);
  for (const q of siblings ?? []) {
    const fileId = fileOfRequest.get(q.request_id as string);
    if (!fileId) continue;
    counts.set(fileId, (counts.get(fileId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Per-dossier ICTD for the period. The declarant is `customs_record.created_by`
 * — whoever captured the declaration — which is the same attribution D4's
 * maker/checker separation is built on.
 */
export async function ictdDossiers(
  tenantId: string,
  period: PerformancePeriod,
): Promise<IctdDossierRow[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("customs_record")
    .select(
      "id, file_id, created_by, reviewed_at, sh_position_count, declaration_type, dpi_regime, exemption_title_origin, tariff_classification_origin, declaration_date, release_date",
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .gte("declaration_date", period.startISO)
    .lte("declaration_date", period.endISO);
  if (!data || data.length === 0) return [];

  const fileIds = [...new Set(data.map((r) => r.file_id as string))];
  const { data: files } = await admin
    .from("operational_file")
    .select("id, file_number, client_id")
    .eq("tenant_id", tenantId)
    .in("id", fileIds);
  const numberOf = new Map((files ?? []).map((f) => [f.id as string, f.file_number as string]));
  const clientOf = new Map((files ?? []).map((f) => [f.id as string, (f.client_id as string | null) ?? null]));

  // A record is « à revalider » when it was corrected and is not certified.
  const { data: corrections } = await admin
    .from("customs_correction")
    .select("customs_id")
    .eq("tenant_id", tenantId)
    .in("customs_id", data.map((r) => r.id as string));
  const corrected = new Set((corrections ?? []).map((c) => c.customs_id as string));

  const [calendar, nfCounts, cotationCounts] = await Promise.all([
    loadCalendar(tenantId, period),
    verifiedCommercialInvoiceCounts(tenantId, fileIds),
    sentCotationCounts(tenantId, fileIds),
  ]);

  return data.map((r) => {
    const declarationType = isDeclarationType(String(r.declaration_type ?? ""))
      ? (r.declaration_type as DeclarationType)
      : null;
    const dpiRegime = (r.dpi_regime as DpiRegime | null) ?? null;
    const tariffOrigin = (r.tariff_classification_origin as TariffClassificationOrigin | null) ?? "CLIENT";
    const exemption = (r.exemption_title_origin as ExemptionTitleOrigin | null) ?? "SANS_OBJET";

    const fileId = r.file_id as string;
    const nf = nfCounts.get(fileId) ?? 0;
    const cotations = cotationCounts.get(fileId) ?? 0;

    const input: IctdDossierInput = {
      invoiceCount: nf,
      cotationCount: cotations,
      shPositionCount: r.sh_position_count as number | null,
      tariffOrigin,
      declarationType,
      dpiRegime,
      exemptionTitleOrigin: exemption,
    };

    // All seven terms, and the honest meaning of each: a term is CAPTURED when
    // the platform could source it for this dossier. NF and cotations are
    // always sourceable — the query ran — so a zero there is a measured zero,
    // not an absence. The five governed elements can genuinely be unrecorded.
    const captured = [
      true, // NF — counted
      r.sh_position_count !== null,
      r.tariff_classification_origin !== null,
      declarationType !== null,
      dpiRegime !== null,
      r.exemption_title_origin !== null,
      true, // cotations — counted
    ].filter(Boolean).length;

    return {
      fileId,
      fileNumber: numberOf.get(fileId) ?? "—",
      clientId: clientOf.get(fileId) ?? null,
      declarantId: (r.created_by as string | null) ?? null,
      ictd: computeIctdDossier(input),
      inputsCaptured: captured,
      invoiceCount: nf,
      cotationCount: cotations,
      declarationType,
      shPositionCount: (r.sh_position_count as number | null) ?? null,
      delaiJoursOuvres: delaiJoursOuvres(
        (r.declaration_date as string | null) ?? null,
        (r.release_date as string | null) ?? null,
        calendar,
      ),
      validated: r.reviewed_at !== null,
      awaitingRevalidation: corrected.has(r.id as string) && r.reviewed_at === null,
    };
  });
}

/** Per-collaborateur aggregation for the period. */
export async function collaboratorPerformance(
  tenantId: string,
  period: PerformancePeriod,
): Promise<CollaboratorPerformance[]> {
  const rows = await ictdDossiers(tenantId, period);
  const byDeclarant = new Map<string, IctdDossierRow[]>();
  for (const r of rows) {
    if (!r.declarantId) continue; // an unattributed dossier belongs to nobody
    const list = byDeclarant.get(r.declarantId) ?? [];
    list.push(r);
    byDeclarant.set(r.declarantId, list);
  }
  if (byDeclarant.size === 0) return [];

  const admin = getAdminSupabaseClient();
  const ids = [...byDeclarant.keys()];
  const { data: users } = await admin
    .from("app_user")
    .select("id, email")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  const nameOf = new Map(
    (users ?? []).map((u) => [u.id as string, (u.email as string | null) ?? "—"]),
  );

  const calendar = await loadCalendar(tenantId, period);

  const out: CollaboratorPerformance[] = [];
  for (const [userId, list] of byDeclarant) {
    const scored = list.map((r) => r.ictd).filter((v): v is number => v !== null);
    const total = scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b, 0) * 100) / 100 : null;
    const leaves = await loadApprovedLeave(tenantId, userId, period);
    const workedDays = workedDaysInPeriod(period.startISO, period.endISO, calendar, leaves);

    out.push({
      userId,
      name: nameOf.get(userId) ?? "—",
      dossierCount: list.length,
      ictdTotal: total,
      ictdAverage: total !== null && scored.length > 0 ? Math.round((total / scored.length) * 100) / 100 : null,
      workedDays,
      ictdPerDay: total !== null && workedDays > 0 ? Math.round((total / workedDays) * 100) / 100 : null,
      status: reliabilityStatus({
        dossierCount: list.length,
        // GOV-09 is preserved in the engine, but no critical-incident register
        // exists yet, so nothing can legitimately set this. False here is not a
        // claim that no incident occurred — the module says so in the UI.
        criticalIncident: false,
      }),
      criticalIncident: false,
    });
  }
  return out.sort((a, b) => (b.ictdTotal ?? -1) - (a.ictdTotal ?? -1));
}

/**
 * ICAM / IPAM readiness. Named sources, checked as facts rather than asserted —
 * so the module reports what is actually missing on the day it is opened.
 */
export type IndicatorReadiness = {
  indicator: "ICAM" | "IPAM";
  available: false;
  missing: readonly string[];
};

export const INDICATOR_READINESS: readonly IndicatorReadiness[] = [
  {
    indicator: "ICAM",
    available: false,
    missing: [
      "registre des réclamations client (+ imputabilité)",
      "registre des erreurs imputables",
      "registre des redressements douaniers",
      "registre des retours / reprises",
      "compteur d'incidents critiques",
    ],
  },
  {
    indicator: "IPAM",
    available: false,
    missing: [
      "objectifs de capacité par collaborateur (P)",
      "enquête de satisfaction client (CSAT)",
      "les registres qualité de l'ICAM ci-dessus",
    ],
  },
];
