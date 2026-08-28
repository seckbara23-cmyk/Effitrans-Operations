/**
 * THE BASE NAVIGATION — the five agreed sections. PURE DATA.
 * ---------------------------------------------------------------------------
 * PILOTAGE · DOSSIERS · DÉPARTEMENTS · MANAGEMENT · ADMINISTRATION
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT WAS WRONG UNTIL 5.0E-3B
 * -------------------------------------------------------------
 * These sections used to be the *legacy* sidebar — the pre-process-engine navigation,
 * rendered only when the workspaces flag was OFF. The agreed five-section structure
 * lived exclusively in the flag-ON branch of the navigation builder.
 *
 * That was a mistake, and production showed it: with the flag off (which is every
 * tenant today), the deployed app still displayed "Dédouanement", stranded "Direction"
 * under DÉPARTEMENTS, and titled a section "OPÉRATIONS". The agreed structure never
 * appeared anywhere.
 *
 * The error was conceptual. INFORMATION ARCHITECTURE IS NOT A FEATURE OF THE PROCESS
 * ENGINE. Dossiers, Clients, Communications, the four departments, Direction, Rapports,
 * the executive board, Utilisateurs, the audit log and Paramètres all exist today and
 * all work with the engine dark. Only two entries genuinely depend on it — "Mon Travail"
 * and "Parcours des dossiers" — and those are added by the builder when the flag is on.
 *
 * So this is the BASE. It is what every tenant sees, flag or no flag. The engine adds
 * to it; it does not replace it.
 *
 * WHY THE LABELS ARE LITERAL AND NOT t.nav.*
 * ------------------------------------------
 * The i18n keys carried the wrong words ("Dédouanement", "Paramètres IA", a section
 * called "Opérations"). Those strings are still used elsewhere; renaming the keys under
 * them would have been a rename with a blast radius. The sidebar's labels are part of
 * the agreed contract and are asserted verbatim by tests/journeys.test.ts, so they are
 * stated here, once, where the contract is.
 *
 * NOTE ON FILTERING: this list is NOT permission-filtered. On the flag-off path the
 * root layout deliberately resolves NO session (that is what keeps /login statically
 * prerendered and costs a dark deployment zero auth work), so the client applies the
 * same cosmetic `canSeeNav` filter it has since Phase 2.0 — see Navigation.filtered.
 * Every route re-checks server-side regardless; a hidden link has never been the
 * authorization.
 */
import type { NavigationItem, NavigationSection } from "./navigation/types";

export type NavItem = NavigationItem;
export type NavSection = NavigationSection;

export const BASE_SECTIONS: NavigationSection[] = [
  {
    key: "pilotage",
    label: "Pilotage",
    items: [
      // Ungated here, deliberately. With the process engine dark, /dashboard is the
      // ONLY landing an operational user has — hiding it behind analytics:read would
      // strand them on an empty app. Once the engine is on, Mon Travail exists as the
      // better destination, and the builder DOES gate the control tower by role. You
      // may only take someone's front door away once you have given them another one.
      { key: "operations-center", label: "Centre d'opérations", href: "/dashboard", iconKey: "tower" },
      // HR-B1 — « Mes congés » is ungated LIKE THE DASHBOARD, deliberately: it
      // is every staff member's personal leave space, and what a visitor can DO
      // there is decided by identity (their linked employee record, their
      // manager relationship) and by the database — not by a nav permission.
      // An unlinked account sees a plain explanation, never an error.
      { key: "my-leave", label: "Mes congés", href: "/conges", iconKey: "team" },
      // HR-B2 — « Mes évaluations », ungated for the same reason as « Mes
      // congés »: personal space, where identity (not a nav permission)
      // decides what a visitor can do.
      { key: "my-evaluations", label: "Mes évaluations", href: "/evaluations", iconKey: "report" },
      // "Mon Travail" and "Parcours des dossiers" are added by the navigation builder
      // when the process workspaces are live. They are the only two entries in the
      // whole sidebar that genuinely require the engine.
    ],
  },
  {
    key: "files",
    label: "Dossiers",
    items: [
      { key: "files", label: "Dossiers", href: "/files", iconKey: "container", permission: "file:read" },
      { key: "clients", label: "Clients", href: "/clients", iconKey: "users", permission: "client:read" },
      {
        key: "enterprise-mail",
        // Enterprise Mail, not "Communications": this workspace IS the mail
        // platform (inbound capture, triage, threads, compose, ingestion).
        // "Communications" is reserved for a future omnichannel workspace —
        // SMS, WhatsApp, portal messaging, notifications — which must not be
        // forced in here.
        //
        // Kept in English, unlike every sibling label. A French rendering was
        // tried and rejected: "Messagerie d'entreprise" sits one word away from
        // "Messagerie" (Phase 8.7, staff/portal chat at /messages) in THIS SAME
        // section, and two adjacent entries differing by one word for two
        // unrelated systems is precisely the confusion this rename exists to
        // end. "Enterprise Mail" is a product name and collides with nothing.
        label: "Enterprise Mail",
        href: "/mail",
        iconKey: "bell",
        permission: "communication:read",
      },
      // "Messagerie" (Phase 8.7) is NOT listed here — unlike everything else in this
      // BASE list, it is gated behind the tenant messaging rollout flag (a disabled
      // tenant must see NO trace of an incomplete feature), so it is injected
      // conditionally by lib/navigation/build.ts, exactly like "Mon Travail" is for
      // the process-workspaces flag.
    ],
  },
  {
    key: "departments",
    label: "Départements",
    // The sidebar Départements are Opérations, Transit, TRANSPORT and Finance.
    // HR is a support department and stays out of the operational sidebar.
    //
    // TMS-5B — Transport became a first-class NAVIGATION department by business
    // decision: Transit keeps customs and international follow-up (Douane,
    // Intelligence douanière, Suivi maritime, Suivi aérien) while Transport owns
    // ground execution (demandes, exécution, Parc & Flotte).
    //
    // ⚠ This list no longer mirrors lib/organization/departments.ts, which still
    // enumerates four CANONICAL departments (OPERATIONS / TRANSIT / FINANCE /
    // HUMAN_RESOURCES) and still maps TRANSPORT_OFFICER, PICKUP_AGENT and DRIVER
    // to TRANSIT ("business decision 5"). That registry drives role→department
    // derivation, messaging and workflow access — NOT this sidebar — so the
    // navigation change is deliberately decoupled from it. Reconciling the
    // canonical registry is a separate, load-bearing organizational decision.
    //
    // Documentation (an Operations capability) and Douane + Transport (Transit
    // execution) are no longer top-level entries — they are WORKSPACES reached
    // from their department hub page. Their ROUTES are unchanged
    // (/departments/documentation, /departments/customs, /departments/transport),
    // so no URL breaks and no redirect is needed; only the sidebar entry-points move.
    items: [
      {
        key: "operations",
        label: "Opérations",
        href: "/departments/operations",
        // HR-4: a GEAR, not a container — Operations must not wear a transport
        // metaphor while Transit wears the truck.
        iconKey: "gear",
        // Owns dossiers, clients and documentation — visible to any of their readers.
        // EC-3C adds the quotation authorities: the Commercial workspace lives on
        // this hub (DÉPARTEMENTS stays at exactly three entries), and a quotation
        // agent holds none of the first three codes, so without this the section
        // never appeared and the workspace was unreachable.
        permissionsAnyOf: [
          "file:read", "client:read", "document:read",
          "quotation:create", "quotation:validate",
        ],
      },
      {
        key: "transit",
        label: "Transit",
        href: "/departments/transit",
        iconKey: "truck",
        // TMS-5B — Transit owns customs and INTERNATIONAL shipment follow-up
        // (Douane, Intelligence douanière, Suivi maritime, Suivi aérien); ground
        // execution moved to the Transport department. transport:read stays in
        // the any-of because maritime and air follow-up are gated on it.
        permissionsAnyOf: ["customs:read", "transport:read"],
      },
      {
        key: "transport",
        label: "Transport",
        href: "/departments/transport",
        iconKey: "container",
        // TMS-5B — visibility rides the EXISTING transport authority; no
        // permission was invented for a sidebar entry. The hub re-checks.
        permission: "transport:read",
      },
      { key: "finance", label: "Finance", href: "/departments/finance", iconKey: "finance", permission: "finance:read" },
      // FIN-AGING-3 deliberately adds NOTHING here. « Balance âgée » is a Finance
      // WORKSPACE reached from the Finance hub, exactly as Douane, Documentation
      // and Caisse are from theirs. Its entry lives in app/departments/finance.
      // (The section held exactly three entries until TMS-5B added Transport as
      // a department in its own right — a workspace still never earns one.)
    ],
  },
  {
    key: "management",
    label: "Management",
    items: [
      // Direction was previously listed as a fifth "department", which is what it is in
      // the URL but not what it is to the business. It is management oversight.
      {
        key: "direction",
        label: "Direction",
        href: "/departments/management",
        iconKey: "building",
        permission: "analytics:read",
      },
      // Phase HR-1 — HR is a corporate SUPPORT/management function, not an
      // operational department, so its workspace lives under MANAGEMENT (never
      // in DÉPARTEMENTS). Gated on hr:read; the /departments/hr route re-checks.
      {
        key: "hr",
        label: "Ressources humaines",
        href: "/departments/hr",
        // HR-4: a TEAM mark, distinct from Administration's IconUsers.
        iconKey: "team",
        permission: "hr:read",
      },
      // Gestion de la Performance — the ICTD / ICAM / IPAM module. Its own
      // capability, deliberately not analytics:read: reading company reports and
      // reading an indicator about a named colleague's work are different
      // audiences, and conflating them would hand every analytics holder a
      // per-person performance view nobody ratified. The /performance layout
      // re-checks; this entry is cosmetic.
      {
        key: "performance",
        label: "Gestion de la Performance",
        href: "/performance",
        iconKey: "report",
        permission: "performance:read",
      },
      { key: "reports", label: "Rapports", href: "/reports", iconKey: "report", permission: "analytics:read" },
      {
        key: "executive",
        label: "Tableau exécutif",
        href: "/dashboard/executive",
        iconKey: "tower",
        // Phase 7.7 — narrowed from analytics:read: the executive command center is for the
        // executive/management tier, while analytics:read remains the wider reporting audience
        // (Direction, Rapports). Filtering is cosmetic; the page re-checks server-side.
        permission: "executive:dashboard:read",
      },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    items: [
      { key: "users", label: "Utilisateurs", href: "/users", iconKey: "users", permission: "admin:users:manage" },
      // EMP-4A — mailbox identity and access administration. Placed under
      // Administration → Utilisateurs, NOT in the /mail workspace: using a
      // mailbox and deciding who may use it are different jobs held by
      // different people. Gated on provisioning, which MAIL_ADMIN holds and
      // SYSTEM_ADMIN deliberately does not.
      {
        key: "enterprise-mail-admin",
        // ADMIN-MAIL-ROUTING — "Administration Mail", not a second entry called
        // "Enterprise Mail". Two identically-named entries in different sections
        // is what made the reported screenshot ambiguous before the double
        // highlight was even noticed.
        label: "Administration Mail",
        // Canonical home is /admin/enterprise-mail, NOT a child of /users. As a
        // child it was structurally a sub-page of the user-management module,
        // which is why the sidebar lit « Utilisateurs » and this entry at once.
        //
        // The href is the module ROUTER, not one of its pages. Pointing it at
        // the mailbox page is what produced the production 404: the entry is
        // visible to any of three permissions, but that page accepts only two of
        // them, so a `communication:manage` holder saw the entry and hit
        // notFound(). The router sends each holder to a surface they can open.
        href: "/admin/enterprise-mail",
        iconKey: "bell",
        // EITHER mailbox-administration authority — and deliberately NOT
        // `communication:manage`.
        //
        // EMP-IA-1 added `communication:manage` here so that holders of it
        // (OPS_SUPERVISOR, SYSTEM_ADMIN) could reach the capture and journal
        // tabs. That had two consequences it should not have had: it produced
        // the production 404, because those holders could open neither of the
        // two surfaces this entry led to; and it silently overturned EMP-4A's
        // ratified position that SYSTEM_ADMIN stays out of mail administration.
        // A navigation phase must not move a governance boundary, so the
        // ratified gate is restored here.
        //
        // The router at /admin/enterprise-mail still resolves a
        // `communication:manage` holder who arrives by direct URL to the
        // capture surface, so nothing they are entitled to read became
        // unreachable — only unadvertised. Whether they should have a nav path
        // is a governance question, raised rather than answered.
        permissionsAnyOf: [
          "communication:mailbox:provision",
          "communication:membership:manage",
        ],
      },
      // DBC-1 — Digital Brand Center (tenant module). Gated by admin:config:manage.
      { key: "brand-center", label: "Centre de marque", href: "/brand-center", iconKey: "building", permission: "admin:config:manage" },
      { key: "audit", label: "Journal d'audit", href: "/settings/audit", iconKey: "stamp", permission: "audit:read:all" },
      // Paramètres is the hub. The AI settings live UNDER it (/settings/ai) rather than
      // as a fourth top-level entry called "Paramètres IA", which described the one
      // settings page that happened to exist first.
      {
        key: "settings",
        label: "Paramètres",
        href: "/settings",
        iconKey: "building",
        permission: "admin:config:manage",
      },
    ],
  },
];

/** Back-compat alias. Same data — this is no longer a "legacy" list, it is the base. */
export const LEGACY_SECTIONS = BASE_SECTIONS;
export const navSections = BASE_SECTIONS;

/** Flat list (used by the topbar breadcrumb / page metadata lookups). */
export const allNavItems: NavItem[] = BASE_SECTIONS.flatMap((s) => s.items);

/**
 * Top-bar primary action — "Nouveau dossier". Points at the existing dossier
 * creation route and is cosmetically gated by file:create (canSeeNav); the
 * /files/new route re-checks the permission server-side.
 */
export const newDossierAction = {
  href: "/files/new",
  permission: "file:create",
} as const;
