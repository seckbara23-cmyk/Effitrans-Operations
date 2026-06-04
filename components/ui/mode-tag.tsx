import { transportMode, type TransportMode } from "@/lib/status";
import { IconShip, IconPlane, IconTruck } from "@/lib/icons";

const modeIcon = {
  sea: IconShip,
  air: IconPlane,
  road: IconTruck,
} as const;

export function ModeTag({ mode }: { mode: TransportMode }) {
  const Icon = modeIcon[mode];
  const info = transportMode[mode];
  return (
    <span className="inline-flex items-center gap-2 text-sm text-navy-800">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-50 text-teal-700">
        <Icon className="h-4 w-4" />
      </span>
      <span className="hidden font-medium sm:inline">{info.label}</span>
      <span className="tabular rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {info.code}
      </span>
    </span>
  );
}
