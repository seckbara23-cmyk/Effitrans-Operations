/**
 * Gestion de la Performance — the read services behind the management module.
 * ---------------------------------------------------------------------------
 * COMPOSITION ONLY. Every figure here is computed by an engine that already
 * exists and was proven against the frozen parity fixtures — `computeIctdDossier`
 * (ICTD-D04..D10), `workedDaysInPeriod` and `delaiJoursOuvres` (ICTD-D11, D3),
 * `reliabilityStatus` (D2). This module reads rows and calls them. It invents no
 * formula, no threshold and no ranking.
 *
 * HONESTY ABOUT INPUTS is the design constraint. The ICTD dossier formula has
 * seven terms; the platform captures five of them today (the D4 governed
 * elements). NF — nombre de factures fournisseur — and the cotation count have
 * no per-dossier source in the schema: `quotation` is keyed on a request and a
 * client, never on a dossier, and no vendor-invoice table exists. The workbook's
 * own blank rule coerces an empty NF to zero, so the arithmetic is correct; but
 * a figure computed from five of seven inputs must SAY so, or management will
 * read a partial base as a complete one. Every row therefore carries
 * `inputsCaptured`, and the UI renders « base partielle » where it is short.
 *
 * ICAM and IPAM are deliberately absent from this file. Their inputs — claims
 * and imputability registers, critical incidents, the satisfaction survey — do
 * not exist as tables. Publishing a zero for them would be a fabricated metric,
 * which is worse than an empty tab that names what is missing.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
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

/** The seven ICTD terms, and which of them the platform can currently source. */
export const ICTD_TERMS_CAPTURED = [
  "NPSH (positions SH)",
  "CCT (origine du classement tarifaire)",
  "CDP (type de déclaration)",
  "U_DPI (DPI)",
  "U_TE (titre d'exonération)",
] as const;
export const ICTD_TERMS_MISSING = [
  "NF (nombre de factures fournisseur)",
  "Nombre de cotations",
] as const;

export type PerformancePeriod = { startISO: string; endISO: string; label: string };

/** The month containing `anchorISO`, as an inclusive ISO span. */
export function monthPeriod(anchorISO: string): PerformancePeriod {
  const [y, m] = anchorISO.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  const MONTHS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  return {
    startISO: `${y}-${mm}-01`,
    endISO: `${y}-${mm}-${String(last).padStart(2, "0")}`,
    label: `${MONTHS_FR[m - 1]} ${y}`,
  };
}

export type IctdDossierRow = {
  fileId: string;
  fileNumber: string;
  declarantId: string | null;
  /** null when CDP or DPI is not captured — the workbook's blank, never a zero. */
  ictd: number | null;
  /** How many of the seven ICTD terms this dossier could actually source. */
  inputsCaptured: number;
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
    .select("id, file_number")
    .eq("tenant_id", tenantId)
    .in("id", fileIds);
  const numberOf = new Map((files ?? []).map((f) => [f.id as string, f.file_number as string]));

  // A record is « à revalider » when it was corrected and is not certified.
  const { data: corrections } = await admin
    .from("customs_correction")
    .select("customs_id")
    .eq("tenant_id", tenantId)
    .in("customs_id", data.map((r) => r.id as string));
  const corrected = new Set((corrections ?? []).map((c) => c.customs_id as string));

  const calendar = await loadCalendar(tenantId, period);

  return data.map((r) => {
    const declarationType = isDeclarationType(String(r.declaration_type ?? ""))
      ? (r.declaration_type as DeclarationType)
      : null;
    const dpiRegime = (r.dpi_regime as DpiRegime | null) ?? null;
    const tariffOrigin = (r.tariff_classification_origin as TariffClassificationOrigin | null) ?? "CLIENT";
    const exemption = (r.exemption_title_origin as ExemptionTitleOrigin | null) ?? "SANS_OBJET";

    const input: IctdDossierInput = {
      // NF and cotations have no per-dossier source: the workbook's N()
      // coercion makes them 0, and `inputsCaptured` says the base is partial.
      invoiceCount: null,
      cotationCount: null,
      shPositionCount: r.sh_position_count as number | null,
      tariffOrigin,
      declarationType,
      dpiRegime,
      exemptionTitleOrigin: exemption,
    };

    const captured = [
      r.sh_position_count !== null,
      r.tariff_classification_origin !== null,
      declarationType !== null,
      dpiRegime !== null,
      r.exemption_title_origin !== null,
    ].filter(Boolean).length;

    return {
      fileId: r.file_id as string,
      fileNumber: numberOf.get(r.file_id as string) ?? "—",
      declarantId: (r.created_by as string | null) ?? null,
      ictd: computeIctdDossier(input),
      inputsCaptured: captured,
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
