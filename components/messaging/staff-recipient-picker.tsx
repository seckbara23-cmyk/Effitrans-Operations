"use client";

/**
 * Searchable colleague picker (Phase 8.6A) — replaces the raw "user id" input in
 * the "start a conversation" form. A WAI-ARIA combobox: debounced search over
 * lib/messaging/actions.ts's searchMessagingRecipients (tenant/permission already
 * resolved server-side — this component never sees or sends a tenant id).
 */
import { useEffect, useId, useRef, useState } from "react";
import { searchMessagingRecipients } from "@/lib/messaging/actions";
import type { StaffRecipient } from "@/lib/messaging/access";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

function initials(name: string): string {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Avatar({ name, size = 9 }: { name: string; size?: 8 | 9 }) {
  const cls = size === 8 ? "h-8 w-8 text-[11px]" : "h-9 w-9 text-xs";
  return (
    <div className={`flex ${cls} shrink-0 items-center justify-center rounded-full bg-teal-700 font-bold text-white`} aria-hidden>
      {initials(name)}
    </div>
  );
}

export function StaffRecipientPicker({
  selected,
  onSelect,
  onClear,
  label = "Destinataire",
  disabled = false,
}: {
  selected: StaffRecipient | null;
  onSelect: (recipient: StaffRecipient) => void;
  onClear: () => void;
  label?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StaffRecipient[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const inputId = useId();
  const listboxId = useId();
  const errorId = useId();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const myRequest = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await searchMessagingRecipients(trimmed);
        if (requestIdRef.current !== myRequest) return; // a newer keystroke already superseded this one
        setResults(found);
        setOpen(true);
        setActiveIndex(found.length > 0 ? 0 : -1);
        setAnnouncement(found.length === 0 ? "Aucun résultat" : `${found.length} résultat${found.length > 1 ? "s" : ""} trouvé${found.length > 1 ? "s" : ""}`);
      } catch {
        if (requestIdRef.current !== myRequest) return;
        setError("La recherche a échoué. Réessayez.");
        setOpen(true);
      } finally {
        if (requestIdRef.current === myRequest) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function choose(recipient: StaffRecipient) {
    onSelect(recipient);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setAnnouncement(`${recipient.name} sélectionné`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) choose(results[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  if (selected) {
    return (
      <div>
        <p className="mb-1 block text-xs font-medium text-slate-600">{label}</p>
        <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={selected.name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-navy-900">{selected.name}</p>
              {(selected.roleLabel || selected.departmentLabel) && (
                <p className="truncate text-xs text-slate-500">
                  {[selected.roleLabel, selected.departmentLabel].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="truncate text-[11px] text-slate-400">{selected.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="min-h-[44px] shrink-0 rounded-lg px-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-50"
          >
            Changer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        aria-describedby={error ? errorId : undefined}
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Let a mousedown on an option register (onMouseDown fires before blur) before closing.
          window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder="Rechercher un collègue…"
        autoComplete="off"
        className="w-full min-h-[44px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
      />

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Résultats de recherche de collègues"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          {loading && <li className="p-3 text-xs text-slate-400">Recherche…</li>}
          {!loading && error && (
            <li id={errorId} role="alert" className="p-3 text-xs text-red-600">
              {error}
            </li>
          )}
          {!loading && !error && results.length === 0 && (
            <li className="p-3 text-xs text-slate-400">Aucun collègue trouvé.</li>
          )}
          {!loading &&
            !error &&
            results.map((r, i) => (
              <li
                key={r.id}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus on the input so onBlur doesn't fire first
                  choose(r);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 px-3 py-2 ${i === activeIndex ? "bg-teal-50" : "hover:bg-slate-50"}`}
              >
                <Avatar name={r.name} size={8} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy-900">{r.name}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {[r.roleLabel, r.departmentLabel, r.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      )}

      {/* Screen-reader-only: result count + selection announcements. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
