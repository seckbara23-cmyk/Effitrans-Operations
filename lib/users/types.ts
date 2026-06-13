/**
 * Shared user-management types (Task 6a). Safe for client + server import.
 */
export type AdminUserRole = {
  roleId: string;
  code: string;
  labelFr: string | null;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "inactive";
  isSystemAdmin: boolean;
  roles: AdminUserRole[];
};

export type AssignableRole = {
  id: string;
  code: string;
  labelFr: string | null;
};

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };
