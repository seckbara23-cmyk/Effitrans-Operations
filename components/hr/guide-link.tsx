import Link from "next/link";
import { guideAnchorForRoute } from "@/lib/hr/guide/content";

/**
 * HR-10B — contextual « Aide ». One component, placed on each HR workspace,
 * that opens the guide AT the section documenting that workspace.
 *
 * It resolves its own anchor from the route, so a workspace cannot drift into
 * pointing at the wrong section, and it renders NOTHING when no section
 * documents that route — a link to a page that does not explain this screen
 * would be worse than no link.
 */
export function GuideLink({ route }: { route: string }) {
  const anchor = guideAnchorForRoute(route);
  if (!anchor) return null;
  return (
    <Link href={`/departments/hr/guide#${anchor}`}
      className="inline-block text-sm text-slate-500 hover:text-teal-700 hover:underline">
      Aide — mode opératoire
    </Link>
  );
}
