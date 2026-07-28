"use client";

/**
 * Accessible prompt dialog (UAT-2A) — replaces `window.prompt`.
 * ---------------------------------------------------------------------------
 * Three Finance flows opened a native browser prompt: the invoice due date and
 * two rejection-note captures. A native prompt cannot be styled, cannot be
 * validated before it closes, cannot express French field labels or payment
 * terms, and looks like a phishing box in an enterprise tool.
 *
 * ONE dialog serves all three, in two modes — `date` and `text` — because they
 * differ only in the field. A second modal component for the two notes would be
 * the same accessibility work done twice.
 *
 * Accessibility: `role="dialog"` + `aria-modal`, labelled by its title, focus
 * moved to the field on open, Escape cancels, Enter submits from the field, the
 * submit button is disabled while the value is invalid, and the backdrop click
 * cancels. Native `<input type="date">` is used deliberately — it brings the
 * platform date picker and keyboard behaviour for free.
 */
import { useEffect, useId, useRef, useState } from "react";

export type PromptDialogProps = {
  open: boolean;
  mode: "date" | "text";
  title: string;
  label: string;
  /** Rendered under the title; explains consequences in plain French. */
  help?: string;
  initialValue?: string;
  /** For `date`: the value the result may not precede (the issue date). */
  minDate?: string;
  /** Quick-choice buttons; `days` is added to `minDate`. `date` mode only. */
  terms?: readonly { days: number | null; labelFr: string }[];
  required?: boolean;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

const addDays = (iso: string, days: number): string => {
  const base = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(base)) return iso;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
};

export function PromptDialog({
  open,
  mode,
  title,
  label,
  help,
  initialValue = "",
  minDate,
  terms,
  required = false,
  submitLabel,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const fieldRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // Focus the field, not the dialog: the operator is here to type.
      const id = window.setTimeout(() => fieldRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open, initialValue]);

  if (!open) return null;

  // A due date may never precede the issue date — refused here AND on the
  // server, which is the authority.
  const tooEarly = mode === "date" && Boolean(value) && Boolean(minDate) && value < (minDate as string);
  const missing = required && value.trim().length === 0;
  const invalid = tooEarly || missing;

  const submit = () => {
    if (!invalid) onSubmit(value.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 p-4"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-sm font-semibold text-navy-900">
          {title}
        </h2>
        {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}

        {mode === "date" && terms && minDate && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {terms.map((t) => (
              <button
                key={t.labelFr}
                type="button"
                onClick={() => {
                  if (t.days !== null) setValue(addDays(minDate, t.days));
                  else fieldRef.current?.focus();
                }}
                className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                  t.days !== null && value === addDays(minDate, t.days)
                    ? "border-teal-600 bg-teal-50 text-teal-800"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t.labelFr}
              </button>
            ))}
          </div>
        )}

        <label htmlFor={`${titleId}-field`} className="mt-3 block text-xs font-medium text-slate-600">
          {label}
        </label>
        <input
          id={`${titleId}-field`}
          ref={fieldRef}
          type={mode === "date" ? "date" : "text"}
          value={value}
          min={mode === "date" ? minDate : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          aria-invalid={invalid || undefined}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
        />

        {tooEarly && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            L&apos;échéance ne peut pas précéder la date d&apos;émission.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={invalid}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
