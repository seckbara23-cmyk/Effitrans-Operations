/**
 * Portal shared types (Phase 1.12A). Client + server safe.
 */
import type { PortalRole, PortalUserStatus } from "./access";

export type PortalUser = {
  id: string;
  tenantId: string;
  clientId: string;
  email: string;
  name: string | null;
  status: PortalUserStatus;
  role: PortalRole;
  clientName: string | null;
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

/** Admin (staff) view of a portal user, for the client detail page. */
export type PortalUserAdmin = {
  id: string;
  email: string;
  name: string | null;
  status: PortalUserStatus;
  role: PortalRole;
  invitedAt: string;
  lastLoginAt: string | null;
};

export type ActionResult =
  | { ok: true; id?: string; inviteLink?: string }
  | { ok: false; error: string };
