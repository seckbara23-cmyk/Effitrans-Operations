import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div>
        {meta && <p className="eyebrow mb-1">{meta}</p>}
        <h1 className="text-xl font-bold tracking-tight text-navy-900 sm:text-2xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
