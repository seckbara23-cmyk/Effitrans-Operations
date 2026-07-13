import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { t } from "@/lib/i18n";
import { getProcessNav } from "@/lib/process/queues/nav-server";
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
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Phase 5.0C. With EFFITRANS_PROCESS_WORKSPACES_ENABLED off this returns []
  // WITHOUT touching auth or the database, so the sidebar — and every render path
  // through it — is exactly what it was before this phase.
  const processNav = await getProcessNav();

  return (
    <html lang="fr" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans antialiased">
        <AppShell processNav={processNav}>{children}</AppShell>
      </body>
    </html>
  );
}
