/**
 * Reusable TENANT role templates (Phase 4.0B-2). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * The single reusable definition of the tenant staff roles. Phase 4.0C
 * provisioning will INSTANTIATE these per new tenant (tenant-scoped `role` rows +
 * `role_permission`), exactly as `supabase/seed.sql` does for the current
 * Effitrans tenant today.
 *
 * SOURCE OF TRUTH / NO DRIFT: the `permissions` set on each template is the exact
 * set seeded for the Effitrans tenant in `supabase/seed.sql`. The regression test
 * `tests/role-templates.test.ts` RE-PARSES seed.sql and asserts equality, so the
 * templates can never silently diverge from the live tenant's behaviour. This
 * phase does NOT modify seed.sql or any business permission — it only extracts
 * the definitions into a reusable, typed registry.
 *
 * Role codes are the EXISTING production codes (unchanged). The generic SaaS
 * names some specs use map onto them as follows (documentation only):
 *   TENANT_ADMIN → SYSTEM_ADMIN · MANAGER → OPS_SUPERVISOR ·
 *   DISPATCHER → TRANSPORT_OFFICER · OWNER → CEO · COMPLIANCE → COMPLIANCE_HSSE.
 * (A generic "VIEWER" role has no current equivalent; adding one would be an
 *  additive future change, not a rename.)
 */

export type BusinessProfileKey =
  | "customsBroker"
  | "freightForwarder"
  | "roadTransport"
  | "seaFreight"
  | "airFreight"
  | "warehousing"
  | "importOperations"
  | "exportOperations";

export type TenantRoleTemplate = {
  /** role code — matches public.role.code (unchanged production codes) */
  key: string;
  labelFr: string;
  labelEn: string;
  /** generic SaaS name this role maps to (documentation/UX only) */
  genericName: string;
  description: string;
  /** exact permission codes (mirror of seed.sql; verified by the parity test) */
  permissions: readonly string[];
  /** every tenant must have this role (e.g. the tenant administrator) */
  requiredForEveryTenant: boolean;
  /** if set, this role is only provisioned when the tenant has this capability */
  businessProfile?: BusinessProfileKey;
};

const BASE = ["profile:read:self", "profile:update:self"] as const;

/**
 * Phase 5.0B — official process engine. A role that moves work through the
 * official 26-step process needs to see it and to send/receive handoffs.
 * `process:override` (self-validation) is intentionally granted to NO role.
 */
const PROCESS_HANDOFF = ["process:handoff:receive", "process:handoff:send"] as const;

export const TENANT_ROLE_TEMPLATES: readonly TenantRoleTemplate[] = [
  {
    key: "SYSTEM_ADMIN",
    labelFr: "Administrateur système",
    labelEn: "System Administrator",
    genericName: "TENANT_ADMIN",
    description: "Tenant administrator — manages users, roles and configuration for the company. Full operational read + admin.",
    requiredForEveryTenant: true,
    permissions: [
      // FIN-AGING-2 — administers, does NOT approve. No import_approve, validate,
      // finalize, share or template_manage: platform administration is not
      // financial signoff authority (ratified D-11).
      "finance:aging:draft_create", "finance:aging:draft_update", "finance:aging:export", "finance:aging:import_stage", "finance:aging:print", "finance:aging:read",
      "admin:config:manage", "admin:roles:manage", "admin:users:manage", "analytics:read",
      // 2026-07-29 — granular user administration. `admin:users:manage` above is the
      // DEPRECATED umbrella, kept granted so a tenant mid-migration is never locked out
      // of its own user administration; every action accepts either. Ratified:
      // SYSTEM_ADMIN only — HR_OFFICER was considered for :read and deferred.
      "admin:users:create", "admin:users:disable", "admin:users:read",
      "admin:users:reset_password", "admin:users:temp_password", "admin:users:unlock",
      "admin:users:update",
      "audit:read:all", "client:create", "client:delete", "client:read", "client:update",
      "communication:manage", "communication:read", "communication:send", "customs:create",
      "customs:delete", "customs:read", "customs:release", "customs:update", "document:approve",
      "document:create", "document:delete", "document:read", "document:update",
      "executive:dashboard:read", "file:assign",
      "file:create", "file:delete", "file:read", "file:read:all", "file:transition", "file:update", "finance:create",
      "finance:issue", "finance:payment", "finance:read", "finance:update", "finance:void",
      "org:read:own", "portal:manage", ...BASE, "report:read", "task:create", "task:delete",
      "task:read", "task:read:all", "task:update", "tracking:manage", "tracking:read",
      "tracking:read:all", "tracking:write", "transport:assign", "transport:complete",
      "transport:create", "transport:delete", "transport:manage", "transport:read", "transport:update",
      // Phase 5.0B — official process engine (no process:override; see PROCESS_HANDOFF).
      "admin_service:manage", "collections:manage", "courier:assign", "courier:deposit",
      "customs:assign", "customs:register", "customs:validate", "finance:validate",
      "process:close", "process:completeness:review", ...PROCESS_HANDOFF, "process:manage",
      // EC-3B withdrew the Phase-5.0B placeholder grant of quotation:*, and
      // EC-3C (DEC-C32) keeps SYSTEM_ADMIN out of the matrix PERMANENTLY: an
      // administrator must never prepare, validate, send or accept a commercial
      // offer. Removing it from the migration alone would have been cosmetic —
      // this template provisions every NEW tenant, so the grant would return.
      "process:read",
      "transport:request", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. SYSTEM_ADMIN reaches every department + manage/moderate.
      "messaging:read", "messaging:send", "messaging:read:documentation", "messaging:read:customs",
      "messaging:read:transport", "messaging:read:finance", "messaging:read:general",
      "messaging:manage", "messaging:moderate",
      // Phase 9.0B — workflow structural extensions.
      "process:owner:assign", "process:decision:create", "process:decision:approve",
      "process:blocker:manage", "process:team:manage", "process:step:skip",
      // Phase 9.3A — Caisse & Trésorerie supervisory oversight (full-admin convention).
      "caisse:manage",
      // Phase 11.0B — Finance Expense Documents (full-admin convention; sign deferred to 11.0C/D).
      "finance:expense:read", "finance:expense:create", "finance:expense:submit",
      "finance:expense:export", "finance:expense:execute",
    ],
  },
  {
    key: "CEO",
    labelFr: "Direction générale",
    labelEn: "CEO / Owner",
    genericName: "OWNER",
    description: "Governance — full company visibility (read-only across modules), no daily admin.",
    requiredForEveryTenant: false,
    permissions: [
      // FIN-AGING-2 — reads and exports; no sharing authority unless later ratified.
      "finance:aging:export", "finance:aging:print", "finance:aging:read",
      "analytics:read", "audit:read:all", "client:read", "communication:read", "customs:read",
      "document:read", "executive:dashboard:read", "file:read", "file:read:all", "finance:read",
      "org:read:own", ...BASE,
      "process:read", "report:read", "task:read", "task:read:all", "tracking:read",
      "tracking:read:all", "transport:read", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Governance visibility: general customer-service thread only.
      "messaging:read", "messaging:send", "messaging:read:general",
      // Phase 11.0D — the DG visa (last step of the Autorisation chain, DEC-C08).
      // This is the CEO's first write-class finance capability — the deliberate
      // governance change flagged in 11.0A §4, not a silent widening. Read is
      // required to see the document being signed.
      "finance:expense:read", "finance:expense:sign",
    ],
  },
  {
    key: "QUOTATION_MANAGER",
    labelFr: "Responsable des cotations",
    labelEn: "Quotation Manager",
    genericName: "QUOTATION_MANAGER",
    description:
      "Pricing/quotation lead — owns official step 1 (Cotation). EC-3C activates the authorities ratified as DEC-C32: this role PREPARES, SENDS and records the customer's ACCEPTANCE. It deliberately does NOT hold quotation:validate — internal validation belongs to OPS_SUPERVISOR, and `validated_by <> prepared_by` is enforced by the database besides.",
    requiredForEveryTenant: false,
    permissions: [
      // EC-3C / DEC-C32 — the quotation-agent side of the two-person model.
      ...BASE, "quotation:approve", "quotation:create", "quotation:send",
      // Phase 8.7 — Messaging Center. Direct/dossier threads only (no department inbox).
      "messaging:read", "messaging:send",
    ],
  },
  {
    key: "ACCOUNT_MANAGER",
    labelFr: "Account Manager",
    labelEn: "Account Manager",
    genericName: "ACCOUNT_MANAGER",
    description: "File owner, end-to-end — owns clients and their dossiers; can bill and share to the portal.",
    requiredForEveryTenant: false,
    permissions: [
      "analytics:read", "client:create", "client:read", "client:update", "communication:read",
      "communication:send", "customs:read", "document:approve", "document:create", "document:read",
      "document:update", "file:assign", "file:create", "file:read", "file:read:all", "file:transition", "file:update",
      "finance:create", "finance:issue", "finance:read", "portal:manage", ...BASE,
      "process:completeness:review", ...PROCESS_HANDOFF, "process:manage", "process:read",
      "report:read", "task:create", "task:delete", "task:read", "task:read:all", "task:update",
      "tracking:read", "transport:read", "transport:request", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Owns dossiers/clients end to end: general + documentation + manage.
      "messaging:read", "messaging:send", "messaging:read:documentation", "messaging:read:general",
      "messaging:manage",
    ],
  },
  {
    key: "COORDINATOR",
    labelFr: "Coordinateur des opérations",
    labelEn: "Operations Coordinator",
    genericName: "COORDINATOR",
    description: "Control tower — coordinates operations across customs, documents and transport.",
    requiredForEveryTenant: false,
    permissions: [
      "client:read", "customs:assign", "customs:create", "customs:read", "customs:update",
      "document:create", "document:read", "document:update", "file:read", "file:transition", "file:update", ...BASE,
      "process:completeness:review", ...PROCESS_HANDOFF, "process:manage", "process:read",
      "task:create", "task:delete", "task:read", "task:update", "tracking:read", "tracking:write",
      "transport:assign", "transport:create", "transport:manage", "transport:read", "transport:update",
      "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Control tower: every department inbox + manage.
      "messaging:read", "messaging:send", "messaging:read:documentation", "messaging:read:customs",
      "messaging:read:transport", "messaging:read:finance", "messaging:read:general",
      "messaging:manage",
      // Phase 9.0B — the Coordinateur owns dossiers, requests decisions, manages
      // blockers and skips non-applicable steps; deliberately NOT decision:approve
      // (manager-approval policy unresolved) and NOT team:manage (Transit's call).
      "process:owner:assign", "process:decision:create", "process:blocker:manage", "process:step:skip",
      // Phase 11.0D — VISA_COORDONNATEUR, step 3 of the Autorisation chain (DEC-C08/C11).
      "finance:expense:read", "finance:expense:sign",
    ],
  },
  {
    key: "CHIEF_OF_TRANSIT",
    labelFr: "Chef de transit",
    labelEn: "Chief of Transit",
    genericName: "CUSTOMS_SUPERVISOR",
    description: "Customs authority — validates declarations and releases; requires the customs-broker capability.",
    requiredForEveryTenant: false,
    businessProfile: "customsBroker",
    permissions: [
      "customs:assign", "customs:create", "customs:read", "customs:release", "customs:update",
      // customs:validate — the CHECKER half of official step 7. Deliberately NOT
      // held by CUSTOMS_DECLARANT: the preparer must never be able to validate.
      "customs:validate", "document:approve", "document:create", "document:read",
      "document:update", "file:read", ...BASE, ...PROCESS_HANDOFF, "process:read", "task:read",
      "task:update", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Customs + transport department inboxes.
      "messaging:read", "messaging:send", "messaging:read:customs", "messaging:read:transport",
      // Phase 9.0B — Transit requests continue-before-payment decisions, manages
      // its blockers and its AIBD/Maritime team rosters.
      "process:decision:create", "process:blocker:manage", "process:team:manage",
      // Phase 11.0D — VISA_CHEF_TRANSIT, step 2 of the Autorisation chain (DEC-C08/C11).
      "finance:expense:read", "finance:expense:sign",
    ],
  },
  {
    key: "CUSTOMS_DECLARANT",
    labelFr: "Déclarant en douane",
    labelEn: "Customs Declarant",
    genericName: "CUSTOMS_DECLARANT",
    description: "Customs execution — files declarations; requires the customs-broker capability.",
    requiredForEveryTenant: false,
    businessProfile: "customsBroker",
    permissions: [
      "customs:create", "customs:read", "customs:update", "document:create", "document:read",
      "document:update", "file:read", ...BASE, ...PROCESS_HANDOFF, "process:read", "task:read",
      "task:update", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Customs department inbox.
      "messaging:read", "messaging:send", "messaging:read:customs",
    ],
  },
  {
    key: "DOCUMENTATION_OFFICER",
    labelFr: "Agent de documentation",
    labelEn: "Documentation Officer",
    genericName: "DOCUMENTATION_OFFICER",
    description: "Document control — manages the dossier document set.",
    requiredForEveryTenant: false,
    permissions: [
      "customs:read", "document:create", "document:read", "document:update", "file:read", ...BASE,
      "task:read", "task:update", "tracking:read", "transport:read",
      // Phase 8.7 — Messaging Center. Documentation department inbox.
      "messaging:read", "messaging:send", "messaging:read:documentation",
    ],
  },
  {
    key: "TRANSPORT_OFFICER",
    labelFr: "Responsable transport",
    labelEn: "Transport Officer",
    genericName: "DISPATCHER",
    description: "Transport + POD / dispatch — requires the road-transport capability.",
    requiredForEveryTenant: false,
    businessProfile: "roadTransport",
    permissions: [
      "document:create", "document:read", "document:update", "file:read", ...BASE,
      ...PROCESS_HANDOFF, "process:read", "task:read", "task:update", "tracking:read",
      "tracking:write", "transport:assign", "transport:complete", "transport:create",
      "transport:manage", "transport:read", "transport:request", "transport:update", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Transport department inbox.
      "messaging:read", "messaging:send", "messaging:read:transport",
    ],
  },
  {
    key: "WAREHOUSE_COORDINATOR",
    labelFr: "Coordinateur entrepôt",
    labelEn: "Warehouse Coordinator",
    genericName: "WAREHOUSE_COORDINATOR",
    description: "Handling / site — requires the warehousing capability.",
    requiredForEveryTenant: false,
    businessProfile: "warehousing",
    permissions: [
      "document:create", "document:read", "document:update", "file:read", ...BASE, "task:read",
      "task:update", "tracking:read", "transport:read",
      // Phase 8.7 — Messaging Center. Transport department inbox.
      "messaging:read", "messaging:send", "messaging:read:transport",
    ],
  },
  {
    key: "FINANCE_OFFICER",
    labelFr: "Agent financier",
    labelEn: "Finance Officer",
    genericName: "FINANCE_OFFICER",
    description:
      "Finance — full finance module plus finance:validate, the CHECKER half of official step 21 (invoice validation). Phase 5.0A recommends narrowing this role by removing finance:create once BILLING_OFFICER is staffed; 5.0B does NOT do that (it would change existing users' access), so maker != checker is enforced on IDENTITY in the engine instead. See docs/phase-5.0b-process-engine.md.",
    requiredForEveryTenant: false,
    permissions: [
      "finance:aging:draft_create", "finance:aging:draft_update", "finance:aging:export", "finance:aging:print", "finance:aging:read",
      "analytics:read", "collections:manage", "communication:read", "communication:send",
      "file:read", "file:read:all", "finance:create", "finance:issue", "finance:payment",
      "finance:read", "finance:update", "finance:validate", "finance:void", ...BASE,
      "process:read", "report:read", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Finance department inbox.
      "messaging:read", "messaging:send", "messaging:read:finance",
      // Phase 11.0B — Finance Expense Documents. The finance agent originates the
      // document (create/submit) + reads/exports; VISA_AGENT sign authority is
      // wired in 11.0C/D. No execute (payment execution is the Cashier's).
      "finance:expense:read", "finance:expense:create", "finance:expense:submit",
      "finance:expense:export",
      // Phase 11.0D — VISA_DEMANDEUR is identity-bound (the document's own
      // requester signs it), and requesters are finance agents, so the seat needs
      // the sign capability. VISA_AGENT on the BON remains 11.0E.
      "finance:expense:sign",
    ],
  },
  {
    key: "OPS_SUPERVISOR",
    labelFr: "Superviseur opérations",
    labelEn: "Operations Supervisor",
    genericName: "MANAGER",
    description: "Supervision + milestone validation across operations and finance.",
    requiredForEveryTenant: false,
    permissions: [
      "analytics:read", "client:read", "communication:manage", "communication:read",
      "communication:send", "customs:create", "customs:delete", "customs:read", "customs:release",
      "customs:update", "document:approve", "document:create", "document:delete", "document:read",
      "document:update", "executive:dashboard:read", "file:assign", "file:delete", "file:transition", "file:read", "file:read:all",
      "finance:create", "finance:issue", "finance:payment", "finance:read", "finance:update",
      "finance:void", "portal:manage", ...BASE, "report:read", "task:create", "task:delete",
      "task:read", "task:read:all", "task:update", "tracking:manage", "tracking:read",
      "tracking:read:all", "tracking:write", "transport:assign", "transport:complete",
      "transport:create", "transport:delete", "transport:manage", "transport:read", "transport:update",
      // Phase 5.0B. A supervisor may act as either maker or checker, but the engine
      // still blocks them from validating their OWN work (identity check).
      "admin_service:manage", "collections:manage", "courier:assign", "customs:assign",
      "customs:register", "customs:validate", "finance:validate", "process:close",
      "process:completeness:review", ...PROCESS_HANDOFF, "process:manage", "process:read",
      // EC-3C / DEC-C32 — the CHECKER side of the two-person quotation model:
      // internal managerial validation, and nothing else. Deliberately NOT
      // quotation:create — granting it merely to make quotations readable is
      // explicitly refused; the SELECT policies read `create OR validate`.
      "quotation:validate",
      "transport:request",
      "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Full supervisory reach: every department + manage/moderate.
      "messaging:read", "messaging:send", "messaging:read:documentation", "messaging:read:customs",
      "messaging:read:transport", "messaging:read:finance", "messaging:read:general",
      "messaging:manage", "messaging:moderate",
      // Phase 9.0B — workflow structural extensions.
      "process:owner:assign", "process:decision:create", "process:decision:approve",
      "process:blocker:manage", "process:team:manage", "process:step:skip",
      // Phase 9.3A — Caisse & Trésorerie supervisory oversight (operations/finance supervisor).
      "caisse:manage",
      // Phase 11.0B — Finance Expense Documents supervisory oversight (read/export +
      // execute, mirroring caisse:manage). No create/submit/sign.
      "finance:expense:read", "finance:expense:export", "finance:expense:execute",
    ],
  },
  {
    key: "COMPLIANCE_HSSE",
    labelFr: "Responsable conformité/HSSE",
    labelEn: "Compliance / HSSE",
    genericName: "COMPLIANCE",
    description: "Audit / compliance read across the company, plus document approval.",
    requiredForEveryTenant: false,
    permissions: [
      "audit:read:all", "customs:read", "document:approve", "document:read", "file:read",
      "file:read:all", ...BASE, "process:read", "task:read", "task:read:all", "tracking:read",
      "transport:read", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Governance: read + redact, no department inbox.
      "messaging:read", "messaging:send", "messaging:moderate",
    ],
  },
  {
    key: "CLIENT_USER",
    labelFr: "Client (portail)",
    labelEn: "Client User",
    genericName: "CLIENT_USER",
    description: "External portal client — own files only (portal scoping is enforced by client_user, not this role).",
    requiredForEveryTenant: false,
    permissions: [...BASE],
  },
  {
    key: "PARTNER_AGENT",
    labelFr: "Partenaire / agent",
    labelEn: "Partner / Agent",
    genericName: "PARTNER_AGENT",
    description: "External partner / agent — assigned executions (base access in Phase 1).",
    requiredForEveryTenant: false,
    permissions: [...BASE],
  },
  {
    key: "DRIVER",
    labelFr: "Chauffeur",
    labelEn: "Driver",
    genericName: "DRIVER",
    description: "Mobile driver — narrowly scoped to their assigned transport (tracking only, no dossier/admin access).",
    requiredForEveryTenant: false,
    businessProfile: "roadTransport",
    permissions: ["profile:read:self", "profile:update:self", "tracking:read", "tracking:write"],
  },

  // =========================================================================
  // Phase 5.0B — the seven roles Phase 5.0A found missing from the official
  // 26-step process. Additive: no existing role was renamed and no existing user
  // was reassigned. Mirrored exactly in supabase/seed.sql +
  // supabase/migrations/20260713000001_process_engine.sql.
  // =========================================================================
  {
    key: "BILLING_OFFICER",
    labelFr: "Agent de facturation",
    labelEn: "Billing Officer",
    genericName: "BILLING_OFFICER",
    description:
      "Official steps 20 + 22 — drafts the invoice and dispatches it. The MAKER half of the invoice pair: holds finance:create/update/issue and deliberately NOT finance:validate, so it can never approve its own invoice. This split is what makes step 21 a real independent review.",
    requiredForEveryTenant: false,
    permissions: [
      "client:read", "communication:read", "communication:send", "file:read", "file:read:all",
      "finance:create", "finance:issue", "finance:read", "finance:update", ...BASE,
      ...PROCESS_HANDOFF, "process:read", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Finance department inbox.
      "messaging:read", "messaging:send", "messaging:read:finance",
    ],
  },
  {
    key: "CUSTOMS_FINANCE_OFFICER",
    labelFr: "Finance douane",
    labelEn: "Customs Finance Officer",
    genericName: "CUSTOMS_FINANCE_OFFICER",
    description:
      "Official step 9 — registers the declaration in GAINDE (a manual milestone; no API). Exists because FINANCE_OFFICER holds no customs permission at all, so RBAC previously made this official step impossible.",
    requiredForEveryTenant: false,
    businessProfile: "customsBroker",
    permissions: [
      "customs:read", "customs:register", "file:read", "finance:read", ...BASE,
      ...PROCESS_HANDOFF, "process:read", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Customs department inbox.
      "messaging:read", "messaging:send", "messaging:read:customs",
    ],
  },
  {
    key: "CUSTOMS_FIELD_AGENT",
    labelFr: "Agent de terrain douane",
    labelEn: "Customs Field Agent",
    genericName: "CUSTOMS_FIELD_AGENT",
    description:
      "Official step 13 — follows the dossier at Customs, obtains the Bon à Enlever and completes exit formalities. Holds customs:release (the BAE authority).",
    requiredForEveryTenant: false,
    businessProfile: "customsBroker",
    permissions: [
      "customs:read", "customs:release", "customs:update", "document:create", "document:read",
      "file:read", ...BASE, ...PROCESS_HANDOFF, "process:read", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Customs department inbox.
      "messaging:read", "messaging:send", "messaging:read:customs",
    ],
  },
  {
    key: "PICKUP_AGENT",
    labelFr: "Agent enlèvement",
    labelEn: "Pickup Agent",
    genericName: "PICKUP_AGENT",
    description:
      "Official step 15 — picks up the merchandise and completes port-exit formalities. Distinct from DRIVER, which is a narrow mobile identity with no dossier access.",
    requiredForEveryTenant: false,
    permissions: [
      "document:create", "document:read", "file:read", ...BASE, ...PROCESS_HANDOFF, "process:read",
      "tracking:read", "transport:read", "transport:update", "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Transport department inbox.
      "messaging:read", "messaging:send", "messaging:read:transport",
    ],
  },
  {
    key: "ADMINISTRATIVE_OFFICER",
    labelFr: "Agent administratif",
    labelEn: "Administrative Officer",
    genericName: "ADMINISTRATIVE_OFFICER",
    description:
      "Official steps 23 + 25 — prepares the invoice for physical deposit, assigns a courier, archives the dossier, and forwards the proof of deposit to Collections. Distinct from SYSTEM_ADMIN, which is the IT/config admin.",
    requiredForEveryTenant: false,
    permissions: [
      "admin_service:manage", "courier:assign", "document:create", "document:read", "file:read",
      "file:read:all", "finance:read", ...BASE, ...PROCESS_HANDOFF, "process:read",
      "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. General customer-service inbox.
      "messaging:read", "messaging:send", "messaging:read:general",
    ],
  },
  {
    key: "COURIER",
    labelFr: "Coursier",
    labelEn: "Courier",
    genericName: "COURIER",
    description:
      "Official step 24 — deposits the invoice with the client and returns proof of deposit. Deliberately narrow, like DRIVER: NO finance permission of any kind, so a courier can never mutate a financial status.",
    requiredForEveryTenant: false,
    permissions: [
      "courier:deposit", "document:create", "document:read", "file:read", ...BASE, "process:read",
      "logistics:copilot:read",
    ],
  },
  {
    key: "COLLECTIONS_OFFICER",
    labelFr: "Agent de recouvrement",
    labelEn: "Collections Officer",
    genericName: "COLLECTIONS_OFFICER",
    description:
      "Official step 26 — monitors due dates, recovers receivables and closes the dossier ONLY after full payment. Delivered must never mean closed.",
    requiredForEveryTenant: false,
    permissions: [
      "collections:manage", "communication:read", "communication:send", "file:read",
      "file:read:all", "finance:payment", "finance:read", ...BASE, "process:read", "report:read",
      "logistics:copilot:read",
      // Phase 8.7 — Messaging Center. Finance department inbox.
      "messaging:read", "messaging:send", "messaging:read:finance",
    ],
  },

  // =========================================================================
  // Phase 9.3A — Caisse & Trésorerie foundation. The 24th tenant role. Caisse is
  // a FINANCE workspace (not a department); the employee title lives here on the
  // ROLE, never on navigation. LEAST PRIVILEGE: treasury operations
  // (caisse:manage) + finance read-only + process:read (Mon Travail visibility).
  // Deliberately holds NO finance authorization (validate/issue/void/delete/
  // payment) or collections:manage — segregation of duties for the future
  // treasury engine. Mirrored in supabase/seed.sql + the additive migration.
  // =========================================================================
  {
    key: "CASHIER",
    labelFr: "Caissier / Caissière",
    labelEn: "Cashier",
    genericName: "CASHIER",
    description:
      "Finance Caisse & Trésorerie — records and handles multi-channel treasury operations (cash, checks, Mobile Money, bank movements). Executes/records approved transactions without authority to approve the underlying finance request (segregation of duties).",
    requiredForEveryTenant: false,
    permissions: [
      ...BASE, "caisse:manage", "finance:read", "process:read",
      // Phase 11.0B — Finance Expense Documents. EXECUTION-ONLY: the Cashier reads
      // the eligible-voucher queue and executes payment; it holds NO authorization
      // (no create/submit/sign) — VISA_AGENT is FINANCE_OFFICER, never the Cashier.
      "finance:expense:read", "finance:expense:execute",
    ],
  },
  // =========================================================================
  // HR_OFFICER (25th) — Phase HR-1 Employee Registry. Corporate support role
  // mapped to the HUMAN_RESOURCES canonical department (metadata only). Holds
  // the HR module (hr:read + hr:manage) + staff messaging; deliberately NO
  // admin:*, finance:*, process:*, or delete authority, and — per DEC-B25 —
  // hr:* is NEVER granted to SYSTEM_ADMIN. Mirrored in supabase/seed.sql + the
  // additive migration 20260724000002_hr_employee_registry.sql.
  // =========================================================================
  {
    key: "HR_OFFICER",
    labelFr: "Chargé RH",
    labelEn: "HR Officer",
    genericName: "HR_OFFICER",
    description:
      "Human Resources — maintains the employee registry (identity, department, job title, employment status, contacts) and the optional link between an employee and a platform account. Employment records are separate from platform accounts; linking grants no access, and termination never silently revokes access.",
    requiredForEveryTenant: false,
    permissions: [
      ...BASE, "hr:read", "hr:manage", "messaging:read", "messaging:send",
      // HR-A1 (HRQ-D2 = Option A, ratified 2026-08-09) — the configuration
      // center: org structure, positions, work locations, matricule scheme,
      // competency catalog. Structure only — the three OTHER parked
      // authorities (hr:sensitive:read, hr:leave:approve,
      // hr:performance:finalize) stay granted to NOBODY.
      "hr:config:manage",
    ],
  },
  // =========================================================================
  // Phase 11.0B — Finance Expense Documents. Four ratified authorizer seats
  // (DEC-C11) for the two paper forms' visa chains, mapped to the FINANCE
  // canonical department (metadata only, lib/organization/departments.ts).
  // FOUNDATION grant = own profile + finance read + expense read/export.
  //
  // Phase 11.0D wired the AUTORISATION chain only (DEC-C08): TREASURER and DAF
  // sign it and gain finance:expense:sign. ACCOUNTANT (« Visa Comptable ») and
  // DGA (« Visa DGA ») sign the BON's chain — their signing capability stays
  // WITHHELD until that workflow ships, so no seat holds authority it cannot yet
  // legitimately exercise. VISA_RECEPTION / VISA_OPERATIONS remain unmapped
  // business blockers (BLK-FIN-1 / BLK-FIN-2) and are granted to nobody.
  // Mirrored in supabase/seed.sql + migration 20260726000002_expense_approval_chain.sql.
  // =========================================================================
  {
    key: "ACCOUNTANT",
    labelFr: "Comptable",
    labelEn: "Accountant",
    genericName: "ACCOUNTANT",
    description:
      "Finance — comptabilité. Authorizer seat for the « Visa Comptable » on the Bon de Dépenses. Foundation grant is read + export of expense documents; signing authority is wired in 11.0C/D.",
    requiredForEveryTenant: false,
    permissions: [
      "finance:aging:draft_create", "finance:aging:draft_update", "finance:aging:export", "finance:aging:import_stage", "finance:aging:print", "finance:aging:read",
      ...BASE, "finance:read", "finance:expense:read", "finance:expense:export",
    ],
  },
  {
    key: "TREASURER",
    labelFr: "Trésorier / Trésorière",
    labelEn: "Treasurer",
    genericName: "TREASURER",
    description:
      "Finance — trésorerie (authorization, distinct from the Cashier's execution role). Authorizer seat for the « Visa Trésorière » on the Autorisation de Dépenses. Foundation grant is read + export; signing authority is wired in 11.0C/D.",
    requiredForEveryTenant: false,
    permissions: [
      "finance:aging:export", "finance:aging:print", "finance:aging:read",
      ...BASE, "finance:read", "finance:expense:read", "finance:expense:export",
      // Phase 11.0D — a signing seat of the Autorisation chain (DEC-C08/C11).
      "finance:expense:sign",
    ],
  },
  {
    key: "DAF",
    labelFr: "Directeur administratif et financier",
    labelEn: "Administrative & Financial Director",
    genericName: "DAF",
    description:
      "Direction administrative et financière. Authorizer seat for the « Visa DAF » on both documents. Foundation grant is read + export; signing authority is wired in 11.0C/D.",
    requiredForEveryTenant: false,
    permissions: [
      // FIN-AGING-2 — the full Aging Balance authority: prepares, approves imports,
      // validates, finalizes, shares and administers templates.
      "finance:aging:draft_create", "finance:aging:draft_update", "finance:aging:export", "finance:aging:finalize", "finance:aging:import_approve", "finance:aging:import_stage", "finance:aging:print", "finance:aging:read", "finance:aging:share", "finance:aging:template_manage", "finance:aging:validate",
      ...BASE, "finance:read", "finance:expense:read", "finance:expense:export",
      // Phase 11.0D — a signing seat of the Autorisation chain (DEC-C08/C11).
      "finance:expense:sign",
      // HR-B1 — Direction org-wide leave approval seat (ratified: Department
      // Managers + Direction + CEO; CEO's grant awaits the HR-1A question (a)
      // answer because six broad accounts hold that role today).
      "hr:leave:approve",
    ],
  },
  {
    key: "DGA",
    labelFr: "Directeur général adjoint",
    labelEn: "Deputy General Manager",
    genericName: "DGA",
    description:
      "Direction générale adjointe. Authorizer seat for the « Visa DGA » on the Bon de Dépenses. Foundation grant is read + export; signing authority is wired in 11.0C/D.",
    requiredForEveryTenant: false,
    permissions: [
      // FIN-AGING-2 — approval authority: import approval, validation, finalization
      // and external sharing. Does not prepare drafts or stage imports.
      "finance:aging:export", "finance:aging:finalize", "finance:aging:import_approve", "finance:aging:print", "finance:aging:read", "finance:aging:share", "finance:aging:validate",
      ...BASE, "finance:read", "finance:expense:read", "finance:expense:export",
      // HR-B1 — Direction org-wide leave approval seat (see DAF's note).
      "hr:leave:approve",
    ],
  },
  {
    key: "MAIL_ADMIN",
    labelFr: "Administrateur messagerie",
    labelEn: "Mail Administrator",
    genericName: "MAIL_ADMIN",
    description:
      "Administers Enterprise Mail: mailbox identities, per-mailbox membership, and the inbound webhook journal. EMP-4A ratified a dedicated role because the only holders of communication:manage were SYSTEM_ADMIN — excluded from correspondence by EC-1's own requirement — and OPS_SUPERVISOR, and granting provisioning to every supervisor would widen a role several people hold.",
    requiredForEveryTenant: false,
    permissions: [
      // Mailbox administration, and nothing else. Deliberately absent: admin:*,
      // role/permission administration, finance:*, document:delete, security
      // configuration, and any unrelated operations authority.
      "communication:mailbox:provision",
      "communication:membership:manage",
      "communication:diagnostics:read",
      // The existing minimum required to USE the administration surface.
      // `communication:inbound:read` is DELIBERATELY ABSENT (RATIFY-EC1-1 /
      // RATIFY-EMP4A-8): it is granted to no role, and administering who may
      // read correspondence is not the same authority as reading it.
      "communication:read", "communication:manage",
      ...BASE,
    ],
  },
];

export const TENANT_ROLE_KEYS = TENANT_ROLE_TEMPLATES.map((t) => t.key);

export function getTenantRoleTemplate(key: string): TenantRoleTemplate | undefined {
  return TENANT_ROLE_TEMPLATES.find((t) => t.key === key);
}

export function requiredTenantRoleTemplates(): TenantRoleTemplate[] {
  return TENANT_ROLE_TEMPLATES.filter((t) => t.requiredForEveryTenant);
}

/**
 * Deterministically select which role templates a tenant should be provisioned
 * with, given its business profile. A role is included when it is required, OR it
 * has no capability dependency (general role), OR its dependency flag is enabled.
 * Order is stable (registry order) so provisioning is reproducible.
 */
export function selectTenantRoleTemplates(
  profile: Partial<Record<BusinessProfileKey, boolean>>,
): TenantRoleTemplate[] {
  return TENANT_ROLE_TEMPLATES.filter(
    (t) => t.requiredForEveryTenant || !t.businessProfile || profile[t.businessProfile] === true,
  );
}
