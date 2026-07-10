/**
 * Portal shared types (Phase 1.12A). Client + server safe.
 */
import type { PortalRole, PortalUserStatus } from "./access";
import type { PortalStageKey } from "./progress-map";
import type { Availability } from "./shipment-view";
import type { DelayState } from "./tracking-derive";

/** Premium shipment card (Phase 3.3 / 3.3A) — derived from existing services, batched. */
export type PortalShipmentCard = {
  id: string;
  fileNumber: string;
  reference: string | null; // BL / container / client ref
  type: string;
  origin: string | null;
  destination: string | null;
  routeDisplay: string; // resolved route (never "— → —")
  transportMode: string | null;
  status: string;
  currentStageKey: PortalStageKey | null;
  percent: number;
  officerName: string | null;
  eta: string | null; // estimated delivery ISO, or null
  lastActivity: string | null;
  delayState: DelayState;
  delayLabel: string;
  nextStepTitle: string;
};

/** Customer-safe assigned officer (Phase 3.3A) — never a personal email or generic identity. */
export type PortalOfficer = {
  name: string;
  title: string; // customer-safe role label
  department: string | null;
  businessEmail: string | null; // env-configured business contact only
  businessPhone: string | null;
  availability: Availability;
  isTeam: boolean; // true when falling back to the operations team
};

export type PortalUser = {
  id: string;
  tenantId: string;
  clientId: string;
  email: string;
  name: string | null;
  status: PortalUserStatus;
  role: PortalRole;
  clientName: string | null;
  /** Phase 3.2B — true after a temp-password create/reset, until first change. */
  mustChangePassword: boolean;
};

export type PortalFileSummary = {
  id: string;
  fileNumber: string;
  type: string;
  status: string;
  origin: string | null;
  destination: string | null;
  transportMode: string | null;
  customsStatus: string | null;
  transportStatus: string | null;
};

export type PortalDashboard = {
  clientName: string | null;
  total: number;
  byStatus: Record<string, number>;
};

export type PortalDocument = {
  id: string;
  typeCode: string;
  typeLabel: string;
  status: string;
  title: string | null;
  fileId: string;
  fileNumber: string | null;
  createdAt: string;
};

export type PortalInvoiceSummary = {
  id: string;
  invoiceNumber: string | null;
  fileId: string;
  fileNumber: string | null;
  status: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  overdue: boolean;
};

export type PortalInvoiceLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  taxRate: number;
};

export type PortalInvoicePayment = {
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
};

export type PortalInvoiceDetail = PortalInvoiceSummary & {
  issueDate: string | null;
  subtotal: number;
  tax: number;
  paymentVerifying: boolean;
  lines: PortalInvoiceLine[];
  payments: PortalInvoicePayment[];
};

/** Admin (staff) view of a portal user, for the client detail page. */
export type PortalUserAdmin = {
  id: string;
  email: string;
  name: string | null;
  status: PortalUserStatus;
  role: PortalRole;
  invitedAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  lastLoginMethod: string | null;
  mustChangePassword: boolean;
};

export type ActionResult =
  | {
      ok: true;
      id?: string;
      inviteLink?: string;
      /** One-time temporary password — shown to the admin once, never persisted. */
      tempPassword?: string;
      /** Login identifier (email) shown alongside the temporary password. */
      email?: string;
    }
  | { ok: false; error: string };
