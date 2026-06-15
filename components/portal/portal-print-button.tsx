"use client";

import { t } from "@/lib/i18n";

/** Browser-native PDF: print-to-PDF of the print-friendly invoice page. */
export function PortalPrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 print:hidden"
    >
      {t.portal.invoices.print}
    </button>
  );
}
