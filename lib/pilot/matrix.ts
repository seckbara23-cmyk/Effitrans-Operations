/**
 * Pilot user-role matrix (Phase 5.0E-2B, Deliverable 2). PURE.
 * ---------------------------------------------------------------------------
 * The fifteen official Effitrans roles, and for each: where they land, what they
 * see, what they may do, what they must NOT be able to do, and who they hand to.
 *
 * THE IMPORTANT PROPERTY: this matrix is DERIVED, not written down.
 *
 * Landing comes from resolveLandingRoute(). Navigation comes from buildNavigation().
 * Queues come from the queue registry, which derives them from the 26-step process
 * registry. Handoffs come from the step registry. Nothing here is a second copy of
 * anything, so the matrix cannot say one thing while the application does another —
 * which is the entire failure mode of a hand-maintained test plan, and the reason
 * such plans are worthless by the second sprint.
 *
 * What IS declared by hand: the FORBIDDEN list. That is the one thing which cannot
 * be derived, because it is a claim about what the code must never do — and a
 * forbidden list generated from the code would simply agree with the code, bug and
 * all. Those entries are the assertions; everything else is the observation.
 */
import { buildNavigation } from "@/lib/navigation/build";
import { resolveLandingRoute, isCourierOnly } from "@/lib/navigation/landing";
import { primaryRoleLabel } from "@/lib/navigation/roles";
import type { NavigationContext } from "@/lib/navigation/types";
import { QUEUES, visibleQueues } from "@/lib/process/queues/registry";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { ROLE_MAPPINGS } from "@/lib/process/roles";
import { resolveProcessFlags } from "@/lib/process/flags";
import { resolveEffectiveFlags } from "@/lib/process/rollout";

/** The pilot runs with everything switched on, for the pilot tenant only. */
const PILOT_ENV = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true",
  EFFITRANS_COLLECTIONS_ENABLED: "true",
});

export const PILOT_FLAGS = resolveEffectiveFlags(PILOT_ENV, {
  process_engine: true,
  process_workspaces: true,
  physical_invoice_deposit: true,
  collections: true,
});

/**
 * A pilot role: the tenant role code a real user actually holds, the permissions
 * that role carries, and the things that must be impossible for them.
 *
 * `permissions` mirrors the seed role templates. It is stated here rather than read
 * from the database so the matrix is a PURE, testable artefact — and
 * tests/role-templates.test.ts already proves the templates and the seed agree, so
 * this cannot silently diverge from production.
 */
export type PilotRole = {
  roleCode: string;
  /** The official process role, as named in the Effitrans document. */
  officialTitle: string;
  permissions: string[];
  /** Things this role MUST NOT be able to do. Asserted, never derived. */
  forbidden: string[];
  /** What the tester should actually do, in order, during the pilot. */
  primaryActions: string[];
};

const P_READ = ["process:read"];

export const PILOT_ROLES: PilotRole[] = [
  {
    roleCode: "OPS_SUPERVISOR",
    officialTitle: "Responsable des Opérations",
    permissions: [
      ...P_READ, "process:manage", "process:close", "file:read", "file:create", "analytics:read",
      "document:read", "customs:read", "transport:read", "finance:read", "client:read",
      "communication:read", "collections:manage", "admin_service:manage",
    ],
    forbidden: [
      "process:override — nobody holds it; self-validation must be impossible",
      "Reach /platform — a different identity stack",
      "Approve a step they themselves submitted (maker-checker is on IDENTITY, not permission)",
    ],
    primaryActions: [
      "Land on /dashboard and read the process tower",
      "Confirm every department queue is visible",
      "Perform the explicit closure at step 26",
    ],
  },
  {
    roleCode: "ACCOUNT_MANAGER",
    officialTitle: "Account Manager",
    permissions: [...P_READ, "file:read", "file:create", "client:read", "communication:read", "document:read"],
    forbidden: [
      "See /collections, /deposits or /courier",
      "Validate an invoice (that is Finance)",
      "Close a dossier (process:close is Supervisor + System Admin only)",
    ],
    primaryActions: [
      "Land on /portfolio",
      "Open the dossier, confirm the client and the request",
      "Hand off to the Coordinator",
      "Later: confirm post-delivery completeness",
    ],
  },
  {
    roleCode: "COORDINATOR",
    officialTitle: "Coordinateur",
    permissions: [...P_READ, "process:manage", "file:read", "document:read", "transport:read", "customs:read", "analytics:read"],
    forbidden: ["Validate an invoice", "Close a dossier", "See /collections"],
    primaryActions: [
      "Land on /dashboard (the control tower — not a second tower)",
      "Receive the AM handoff",
      "Assign the Chief of Transit",
      "Later: confirm delivery completeness and hand to Billing",
    ],
  },
  {
    roleCode: "CHIEF_OF_TRANSIT",
    officialTitle: "Chef Transit",
    permissions: [...P_READ, "process:manage", "file:read", "document:read", "customs:read"],
    forbidden: [
      "Prepare AND validate the same declaration (maker-checker)",
      "See the Transport, Billing or Finance queues",
    ],
    primaryActions: [
      "Land on /my-work",
      "Receive the Coordinator handoff",
      "Assign the Declarant",
      "VALIDATE the Declarant's work — as a checker, never as the maker",
    ],
  },
  {
    roleCode: "CUSTOMS_DECLARANT",
    officialTitle: "Déclarant",
    permissions: [...P_READ, "process:manage", "customs:read", "customs:write", "document:read"],
    forbidden: [
      "Validate their own declaration — the engine refuses on IDENTITY",
      "See the Billing, Finance or Collections queues",
    ],
    primaryActions: [
      "Land on /my-work → À réceptionner",
      "Receive the handoff from the Chef Transit",
      "Prepare the declaration and attach evidence",
      "SUBMIT for validation (it must then appear under 'À transmettre', NOT 'À valider')",
    ],
  },
  {
    roleCode: "CUSTOMS_FINANCE_OFFICER",
    officialTitle: "Finance Douane",
    permissions: [...P_READ, "process:manage", "customs:read", "finance:read", "document:read"],
    forbidden: ["See the Transport or Collections queues", "Validate a commercial invoice"],
    primaryActions: [
      "Receive the declaration handoff",
      "Record the GAINDE registration milestone",
      "Record the GAINDE document milestone",
    ],
  },
  {
    roleCode: "CUSTOMS_FIELD_AGENT",
    officialTitle: "Agent Terrain Douane",
    permissions: [...P_READ, "process:manage", "customs:read", "customs:write", "document:read"],
    forbidden: ["See the Finance, Billing or Collections queues"],
    primaryActions: [
      "Follow up the customs circuit on the ground",
      "Record the Bon à Enlever (BAE)",
    ],
  },
  {
    roleCode: "TRANSPORT_OFFICER",
    officialTitle: "Transport",
    permissions: [...P_READ, "process:manage", "transport:read", "transport:write", "tracking:read", "document:read"],
    forbidden: [
      "See a driver's PERSONAL phone number as a customer contact (never, by default)",
      "See the Billing, Finance or Collections queues",
      "Start a pickup before the pickup gate is satisfied",
    ],
    primaryActions: [
      "Land on /my-work; open /transport-readiness",
      "Assign the vehicle and the driver",
      "Confirm the Bon à Délivrer and the Pre-Gate",
      "Confirm the pickup gate is GREEN before releasing",
    ],
  },
  {
    roleCode: "PICKUP_AGENT",
    officialTitle: "Agent d'enlèvement",
    permissions: [...P_READ, "process:manage", "transport:read", "document:read"],
    forbidden: ["Bypass the pickup gate", "See the Finance or Collections queues"],
    primaryActions: [
      "Execute the pickup once the gate is green",
      "Confirm delivery and obtain the SIGNED delivery note (POD)",
    ],
  },
  {
    roleCode: "BILLING_OFFICER",
    officialTitle: "Facturation",
    permissions: [...P_READ, "process:manage", "finance:read", "finance:create", "document:read", "file:read"],
    forbidden: [
      "VALIDATE their own invoice — maker-checker on IDENTITY",
      "Edit an invoice after submitting it (hardened in 5.0D-2)",
      "Email an invoice that Finance has not validated",
    ],
    primaryActions: [
      "Receive the Coordinator/AM completeness handoff",
      "Draft the invoice",
      "SUBMIT it for Finance validation",
    ],
  },
  {
    roleCode: "FINANCE_OFFICER",
    officialTitle: "Validation Finance",
    permissions: [...P_READ, "process:manage", "finance:read", "finance:create", "finance:validate", "document:read"],
    forbidden: [
      "Validate an invoice they drafted themselves",
      "Close a dossier (process:close is Supervisor + System Admin only)",
      "Mark a dossier paid without a payment record",
    ],
    primaryActions: [
      "Land on /my-work → À valider",
      "VALIDATE the invoice (as a checker, never as the maker)",
      "Trigger the validated-invoice email",
    ],
  },
  {
    roleCode: "ADMINISTRATIVE_OFFICER",
    officialTitle: "Service administratif",
    permissions: [...P_READ, "process:manage", "admin_service:manage", "document:read", "finance:read"],
    forbidden: ["Validate an invoice", "Close a dossier", "Act on another tenant's deposit"],
    primaryActions: [
      "Land on /my-work; open /deposits",
      "Receive the validated invoice for physical deposit",
      "Dispatch it to a Coursier",
      "Accept (or refuse) the returned proof of deposit",
    ],
  },
  {
    roleCode: "COURIER",
    officialTitle: "Coursier",
    permissions: [...P_READ, "courier:deposit"],
    forbidden: [
      "See ANY other department — no Collections, no portfolio, no admin deposits",
      "Reach /dashboard (they hold no analytics:read; this is why they land on /courier)",
      "Act on a deposit not assigned to them (enforced by RLS, not only by the UI)",
    ],
    primaryActions: [
      "Land on /courier — NOT on an empty dashboard",
      "Accept the deposit run",
      "Deposit the invoice and capture the proof (stamp / signature)",
    ],
  },
  {
    roleCode: "COLLECTIONS_OFFICER",
    officialTitle: "Recouvrement",
    permissions: [...P_READ, "process:manage", "collections:manage", "finance:read", "communication:read"],
    forbidden: [
      "CLOSE the dossier — recovery complete (step 26) is NOT closure",
      "See the portfolio or the deposits admin panel",
      "Create or validate an invoice",
    ],
    primaryActions: [
      "Land on /collections (the aging balance)",
      "Record a follow-up, a promise, a dispute",
      "Record partial then full payment",
      "Mark recovery complete at step 26 — and confirm the dossier is still NOT closed",
    ],
  },
  {
    roleCode: "SYSTEM_ADMIN",
    officialTitle: "Supervisor / System Admin",
    permissions: [
      ...P_READ, "process:manage", "process:close", "file:read", "file:create", "analytics:read",
      "document:read", "customs:read", "transport:read", "finance:read", "client:read",
      "communication:read", "collections:manage", "admin_service:manage", "admin:users:manage",
      "audit:read:all", "admin:config:manage",
    ],
    forbidden: [
      "process:override — granted to NO role, by design",
      "Approve a step they submitted (identity beats permission)",
      "Reach /platform, or toggle their own tenant's rollout",
    ],
    primaryActions: [
      "Verify every role's landing and navigation",
      "Run the pilot checklist",
      "Perform the explicit closure once, at the very end",
    ],
  },
];

// ---------------------------------------------------------------- derivation ----

export type PilotRoleView = {
  role: PilotRole;
  /** French label shown in the topbar. Never a raw role code. */
  displayLabel: string | null;
  /** Where this role lands — computed by the real landing resolver. */
  landing: string;
  /** The sidebar this role actually gets — computed by the real nav builder. */
  sections: { label: string; items: string[] }[];
  /** The queues this role staffs — from the canonical registry. */
  queues: { key: string; label: string }[];
  /** Queues this role must NOT see. The complement, computed. */
  hiddenQueues: string[];
  /** The official steps this role owns, from the 26-step registry. */
  ownedSteps: { number: number | null; label: string }[];
  /** Who this role hands the dossier to next, derived from the step registry. */
  handsOffTo: string[];
  /** Whether the official role is actually mapped to a tenant role at all. */
  mapped: boolean;
};

function contextFor(role: PilotRole): NavigationContext {
  return {
    userId: `pilot-${role.roleCode}`,
    tenantId: "pilot-tenant",
    roleCodes: [role.roleCode],
    permissions: role.permissions,
    // A courier-only user is a separate surface (5.0E-3), like a driver: no staff
    // sidebar, their own route at /courier.
    identityType: isCourierOnly([role.roleCode]) ? "courier" : "tenant",
    featureFlags: PILOT_FLAGS,
  };
}

export function buildPilotMatrix(): PilotRoleView[] {
  return PILOT_ROLES.map((role) => {
    const ctx = contextFor(role);
    const nav = buildNavigation(ctx);
    const queues = visibleQueues([role.roleCode], role.permissions);

    const visibleKeys = new Set(queues.map((q) => q.key));

    // The official role behind this tenant role, so we can find its steps.
    const mapping = ROLE_MAPPINGS.find((m) => m.tenantRole === role.roleCode);

    const ownedSteps = mapping
      ? EFFITRANS_PROCESS.filter((s) => s.role === mapping.officialRole).map((s) => ({
          number: s.stepNumber,
          label: s.labelFr,
        }))
      : [];

    // Who receives the work next. Derived from the step registry's own sequencing,
    // so it stays true if the process is ever amended.
    const handsOffTo = [
      ...new Set(
        EFFITRANS_PROCESS.filter((s) => mapping && s.role === mapping.officialRole)
          .flatMap((s) => EFFITRANS_PROCESS.filter((n) => n.prerequisites?.includes(s.key)))
          .map((n) => n.role as string)
          .filter((r) => Boolean(r) && r !== (mapping?.officialRole as string)),
      ),
    ];

    return {
      role,
      displayLabel: primaryRoleLabel([role.roleCode]),
      landing: resolveLandingRoute(ctx),
      sections: nav.sections.map((s) => ({ label: s.label, items: s.items.map((i) => i.label) })),
      queues: queues.map((q) => ({ key: q.key, label: q.labelFr })),
      hiddenQueues: QUEUES.filter((q) => !visibleKeys.has(q.key)).map((q) => q.key),
      ownedSteps,
      handsOffTo,
      mapped: Boolean(mapping),
    };
  });
}
