"use client";

/**
 * Customer satisfaction placeholder (Phase 3.3 D13). Shown after delivery.
 * Stores NOTHING — a purely local UI placeholder for a future feedback feature.
 */
import { useState } from "react";
import { t } from "@/lib/i18n";

export function Satisfaction() {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const s = t.portal.premium.satisfaction;

  if (submitted) {
    return (
      <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-5 text-center shadow-card">
        <p className="text-2xl" aria-hidden>🎉</p>
        <p className="mt-1 text-sm font-semibold text-teal-800">{s.thanks}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-card">
      <p className="text-sm font-semibold text-navy-900">{s.title}</p>
      <p className="mt-0.5 text-xs text-slate-500">{s.subtitle}</p>

      <div className="mt-3 flex justify-center gap-1" role="radiogroup" aria-label={s.subtitle}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n}/5`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className={`text-2xl transition ${(hover || rating) >= n ? "text-amber-400" : "text-slate-200"}`}
          >
            ★
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={rating === 0}
        onClick={() => setSubmitted(true)}
        className="mt-4 rounded-xl bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-800 disabled:opacity-40"
      >
        {s.feedback}
      </button>
    </div>
  );
}
