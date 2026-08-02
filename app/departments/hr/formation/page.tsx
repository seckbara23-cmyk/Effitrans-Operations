/**
 * HR-6 — Training register workspace. Gate hr:read; writes need hr:manage.
 * A REGISTER, not a learning platform: requirements, plans, completion and
 * certificates. Delivery happens elsewhere and is referenced, never hosted.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listEmployees } from "@/lib/hr/read";
import { listCourses, listEnrollments, trainingCounts, CERTIFICATE_EXPIRY_WINDOW_DAYS } from "@/lib/hr/training";
import { TrainingStudio } from "@/components/hr/training-studio";

export const metadata: Metadata = { title: "Formation — RH" };
export const dynamic = "force-dynamic";

export default async function HrTrainingPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Formation" subtitle="Configuration requise." />
      </div>
    );
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");

  const [courses, enrollments, counts, directory] = await Promise.all([
    listCourses(user.tenantId),
    listEnrollments(user.tenantId),
    trainingCounts(user.tenantId),
    listEmployees(user.tenantId),
  ]);
  const employees = directory.map((e) => ({
    id: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})`,
  }));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Ressources humaines"
        title="Formation"
        subtitle="Catalogue, plans, inscriptions et certificats — un registre RH, pas une plateforme de cours."
      />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">
        ← Centre d&apos;opérations RH
      </Link>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Formations au catalogue" value={counts.activeCourses} tone="teal" />
        <StatCard label="Inscriptions en cours" value={counts.openEnrollments} tone="navy" />
        <StatCard label="Formations obligatoires en retard" value={counts.mandatoryOverdue} tone="slate" />
        <StatCard
          label={`Certificats expirant (${CERTIFICATE_EXPIRY_WINDOW_DAYS} j)`}
          value={counts.expiringSoon}
          tone="slate"
        />
      </div>

      <TrainingStudio
        courses={courses}
        enrollments={enrollments}
        employees={employees}
        canManage={canManage}
        completedThisYear={counts.completedThisPeriod}
      />
    </div>
  );
}
