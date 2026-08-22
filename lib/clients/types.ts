/**
 * Client Management shared types (Phase 1.1). Safe for client + server import.
 */
export type ClientStatus = "active" | "archived";

export type ClientContactInput = {
  id?: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
};

export type ClientContact = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type ClientInput = {
  name: string;
  ninea?: string | null;
  segment?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  accountManagerId?: string | null;
  contacts?: ClientContactInput[];
  /**
   * FIN-UAT / DEFECT-FIN1-A — explicit client-level requirement for the physical
   * invoice deposit circuit. OPTIONAL and never inferred: absent means "leave as
   * is" on update and false at creation. The deposit chain refuses to start
   * unless this is true (lib/deposit/actions.ts), so it must be a deliberate
   * human decision, never derived from invoice type, segment or payment terms.
   */
  requiresPhysicalInvoiceDeposit?: boolean;
};

export type ClientListItem = {
  id: string;
  name: string;
  ninea: string | null;
  segment: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
};

export type ClientDetail = {
  id: string;
  tenantId: string;
  name: string;
  ninea: string | null;
  segment: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  accountManagerId: string | null;
  requiresPhysicalInvoiceDeposit: boolean;
  status: ClientStatus;
  createdAt: string;
  archivedAt: string | null;
  contacts: ClientContact[];
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
