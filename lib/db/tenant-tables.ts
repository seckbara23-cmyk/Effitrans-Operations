/**
 * Tenant-scoped table registry (Phase 4.0A). SERVER + build-time.
 * ---------------------------------------------------------------------------
 * Single source of truth for WHICH public tables carry a `tenant_id` column and
 * must therefore be tenant-scoped on every service-role (RLS-bypassing) read.
 *
 * Derived from supabase/migrations/* (every `tenant_id uuid references
 * public.organization`). Keep in sync when a new tenant-scoped table lands.
 *
 * Consumers:
 *   - lib/db/tenant-scope.ts   — scopedFrom() only accepts these tables.
 *   - tests/tenant-scope-guard — fails CI if an admin-client `.select` on one of
 *                                these tables is not tenant-scoped.
 *   - (4.0C) transactional tenant provisioning / teardown.
 *
 * NOTE: this is intentionally a plain string set, NOT `keyof Database[...]`. The
 * generated types file is a hand-authored stopgap (see lib/db/types.ts) and may
 * drift; the migration DDL is the authority for tenant scoping, so we mirror it
 * directly here rather than couple this security-critical list to that drift.
 */

/**
 * Tables with a `tenant_id` column. A service-role read of any of these that is
 * not filtered by tenant is a cross-tenant leak (RLS does not backstop the
 * service role). `audit_log` has a NULLABLE tenant_id but tenant-scoped reads
 * are still expected to filter it.
 */
export const TENANT_SCOPED_TABLES = new Set<string>([
  // foundation / RBAC
  "app_user",
  "audit_log",
  "role",
  "user_role",
  // client management
  "client",
  "client_contact",
  // operational file spine
  "operational_file",
  "shipment",
  "file_state_transition",
  "file_counter",
  "task",
  "notification",
  // documents / customs / transport
  "document",
  "customs_record",
  "transport_record",
  // finance
  "billing_charge",
  "invoice",
  "invoice_line",
  "payment",
  "invoice_counter",
  "payment_intent",
  // communications
  "communication_message",
  "client_notification",
  // portal
  "client_user",
  // platform / tenant configuration
  "tenant_branding",
  // tracking
  "tracking_session",
  "tracking_position",
  "tracking_event",
  // official process engine (Phase 5.0B)
  "process_instance",
  "process_step_execution",
  "process_handoff",
  // post-delivery chain (Phase 5.0D)
  "invoice_deposit",
  "collection_follow_up",
  // chain of custody (Phase 5.0D-3)
  "invoice_deposit_event",
  // shipping line platform (Phase 7.2A)
  "ocean_carrier",
  "ocean_port",
  "ocean_vessel",
  "ocean_voyage",
  "ocean_container",
  "ocean_route_leg",
  "ocean_port_call",
  "ocean_tracking_event",
  // air cargo platform (Phase 7.3A)
  "air_airline",
  "air_airport",
  "air_flight",
  "air_flight_leg",
  "air_awb",
  "air_uld",
  "air_cargo_piece",
  "air_tracking_event",
  // document intelligence (Phase 7.4A)
  "document_intelligence_job",
  "document_candidate_field",
]);

/**
 * Tables that intentionally have NO enforced tenant scope, with the reason. The
 * guard skips these; listing them makes the exemption explicit and reviewable.
 *   - organization           : the tenant root itself (filtered by `id`).
 *   - permission             : global permission catalog (same across tenants).
 *   - document_type          : global reference catalog (shared, no tenant_id).
 *   - role_permission        : scoped transitively via `role` (no tenant_id col).
 *   - provider_webhook_event : cross-tenant idempotency namespace; tenant_id is
 *                              nullable and resolved from the matched intent.
 *   - platform_admin         : platform identity class; has NO tenant_id and is
 *                              intentionally outside tenant scoping (Phase 4.0B).
 */
export const GLOBAL_TABLES = new Set<string>([
  "organization",
  "permission",
  "document_type",
  "role_permission",
  "provider_webhook_event",
  "platform_admin",
]);

export function isTenantScopedTable(table: string): boolean {
  return TENANT_SCOPED_TABLES.has(table);
}
