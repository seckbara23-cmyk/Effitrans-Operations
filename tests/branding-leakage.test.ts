/**
 * Phase 4.0B-5 — branding leakage scan + client-bundle safety.
 *
 * Proves (1) the resolver — the single source every surface reads — never emits
 * Effitrans strings for another tenant, (2) the de-branded surfaces actually read
 * from that source (wiring can't silently regress), and (3) no client component
 * imports a server-only branding path (bundle safety).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { mergeBranding } from "@/lib/branding/resolve";
import { reportBrand } from "@/lib/reports/brand";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${REPO}/${rel}`, "utf8");

const TENANT_B = mergeBranding(
  { name: "Baobab Trading", tradeName: "Baobab", legalName: "Baobab SARL" },
  { display_name: "Baobab Trading", tagline: "Fret & Douane", primary_color: "#123456", email_footer: "Baobab · Abidjan" },
);

function assertNoEffitrans(s: string) {
  expect(s.toLowerCase()).not.toContain("effitrans");
  expect(s).not.toContain("Transit • Logistique • Douane");
  expect(s.toLowerCase()).not.toContain("dakar");
}

describe("resolver never leaks Effitrans branding to another tenant", () => {
  it("tenant B resolved branding has no Effitrans strings", () => {
    for (const v of Object.values(TENANT_B)) if (typeof v === "string") assertNoEffitrans(v);
  });

  it("tenant B report chrome has no Effitrans strings", () => {
    const rb = reportBrand(TENANT_B);
    assertNoEffitrans(rb.header);
    assertNoEffitrans(rb.footer);
    assertNoEffitrans(rb.displayName);
    if (rb.subtitle) assertNoEffitrans(rb.subtitle);
  });

  it("a tenant WITHOUT a tagline gets no subtitle (never the Effitrans tagline)", () => {
    expect(reportBrand(mergeBranding({ name: "Baobab" })).subtitle).toBeUndefined();
  });
});

describe("de-branded surfaces read from the branding source (wiring guard)", () => {
  it("staff shell / portal / wordmark / reports / email all reference branding", () => {
    expect(read("components/shell/topbar.tsx")).toMatch(/session\.brandName/);
    expect(read("components/shell/sidebar.tsx")).toMatch(/session\.brandName/);
    expect(read("components/portal/portal-shell.tsx")).toMatch(/brandName/);
    expect(read("app/portal/(app)/layout.tsx")).toMatch(/resolveTenantBranding/);
    expect(read("components/brand/logo.tsx")).toMatch(/brandName/);
    expect(read("lib/reports/templates.ts")).toMatch(/this\.meta\.brand/);
    expect(read("lib/comms/render.ts")).toMatch(/EmailBrand|brand\./);
    expect(read("lib/comms/queue.ts")).toMatch(/mergeBranding|resolveTenantBranding/);
    expect(read("lib/portal/tracking.ts")).toMatch(/teamFallbackName/);
  });
});

describe("client bundle safety — no server-only branding path in a client component", () => {
  const FORBIDDEN = [
    "@/lib/supabase/admin",
    "@/lib/supabase/server",
    "@/lib/branding/service",
    "@/lib/audit/log",
    "getAdminSupabaseClient",
    "resolveTenantBranding",
    'from "server-only"',
    "from 'server-only'",
  ];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  const clientFiles = [...walk(`${REPO}/components`), ...walk(`${REPO}/lib`), ...walk(`${REPO}/app`)].filter((f) => {
    const head = readFileSync(f, "utf8").slice(0, 200);
    return /^\s*["']use client["']/.test(head);
  });

  it("finds client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it("no client component imports a server-only module", () => {
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const src = readFileSync(f, "utf8");
      for (const bad of FORBIDDEN) {
        if (src.includes(bad)) offenders.push(`${f.slice(REPO.length + 1)} :: ${bad}`);
      }
    }
    expect(offenders, `server-only import in client bundle:\n${offenders.join("\n")}`).toEqual([]);
  });
});
