/**
 * Customer AI Assistant — customer context reader (Phase 7.6C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The CUSTOMER-SCOPED replacement for getCommandCenter(): where the Logistics Copilot assembles a
 * TENANT-WIDE operator snapshot, this assembles ONLY what the authenticated portal user can
 * already see on their own pages. It COMPOSES the existing, RLS-enforced portal readers and adds
 * NO new domain calculation and NO write path:
 *
 *   getPortalTracking(fileId)   → route, customer timeline, progress, ETA, delay, next step,
 *                                 documents + requirements, self-service, officer, activity
 *   getPortalCarriage(fileId)   → vessel/flight, containers/ULDs, safe references, map projection
 *   listPortalInvoices(fileId)  → the customer's own invoices
 *   listClientNotifications()   → the customer's own notifications
 *   getPortalShipments()        → the customer's other shipments (portfolio scope)
 *
 * ISOLATION. Every reader above resolves the caller with getCurrentPortalUser() and reads through
 * the RLS user-context client, so tenant + customer scoping is enforced by the DATABASE, not by
 * this file. This module holds NO service-role client and performs NO query of its own — it cannot
 * widen the boundary even by mistake. An unowned fileId simply yields null (uniform, no probe).
 *
 * SAFETY. Only customer-safe projections are copied out. Deliberately NOT carried into the model
 * context, even though nearby code has them: internal risk score, SLA, internal customs status /
 * blocking reason, reviewer notes (`review_note` free text — also a prompt-injection surface),
 * tracking source/confidence, provider diagnostics, internal ids, other customers.
 *
 * PERFORMANCE. Bounded and degrade-by-section: the readers run under Promise.allSettled, each
 * section is capped by the question class (reusing the shared budget), and a section that is
 * absent or fails is recorded in `unavailable` so the assistant says "not available" instead of
 * "nothing to report" (Missing ≠ Negative). No tenant-wide scan, no N+1 — the composed readers are
 * already batched.
 */
import "server-only";
import { getCurrentPortalUser } from "../auth";
import { getPortalTracking } from "../tracking";
import { getPortalCarriage } from "../carriage";
import { listPortalInvoices } from "../docs-service";
import { getPortalShipments } from "../shipments";
import { listClientNotifications } from "@/lib/customer-notify/service";
import { classifyPortalQuestion, portalSectionCaps } from "./budget";
import { portalCustomsView, portalMapSummary } from "./view";
import type { PortalCopilotCarriage, PortalCopilotContext, PortalCopilotShipment, PortalSection } from "./types";

/** Hard ceilings — a bound that holds regardless of the question class. */
const PORTFOLIO_CAP = 25;
const NOTIFICATION_CAP = 20;
const ACTIVITY_CAP = 15;

const uniq = <T,>(a: T[]): T[] => Array.from(new Set(a));
const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

/**
 * Assemble the bounded, read-only customer snapshot.
 * @param question drives the allowlisted classifier (never the model)
 * @param fileId   an owned dossier to focus on; omit for portfolio scope
 */
export async function getPortalShipmentContext(question = "", fileId?: string): Promise<PortalCopilotContext | null> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return null; // gate → 403 in the route

  const questionClass = classifyPortalQuestion(question);
  const caps = portalSectionCaps(questionClass);
  const generatedAt = new Date().toISOString();

  const sections: PortalSection[] = [];
  const unavailable: PortalSection[] = [];
  const truncated: PortalSection[] = [];
  const capTo = <T,>(rows: T[], s: PortalSection, hard: number): T[] => {
    const limit = Math.min(caps[s], hard);
    if (rows.length > limit) { truncated.push(s); return rows.slice(0, limit); }
    return rows;
  };

  // Every read below is RLS-scoped to this portal user's own client. Degrade by section.
  const [trackingR, carriageR, invoicesR, notificationsR, portfolioR] = await Promise.allSettled([
    fileId ? getPortalTracking(fileId) : Promise.resolve(null),
    fileId ? getPortalCarriage(fileId) : Promise.resolve(null),
    fileId ? listPortalInvoices(fileId) : listPortalInvoices(),
    listClientNotifications(NOTIFICATION_CAP),
    getPortalShipments(),
  ]);

  const tracking = settled(trackingR);
  const carriageRaw = settled(carriageR);
  const invoicesRaw = settled(invoicesR);
  const notificationsRaw = settled(notificationsR);
  const portfolioRaw = settled(portfolioR);

  // A focused fileId that resolves to nothing = not owned (or gone). Uniform null: never a probe.
  if (fileId && !tracking) return null;

  // ---- shipment (focused dossier) ----
  let shipment: PortalCopilotShipment | null = null;
  let customs: PortalCopilotContext["customs"] = null;
  if (tracking) {
    shipment = {
      fileNumber: tracking.fileNumber,
      type: tracking.shipmentType,
      route: tracking.route.display,
      currentStage: tracking.currentStageKey,
      currentLocation: tracking.currentLocation,
      currentDepartment: tracking.currentDepartment,
      progressPercent: tracking.progressPercent,
      delay: { state: tracking.delay.state, label: tracking.delay.label, explanation: tracking.delay.explanation },
      eta: {
        estimatedDate: tracking.eta.estimatedDate,
        basis: tracking.eta.basis,
        delayDays: tracking.eta.delayDays,
        delivered: tracking.eta.basis === "delivered",
      },
      nextStep: {
        title: tracking.nextStep.title,
        explanation: tracking.nextStep.explanation,
        clientAction: tracking.nextStep.clientAction,
        party: tracking.nextStep.party,
      },
      transportStatusLabel: tracking.transport?.statusLabel ?? null,
      lastActivityAt: tracking.lastActivityAt,
      podAvailable: tracking.podAvailable,
      link: `/portal/files/${tracking.fileId}`,
    };
    sections.push("shipment");
    customs = portalCustomsView(tracking);
    sections.push("customs");
  } else if (fileId) {
    unavailable.push("shipment", "customs");
  }

  // ---- transport (vessel / flight / map) ----
  let carriage: PortalCopilotCarriage | null = null;
  if (carriageRaw) {
    carriage = {
      mode: carriageRaw.mode,
      transportLabel: carriageRaw.transportLabel,
      carrierOrVessel: carriageRaw.carrierOrVessel,
      voyageOrFlight: carriageRaw.voyageOrFlight,
      milestoneLabel: carriageRaw.milestoneLabel,
      references: carriageRaw.references,
      units: { heading: carriageRaw.units.heading, items: carriageRaw.units.items.slice(0, caps.transport) },
      map: portalMapSummary(carriageRaw),
    };
    sections.push("transport");
  } else if (fileId && tracking) {
    // Road-only / no international carriage is a real answer, not a failure: the dossier's own
    // transport status still describes it. Only flag unavailable when the read itself failed.
    if (carriageR.status === "rejected") unavailable.push("transport");
    else sections.push("transport");
  }

  // ---- documents + requirements (focused dossier only) ----
  let requirements: PortalCopilotContext["requirements"] = [];
  let documents: PortalCopilotContext["documents"] = [];
  if (tracking) {
    requirements = capTo(
      tracking.documents.requirements.map((r) => ({ label: r.label, state: r.state })),
      "documents",
      50,
    );
    documents = capTo(
      tracking.documents.available.map((d) => ({
        typeLabel: d.typeLabel,
        status: d.status,
        createdAt: d.createdAt,
        link: `/portal/files/${tracking.fileId}`,
      })),
      "documents",
      50,
    );
    sections.push("documents");
  }

  // ---- invoices ----
  let invoices: PortalCopilotContext["invoices"] = [];
  if (invoicesRaw) {
    invoices = capTo(
      invoicesRaw.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        currency: i.currency,
        total: i.total,
        balance: i.balance,
        dueDate: i.dueDate,
        overdue: i.overdue,
        link: `/portal/invoices/${i.id}`,
      })),
      "invoices",
      50,
    );
    sections.push("invoices");
  } else unavailable.push("invoices");

  // ---- notifications (scoped to the focused dossier when there is one) ----
  let notifications: PortalCopilotContext["notifications"] = [];
  if (notificationsRaw) {
    notifications = capTo(
      notificationsRaw
        .filter((n) => (fileId ? n.fileId === fileId : true))
        .map((n) => ({ title: n.title, category: n.category, createdAt: n.createdAt, read: n.readAt != null })),
      "notifications",
      NOTIFICATION_CAP,
    );
    sections.push("notifications");
  } else unavailable.push("notifications");

  // ---- contact (assigned account manager, or the operations-team fallback) ----
  let contact: PortalCopilotContext["contact"] = null;
  if (tracking) {
    contact = {
      name: tracking.officer.name,
      title: tracking.officer.title,
      isTeam: tracking.officer.isTeam,
      businessEmail: tracking.officer.businessEmail,
      businessPhone: tracking.officer.businessPhone,
    };
    sections.push("contact");
  }

  // ---- portfolio (the customer's own other shipments) ----
  let portfolio: PortalCopilotContext["portfolio"] = [];
  if (portfolioRaw) {
    portfolio = capTo(
      portfolioRaw
        .filter((s) => (fileId ? s.id !== fileId : true))
        .map((s) => ({
          fileNumber: s.fileNumber,
          reference: s.reference,
          route: s.routeDisplay,
          status: s.status,
          percent: s.percent,
          eta: s.eta,
          delayLabel: s.delayLabel,
          nextStepTitle: s.nextStepTitle,
          link: `/portal/files/${s.id}`,
        })),
      "shipment",
      PORTFOLIO_CAP,
    );
    if (!fileId) sections.push("shipment");
  } else if (!fileId) unavailable.push("shipment");

  // ---- activity (customer timeline of the focused dossier) ----
  const activity = tracking
    ? capTo(tracking.activity.map((a) => ({ title: a.title, date: a.date })), "notifications", ACTIVITY_CAP)
    : [];

  const consulted = uniq(sections);
  return {
    generatedAt,
    questionClass,
    scope: fileId ? "shipment" : "portfolio",
    clientName: user.clientName,
    sections: consulted,
    unavailable: uniq(unavailable).filter((s) => !consulted.includes(s)),
    truncated: uniq(truncated),
    shipment,
    carriage,
    customs,
    portfolio,
    requirements,
    documents,
    invoices,
    notifications,
    activity,
    contact,
    counts: {
      portfolio: portfolio.length,
      requirements: requirements.length,
      documents: documents.length,
      invoices: invoices.length,
      notifications: notifications.length,
      activity: activity.length,
    },
  };
}
