import Link from "next/link";
import { t } from "@/lib/i18n";
import { IconChevronRight } from "@/lib/icons";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="stamp-frame mb-5 flex h-16 w-16 items-center justify-center rounded-xl bg-sand-50 text-amber-600">
        <Icon className="h-8 w-8" />
      </div>
      <span className="eyebrow mb-2">{t.common.placeholderTitle}</span>
      <h2 className="max-w-md text-lg font-semibold text-navy-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        {description}
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-navy-800 hover:bg-slate-50"
      >
        {t.common.backToDashboard}
        <IconChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
