/**
 * Calendrier de travail (D3).
 *
 * Visible to anyone holding performance:read — the calendar explains every
 * délai and every jours-travaillés figure in this module, so reading the
 * indicators without being able to see their time base would be opaque.
 * Editable only by hr:manage: HR owns the calendar, and the actions assert it
 * server-side over a table with no RLS write policy.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCalendarDays } from "@/lib/hr/calendar-actions";
import { CalendarEditor } from "@/components/performance/calendar-editor";

export const metadata: Metadata = { title: "Calendrier de travail" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: Promise<{ annee?: string }>;
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canManage = hasPermission(permissions, "hr:manage");
  const canRead = hasPermission(permissions, "hr:read");

  const sp = (await searchParams) ?? {};
  const parsed = Number(sp.annee);
  const year = Number.isInteger(parsed) && parsed > 2000 ? parsed : new Date().getUTCFullYear();

  // listCalendarDays asserts hr:read itself and returns [] otherwise. Saying so
  // beats rendering an empty calendar that looks like an empty year.
  const days = await listCalendarDays(year);

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="Calendrier de travail"
        subtitle={`Jours non travaillés — ${year}`}
      />

      <div className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Ce que ce calendrier détermine</h2>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          <li>
            <strong>Délai des dossiers</strong> — jours ouvrés entre dossier complet et BAE, hors
            week-ends et hors jours inscrits ici. Les congés d&apos;un collaborateur n&apos;entrent
            jamais dans ce calcul : un dossier ne ralentit pas parce que son déclarant était absent.
          </li>
          <li>
            <strong>Jours travaillés d&apos;un collaborateur</strong> — les mêmes jours ouvrés,
            moins ses congés approuvés. Une demi-journée compte 0,5, et un congé posé sur un jour
            déjà férié n&apos;est pas décompté deux fois.
          </li>
        </ul>
      </div>

      {canRead ? (
        <CalendarEditor year={year} days={days} canManage={canManage} />
      ) : (
        <div className="surface p-6 text-sm text-slate-500">
          Le calendrier est maintenu par les Ressources humaines. Sa consultation demande
          l&apos;autorisation <code className="text-xs">hr:read</code>, que votre profil ne porte
          pas — les indicateurs ci-dessus restent lisibles.
        </div>
      )}
    </div>
  );
}
