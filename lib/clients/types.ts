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
  status: ClientStatus;
  createdAt: string;
  archivedAt: string | null;
  contacts: ClientContact[];
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
