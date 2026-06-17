/**
 * Department dashboard card mapping (Dashboard UX) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Maps the EXISTING Phase 2.0 classifier outputs (+ handoff counts) into the
 * dashboard "Activité par département" card shape. No business logic is
 * duplicated — the counts come from the dept classifiers/services; this only
 * chooses which count is primary / secondary / alert. Labels are French inline
 * (single-locale app, consistent with the classifiers).
 */
import type { CustomsCards, TransportCards, DocumentationCards } from "./classify";

export type DeptCardKey = "documentation" | "customs" | "transport" | "finance" | "management";
export type DeptMetric = { label: string; value: number };
export type DepartmentCardData = {
  key: DeptCardKey;
  title: string;
  href: string;
  primary: DeptMetric;
  secondary: DeptMetric;
  alert?: DeptMetric;
};

export function documentationCardData(c: DocumentationCards, readyForCustoms: number): DepartmentCardData {
  return {
    key: "documentation",
    title: "Documentation",
    href: "/departments/documentation",
    primary: { label: "Documents manquants", value: c.missing },
    secondary: { label: "Prêt pour la douane", value: readyForCustoms },
    alert: { label: "Dossiers urgents", value: c.urgent },
  };
}

export function customsCardData(c: CustomsCards, blocked: number): DepartmentCardData {
  return {
    key: "customs",
    title: "Dédouanement",
    href: "/departments/customs",
    primary: { label: "Prêt pour déclaration", value: c.readyForDeclaration },
    secondary: { label: "Sous inspection", value: c.underInspection },
    alert: { label: "Bloqués", value: blocked },
  };
}

export function transportCardData(c: TransportCards): DepartmentCardData {
  return {
    key: "transport",
    title: "Transport",
    href: "/departments/transport",
    primary: { label: "Prêt pour dispatch", value: c.readyForDispatch },
    secondary: { label: "En transit", value: c.inTransit },
    alert: { label: "POD requis", value: c.podRequired },
  };
}

export function financeCardData(
  kpis: { issued: number; overdue: number },
  paymentsToVerify: number,
): DepartmentCardData {
  return {
    key: "finance",
    title: "Finance",
    href: "/departments/finance",
    primary: { label: "Factures en cours", value: kpis.issued },
    secondary: { label: "Paiements à vérifier", value: paymentsToVerify },
    alert: { label: "En retard", value: kpis.overdue },
  };
}

export function managementCardData(ops: { active: number; highPriority: number; blocked: number }): DepartmentCardData {
  return {
    key: "management",
    title: "Direction",
    href: "/departments/management",
    primary: { label: "Dossiers actifs", value: ops.active },
    secondary: { label: "Priorité haute", value: ops.highPriority },
    alert: { label: "Opérations bloquées", value: ops.blocked },
  };
}
