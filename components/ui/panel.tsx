import Link from "next/link";
import { cn } from "@/lib/cn";
import { IconChevronRight } from "@/lib/icons";

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface overflow-hidden", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
        </div>
        {action && (
          <Link
            href={action.href}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
          >
            {action.label}
            <IconChevronRight className="h-4 w-4" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
