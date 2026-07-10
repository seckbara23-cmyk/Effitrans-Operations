import { t } from "@/lib/i18n";
import type { PortalOfficer } from "@/lib/portal/types";

const AVAIL_DOT: Record<PortalOfficer["availability"], string> = {
  online: "bg-emerald-500",
  recent: "bg-amber-500",
  offline: "bg-slate-300",
};

function initials(name: string): string {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "E";
}

/**
 * Assigned Effitrans contact (Phase 3.3A D3). Customer-safe: never a generic
 * technical identity or a personal email — only a business contact when configured.
 */
export function OfficerCard({ officer }: { officer: PortalOfficer }) {
  const o = t.portal.premium.officer;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <p className="text-sm font-semibold text-navy-900">{o.title}</p>
      <div className="mt-3 flex items-center gap-3">
        <div className="relative">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-navy-800 to-teal-700 text-lg font-bold text-white">
            {initials(officer.name)}
          </div>
          {!officer.isTeam && (
            <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full ring-2 ring-white ${AVAIL_DOT[officer.availability]}`} aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy-900">{officer.name}</p>
          <p className="truncate text-xs text-slate-500">{officer.title}</p>
          {!officer.isTeam && <p className="text-[11px] text-slate-400">{o[officer.availability]}</p>}
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-400">{o.email}</dt>
          <dd className="truncate font-medium text-navy-800">{officer.businessEmail ?? o.viaEffitrans}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-400">{o.phone}</dt>
          <dd className="font-medium text-navy-800">{officer.businessPhone ?? o.phonePlaceholder}</dd>
        </div>
      </dl>

      <a
        href={officer.businessEmail ? `mailto:${officer.businessEmail}` : "/portal/notifications"}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-navy-800"
      >
        <span aria-hidden>✉️</span> {o.contact}
      </a>
    </div>
  );
}
