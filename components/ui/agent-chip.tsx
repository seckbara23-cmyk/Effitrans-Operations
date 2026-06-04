import { cn } from "@/lib/cn";

function initials(name: string): string {
  const clean = name.replace(/^Insp\.\s*/i, "");
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const palette = [
  "bg-navy-100 text-navy-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
];

function colorFor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return palette[sum % palette.length];
}

export function AgentChip({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          colorFor(name),
        )}
      >
        {initials(name)}
      </span>
      <span className="truncate text-sm text-navy-800">{name}</span>
    </span>
  );
}
