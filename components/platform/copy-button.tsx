"use client";

/**
 * Copy-to-clipboard button (Phase 6.0C). CLIENT.
 * ---------------------------------------------------------------------------
 * A real, supported quick action (unlike suspend/archive, which have no backing
 * action yet). Copies a NON-secret value — a slug or a tenant id — nothing sensitive
 * ever passes through here.
 */
import { useState } from "react";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
    >
      {copied ? "Copié" : label}
    </button>
  );
}
