import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { PwaInstallProvider } from "@/components/pwa/pwa-install-context";
import { PwaInstallIosDialog } from "@/components/pwa/pwa-install-ios-dialog";
import { t } from "@/lib/i18n";
import { getNavigation } from "@/lib/navigation/server";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: t.app.name,
    template: `%s · ${t.app.short}`,
  },
  description: t.app.tagline,
  // Phase 8.3 — PWA/mobile metadata. Tenant-neutral by construction (static for every visitor).
  applicationName: "Effitrans",
  appleWebApp: {
    capable: true,
    title: "Effitrans",
    statusBarStyle: "default",
  },
  // Phone-number auto-detection mangles shipment/dossier references on iOS — off by default.
  formatDetection: { telephone: false },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover enables env(safe-area-inset-*) for notches/home indicators.
  viewportFit: "cover",
  themeColor: "#0F766E",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Phase 5.0E-1 — the single navigation builder. Filtering happens here, on the
  // server, once. With EFFITRANS_PROCESS_WORKSPACES_ENABLED off it returns exactly
  // the pre-5.0C sections. getCurrentUser / getEffectivePermissions are React-cached
  // per request, so this adds no query to any page a user can actually see.
  const navigation = await getNavigation();

  return (
    <html lang="fr" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans antialiased">
        {/* Phase 8.5 — shared install state (beforeinstallprompt/appinstalled/dismissal),
            wrapping the whole tree so both the header action (inside AppShell) and the
            compact banner/iOS dialog (outside it) read the same single source of truth. */}
        <PwaInstallProvider>
          <AppShell navigation={navigation}>{children}</AppShell>
          {/* Phase 8.3 — PWA runtime (SW registration, update banner, network status, compact
              install banner). Mounted OUTSIDE AppShell so every surface (tenant, portal,
              platform, driver, public cards) gets it. Dark unless NEXT_PUBLIC_PWA_ENABLED="true". */}
          <PwaProvider />
          <PwaInstallIosDialog />
        </PwaInstallProvider>
      </body>
    </html>
  );
}
