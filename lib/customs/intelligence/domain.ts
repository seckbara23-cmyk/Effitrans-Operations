/**
 * Customs Intelligence — domain model (Phase 7.1A). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * The reusable model for the PROVIDER-DRIVEN customs process (what GAINDE / ORBUS will drive
 * in 7.1B), distinct from the existing INTERNAL operational status (lib/customs/status.ts).
 * It REUSES the existing customs_record (the Declaration's persistence) and the operational
 * file / shipment / finance / document entities — this layer adds types + logic, not tables.
 * Nothing here touches the DB; a pure mapper turns the stored record into a Declaration.
 */
import type { CustomsRecord } from "@/lib/customs/types";
import type { DeclarationStatus } from "./state-machine";

export type CustomsOffice = { code: string; name: string | null };
export type Broker = { id: string; name: string; licenseNumber: string | null };
export type Container = { number: string; type: string | null; sealNumber: string | null };
export type Inspection = { required: boolean; status: "NOT_REQUIRED" | "PENDING" | "PASSED" | "FAILED"; scheduledAt: string | null };
export type Duty = { code: string; label: string; amount: number; currency: string };
export type Payment = { id: string; amount: number; currency: string; status: "PENDING" | "PAID" | "REVERSED"; paidAt: string | null };
export type Release = { reference: string; releasedAt: string | null };
export type Transit = { mode: string | null; origin: string | null; destination: string | null };

/** Which external system a declaration is bound to. */
export type CustomsProviderRef = { provider: string; externalReference: string | null; submittedAt: string | null };

export type Declaration = {
  id: string;
  fileId: string;
  reference: string | null;
  status: DeclarationStatus;
  office: CustomsOffice | null;
  regime: string | null;
  broker: Broker | null;
  containers: Container[];
  inspection: Inspection;
  duties: Duty[];
  payments: Payment[];
  release: Release | null;
  transit: Transit | null;
  provider: CustomsProviderRef;
  declarationDate: string | null;
};

/**
 * Map the existing operational customs_record + the canonical intelligence status into a
 * Declaration. The provider-driven status is passed in (resolved by the engine, not stored
 * on the record yet), defaulting to DRAFT — so this foundation never contradicts the
 * existing operational status. Related entities (containers, duties, payments, transit)
 * come from their authoritative sources; empty until 7.1B wires them.
 */
export function toDeclaration(
  record: CustomsRecord,
  intel: {
    status: DeclarationStatus;
    provider?: CustomsProviderRef;
    broker?: Broker | null;
    containers?: Container[];
    duties?: Duty[];
    payments?: Payment[];
    transit?: Transit | null;
  },
): Declaration {
  return {
    id: record.id,
    fileId: record.fileId,
    reference: record.declarationNumber,
    status: intel.status,
    office: record.customsOffice ? { code: record.customsOffice, name: null } : null,
    regime: record.regime,
    broker: intel.broker ?? null,
    containers: intel.containers ?? [],
    inspection: {
      required: record.required,
      status: record.inspectionStatus,
      scheduledAt: null,
    },
    duties: intel.duties ?? [],
    payments: intel.payments ?? [],
    release: record.baeReference ? { reference: record.baeReference, releasedAt: record.releaseDate } : null,
    transit: intel.transit ?? null,
    provider: intel.provider ?? { provider: "manual", externalReference: record.externalRef, submittedAt: null },
    declarationDate: record.declarationDate,
  };
}
