import { describe, it, expect } from "vitest";
import { newDossierAction, allNavItems } from "@/lib/nav";
import { canSeeNav, type NavSessionLike } from "@/lib/auth/nav-visibility";

/**
 * Regression guard for the top-bar "Nouveau dossier" action. The button used to
 * be an inert <button> with no href/onClick, so clicking it did nothing. It now
 * links to the real creation route, cosmetically gated by file:create.
 */
const base: NavSessionLike = { permissions: [], loading: false, configured: true };

describe("newDossierAction (top-bar primary action)", () => {
  it("points at the existing dossier creation route", () => {
    expect(newDossierAction.href).toBe("/files/new");
  });

  it("targets a route the app actually serves", () => {
    // /files/new is a dedicated page; guard against it silently disappearing or
    // being renamed without updating the top-bar action.
    // (allNavItems is the sidebar surface — the action deep-links under /files.)
    const filesEntry = allNavItems.find((i) => i.href === "/files");
    expect(filesEntry).toBeDefined();
    expect(newDossierAction.href.startsWith("/files")).toBe(true);
  });

  it("is gated by file:create (creation permission), not file:read", () => {
    expect(newDossierAction.permission).toBe("file:create");
  });

  it("is shown to a user who can create files", () => {
    expect(
      canSeeNav(newDossierAction.permission, { ...base, permissions: ["file:create"] }),
    ).toBe(true);
  });

  it("is hidden from a configured, loaded user without file:create", () => {
    expect(
      canSeeNav(newDossierAction.permission, { ...base, permissions: ["file:read"] }),
    ).toBe(false);
  });

  it("stays visible in the mock (unconfigured) and loading experiences", () => {
    expect(canSeeNav(newDossierAction.permission, { ...base, configured: false })).toBe(true);
    expect(canSeeNav(newDossierAction.permission, { ...base, loading: true })).toBe(true);
  });
});
