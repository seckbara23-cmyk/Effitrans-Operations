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
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="flex items-baseline gap-1">
          <span className="text-[15px] font-bold tracking-tight text-white">
            Effitrans
          </span>
          <span className="text-[15px] font-light tracking-tight text-teal-300">
            Operations
          </span>
        </div>
        {subtitle && (
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
            Transit · Logistique · Dakar
          </span>
        )}
      </div>
    </div>
  );
}
