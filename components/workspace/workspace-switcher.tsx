"use client";

/**
 * Workspace switcher (Phase 6.0H). CLIENT — UX only.
 * ---------------------------------------------------------------------------
 * A dropdown in the user menu that lets a user move between their tenant workspace(s) and
 * Platform Administration WITHOUT a hidden URL. It holds no authority: the menu is
 * server-resolved (/api/workspaces, own rows only), tenant selection goes through the
 * verified server action (selectTenantWorkspace), and every target route re-enforces on
 * arrival. It renders NOTHING when there is only one destination (a pure tenant user gets
 * no switch). This is not impersonation and creates no membership.
 *
 * `variant` themes it for the light tenant topbar or the dark platform sidebar.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { selectTenantWorkspace } from "@/lib/workspace/actions";
import type { WorkspaceEntry, WorkspaceMenu } from "@/lib/workspace/model";

export function WorkspaceSwitcher({ variant = "tenant" }: { variant?: "tenant" | "platform" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState<WorkspaceMenu | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: WorkspaceMenu | null) => {
        if (alive) setMenu(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Nothing to switch to → render nothing (tenant users get no switch).
  if (!menu || !menu.hasSwitch) return null;

  const onPlatform = pathname === "/platform" || pathname.startsWith("/platform");
  const isCurrent = (e: WorkspaceEntry) => (e.kind === "platform" ? onPlatform : !onPlatform);
  const current = menu.entries.find(isCurrent) ?? menu.entries[0];

  function choose(entry: WorkspaceEntry) {
    setError(null);
    if (entry.disabled) return;
    if (entry.kind === "platform") {
      setOpen(false);
      router.push(entry.href ?? "/platform");
      return;
    }
    startTransition(async () => {
      const res = await selectTenantWorkspace(entry.id);
      if (res.ok) {
        setOpen(false);
        router.push(res.href);
      } else {
        setError(
          res.error === "not_operable" ? "Cet espace est momentanément indisponible."
          : res.error === "not_member" ? "Vous n'êtes pas membre de cet espace."
          : "Action non autorisée.",
        );
      }
    });
  }

  const dark = variant === "platform";
  const tenants = menu.entries.filter((e) => e.kind === "tenant");
  const platform = menu.entries.filter((e) => e.kind === "platform");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Changer d'espace de travail"
        className={
          dark
            ? "flex w-full items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10"
            : "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-sm text-navy-800 hover:bg-slate-50"
        }
      >
        <Mono entry={current} dark={dark} />
        <span className="hidden min-w-0 leading-tight sm:block">
          <span className="block max-w-[16ch] truncate font-medium">{current.name}</span>
          {current.roleSummary && <span className={`block max-w-[16ch] truncate text-[11px] ${dark ? "text-teal-300" : "text-teal-700"}`}>{current.roleSummary}</span>}
        </span>
        <span className={dark ? "ml-auto text-slate-400" : "text-slate-400"} aria-hidden>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className={
            dark
              ? "absolute bottom-full left-0 z-40 mb-2 w-72 rounded-xl border border-white/10 bg-navy-950 p-2 shadow-xl"
              : "absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
          }
        >
          <p className={`px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-500"}`}>Espaces</p>
          {tenants.map((e) => (
            <MenuRow key={e.id} entry={e} current={isCurrent(e)} dark={dark} pending={pending} onClick={() => choose(e)} />
          ))}
          {platform.length > 0 && (
            <>
              <div className={`my-1 border-t ${dark ? "border-white/10" : "border-slate-200"}`} />
              <p className={`px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-500"}`}>Plateforme</p>
              {platform.map((e) => (
                <MenuRow key={e.id} entry={e} current={isCurrent(e)} dark={dark} pending={pending} onClick={() => choose(e)} />
              ))}
            </>
          )}
          {error && <p className="px-2 pt-1 text-[11px] text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Mono({ entry, dark }: { entry: WorkspaceEntry; dark: boolean }) {
  const platform = entry.kind === "platform";
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
        platform ? "bg-teal-500 text-white" : dark ? "bg-white/15 text-white" : "bg-navy-900 text-white"
      }`}
      aria-hidden
    >
      {entry.monogram}
    </span>
  );
}

function MenuRow({
  entry,
  current,
  dark,
  pending,
  onClick,
}: {
  entry: WorkspaceEntry;
  current: boolean;
  dark: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  const base = dark ? "text-slate-200 hover:bg-white/10" : "text-navy-800 hover:bg-slate-50";
  return (
    <button
      type="button"
      role="menuitem"
      disabled={entry.disabled || pending}
      onClick={onClick}
      aria-current={current ? "true" : undefined}
      title={entry.disabled ? entry.disabledReason ?? undefined : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm ${entry.disabled ? "cursor-not-allowed opacity-45" : base}`}
    >
      <Mono entry={entry} dark={dark} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-medium">{entry.name}</span>
        {entry.roleSummary && <span className={`block truncate text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>{entry.roleSummary}</span>}
        {entry.disabled && entry.disabledReason && <span className="block truncate text-[11px] text-amber-500">{entry.disabledReason}</span>}
      </span>
      {current && <span className={dark ? "text-teal-300" : "text-teal-600"} aria-label="Espace actuel">✓</span>}
    </button>
  );
}
