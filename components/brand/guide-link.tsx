import Link from "next/link";
import { brandGuideAnchorForRoute } from "@/lib/brand/guide/content";

/**
 * BCG-B — contextual « Aide ». The sibling of `components/hr/guide-link.tsx`:
 * same affordance, same wording, same rule — resolve the anchor from the route
 * so a workspace cannot drift into pointing at the wrong section, and render
 * NOTHING when no section documents that route.
 *
 * It points at `/brand-center/guide` (the mode opératoire), never at
 * `/brand-center/guides` (the mail-client installation instructions), which the
 * guide links to from its own « Cartes de visite et signatures » section.
 */
export function BrandGuideLink({ route }: { route: string }) {
  const anchor = brandGuideAnchorForRoute(route);
  if (!anchor) return null;
  return (
    <Link href={`/brand-center/guide#${anchor}`}
      className="inline-block text-sm text-slate-500 hover:text-teal-700 hover:underline">
      Aide — mode opératoire
    </Link>
  );
}
