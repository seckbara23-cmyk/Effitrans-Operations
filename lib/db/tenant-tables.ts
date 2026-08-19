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
  // Enterprise Communications / Enterprise Mail (EC-1 .. EMP-4A). All seven
  // carry `tenant_id uuid references public.organization`. They were absent
  // from this registry until EMP-4A, so service-role reads of the entire mail
  // context were unguarded; registering them closed that gap.
  "ec_mailbox", "ec_mailbox_alias", "ec_mailbox_member", "ec_inbound_message",
  "ec_inbound_attachment", "ec_triage_item", "ec_webhook_event",

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
  // TMS-6 — external transport subcontractors (migration 118).
  "transport_provider",
  // TMS-5 — Parc & Flotte (migration 117).
  "vehicle",
  "vehicle_compliance",
  "vehicle_maintenance",
  // finance
  "billing_charge",
  "invoice",
  "invoice_line",
  "payment",
  "invoice_counter",
  "payment_intent",
  "finance_request",
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
  // human resources (Phase HR-1)
  "employee",
  "employee_counter",
  // human resources — full registration (HR-A1, closing HR-0P finding F1).
  // Every table below carries `tenant_id uuid not null references
  // public.organization` (migrations 73–79); only the two rows above were
  // registered when they shipped, which made the other 34 INVISIBLE to the
  // leak guard — a guard cannot flag a read on a table it does not know
  // about. Registration is the fix; RLS was always present and is unchanged.
  // HR-1B organization foundation (migration 73)
  "hr_configuration",
  "hr_org_unit",
  "hr_position",
  "hr_work_location",
  "employee_assignment",
  "hr_employee_event",
  "hr_import_batch",
  "hr_import_staging_row",
  "hr_import_error",
  // HR-3 documents & contracts (migration 75). NOTE: hr_document_type is
  // PER-TENANT (unlike the global document_type catalog) — it belongs here,
  // not in GLOBAL_TABLES.
  "hr_document_type",
  "hr_document",
  "employment_contract",
  "hr_template_version",
  // HR-4 onboarding & equipment (migration 76)
  "hr_checklist_template",
  "hr_checklist_item_template",
  "hr_onboarding_case",
  "hr_onboarding_item",
  "hr_provisioning_request",
  "hr_equipment_type",
  "hr_equipment",
  "hr_equipment_assignment",
  // HR-8A offboarding (migration 111)
  "hr_offboarding_case",
  "hr_offboarding_item",
  // HR-5 leave & attendance (migration 77)
  "hr_leave_category",
  "hr_leave_entitlement",
  "hr_leave_request",
  "hr_attendance_day",
  // HR-6 performance (migration 78)
  "hr_performance_cycle",
  "hr_competency",
  "hr_competency_expectation",
  "hr_evaluation",
  "hr_objective",
  "hr_competency_assessment",
  // HR-6 training (migration 79)
  "hr_training_course",
  "hr_training_plan",
  "hr_training_enrollment",
  // finance expense documents (Phase 11.0B)
  "expense_authorization",
  "expense_authorization_version",
  "expense_voucher",
  "expense_voucher_version",
  "expense_approval_attempt",
  "expense_visa",
  "expense_authorization_counter",
  "expense_voucher_counter",
  // expense supporting documents (Phase 11.0C, DEC-C22)
  "expense_attachment",
  // versioned workflow policy (Phase WES-7). tenant_id is NULLABLE: a NULL row is
  // the PLATFORM DEFAULT. Tenant rows are strictly tenant-scoped and RLS enforces
  // it; the handful of deliberate platform-scope reads are enumerated in the leak
  // guard's KNOWN_UNSCOPED_READS with their reason.
  "workflow_policy_version",
  // immutable business event ledger (Phase WES-9). Append-only; the internal
  // reader runs on the RLS-enforced client, and the portal projection uses the
  // admin client tenant-scoped explicitly.
  "business_event",
  // append-only assignment history (Phase WES-3A). Written only by the assign_*
  // RPCs; read through the RLS-enforced client or explicitly tenant-scoped.
  "assignment_event",
  // protected document review record (Phase WES-4F). Append-only; holds the
  // restricted free-text explanation, so an unscoped read would leak review
  // prose across tenants.
  "document_review",
  // append-only evidence consumption (Phase WES-5D).
  "evidence_consumption",
  // MAYA migration staging (MAYA-P0.5-C). All three carry tenant_id and are
  // read by the admin client, so they must be visible to the leak guard from
  // the day they ship — the HR-0P F1 lesson, applied at birth rather than
  // retrofitted.
  "maya_import_batch",
  "maya_import_row",
  "maya_import_issue",
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
  // Phase 11.0B — global versioned template-metadata catalog (same across
  // tenants for v1; a per-tenant registry only when tenants need divergent
  // templates — DEC-C16 / 11.0A §10).
  "expense_template",
]);

export function isTenantScopedTable(table: string): boolean {
  return TENANT_SCOPED_TABLES.has(table);
}
