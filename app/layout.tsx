import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
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
        <AppShell navigation={navigation}>{children}</AppShell>
      </body>
    </html>
  );
}
