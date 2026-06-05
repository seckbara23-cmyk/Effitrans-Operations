import { cn } from "@/lib/cn";

/**
 * Effitrans mark: a stylised container stack inside a navigation ring —
 * port + logistics + control tower. Drawn as an inline SVG so it scales
 * crisply and recolours with the theme.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("h-9 w-9", className)}
      role="img"
      aria-label="Effitrans"
    >
      <rect width="40" height="40" rx="10" className="fill-navy-900" />
      <circle
        cx="20"
        cy="20"
        r="13"
        className="stroke-teal-400/40"
        strokeWidth="1"
        fill="none"
      />
      {/* container stack */}
      <g className="fill-sand-100">
        <rect x="12" y="21" width="7.5" height="5" rx="0.8" />
        <rect x="20.5" y="21" width="7.5" height="5" rx="0.8" />
        <rect x="16.25" y="15" width="7.5" height="5" rx="0.8" className="fill-amber-500" />
      </g>
      {/* waterline */}
      <path
        d="M10 29c2 1.4 4 1.4 6 0s4-1.4 6 0 4 1.4 6 0 2-1.4 2-1.4"
        className="stroke-teal-400"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LogoWordmark({
  className,
  subtitle = true,
}: {
  className?: string;
  subtitle?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3.5", className)}>
      <LogoMark className="h-11 w-11" />
      <div className="leading-none">
        <span className="block text-[20px] font-extrabold uppercase leading-none tracking-[0.16em] text-white drop-shadow-sm">
          Effitrans
        </span>
        <span className="mt-1 block text-[13px] font-bold uppercase leading-none tracking-[0.32em] text-teal-300">
          Operations
        </span>
        {subtitle && (
          <span className="mt-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-300">
            Transit • Logistique • Douane
          </span>
        )}
      </div>
    </div>
  );
}
