/**
 * Generated-artifact read side (Phase WES-4H). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * What the operator panel needs, and nothing more: is the source data complete,
 * which fields are missing, what is the current version, and what came before.
 *
 * The source READ lives here and `actions.ts` uses it too, so the panel's
 * completeness check and the generator's refusal are computed from the same
 * function. Two implementations would eventually disagree, and the disagreement
 * would show up as a Générer button that fails when pressed.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { generatableArtifacts } from "./feasibility";
import { resolveArtifactSource, type ArtifactSourceInput } from "./source";

export type ArtifactVersion = {
  id: string;
  version: number;
  status: string;
  contentSha256: string | null;
  rendererVersion: string | null;
  generatedAt: string | null;
  generatedByName: string | null;
  supersededById: string | null;
  isCurrent: boolean;
};

export type ArtifactPanelItem = {
  artifactCode: string;
  labelFr: string;
  /** True when every mandatory source field is present. */
  sourceComplete: boolean;
  missing: { field: string; labelFr: string }[];
  current: ArtifactVersion | null;
  previous: ArtifactVersion[];
};

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/**
 * Read the authoritative structured records for one dossier.
 * Shared with the generator — one source of truth for "what do we know".
 */
export async function readArtifactSource(
  supabase: Admin,
  tenantId: string,
  fileId: string,
): Promise<ArtifactSourceInput | null> {
  const [file, shipment, transport] = await Promise.all([
    supabase.from("operational_file")
      .select("id, file_number, type, created_at, client:client_id(name)")
      .eq("id", fileId).eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string; file_number: string | null; type: string; created_at: string;
        client: { name: string } | { name: string }[] | null;
      }>(),
    supabase.from("shipment")
      .select("transport_mode, origin, destination, cargo_type, container_ref")
      .eq("file_id", fileId).eq("tenant_id", tenantId)
      .maybeSingle<Record<string, string | null>>(),
    supabase.from("transport_record")
      .select("pickup_location, delivery_location, pickup_planned, delivery_planned, driver_name, driver_user_id, vehicle_plate, trailer_or_container, transport_company, created_by, created_at")
      .eq("file_id", fileId).eq("tenant_id", tenantId)
      .maybeSingle<Record<string, string | null>>(),
  ]);

  if (!file.data) return null;
  const client = Array.isArray(file.data.client) ? file.data.client[0] : file.data.client;
  const t = transport.data ?? {};
  const s = shipment.data ?? {};

  let requestedBy: string | null = null;
  if (t.created_by) {
    const { data } = await supabase.from("app_user")
      .select("name, email").eq("id", t.created_by).eq("tenant_id", tenantId)
      .maybeSingle<{ name: string | null; email: string }>();
    requestedBy = data?.name ?? data?.email ?? null;
  }

  return {
    fileNumber: file.data.file_number,
    fileType: file.data.type,
    clientName: client?.name ?? null,
    transportMode: s.transport_mode ?? null,
    origin: s.origin ?? null,
    destination: s.destination ?? null,
    cargoType: s.cargo_type ?? null,
    containerRef: s.container_ref ?? null,
    pickupLocation: t.pickup_location ?? null,
    deliveryLocation: t.delivery_location ?? null,
    pickupPlanned: t.pickup_planned ?? null,
    deliveryPlanned: t.delivery_planned ?? null,
    driverName: t.driver_name ?? null,
    driverUserId: t.driver_user_id ?? null,
    vehiclePlate: t.vehicle_plate ?? null,
    trailerOrContainer: t.trailer_or_container ?? null,
    transportCompany: t.transport_company ?? null,
    requestedBy,
    requestedAt: (t.created_at ?? file.data.created_at)?.slice(0, 10) ?? null,
  };
}

/** Everything the artifact panel renders for one dossier. */
export async function getArtifactPanel(fileId: string): Promise<ArtifactPanelItem[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = getAdminSupabaseClient();
  const source = await readArtifactSource(supabase, user.tenantId, fileId);
  if (!source) return [];

  const { data: rows } = await supabase
    .from("document")
    .select("id, artifact_code, version, status, content_sha256, renderer_version, generated_at, generated_by, superseded_by_id")
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .not("artifact_code", "is", null)
    .is("deleted_at", null)
    .order("version", { ascending: false });

  const versions = (rows ?? []) as unknown as {
    id: string; artifact_code: string; version: number; status: string;
    content_sha256: string | null; renderer_version: string | null;
    generated_at: string | null; generated_by: string | null;
    superseded_by_id: string | null;
  }[];

  // Generator names, tenant-scoped: the admin client bypasses RLS.
  const ids = Array.from(new Set(versions.map((v) => v.generated_by).filter(Boolean))) as string[];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await supabase.from("app_user")
      .select("id, name, email").eq("tenant_id", user.tenantId).in("id", ids);
    for (const u of data ?? []) {
      names.set(u.id as string, (u.name as string | null) ?? (u.email as string));
    }
  }

  const toVersion = (v: (typeof versions)[number]): ArtifactVersion => ({
    id: v.id,
    version: v.version,
    status: v.status,
    contentSha256: v.content_sha256,
    rendererVersion: v.renderer_version,
    generatedAt: v.generated_at,
    generatedByName: v.generated_by ? (names.get(v.generated_by) ?? null) : null,
    supersededById: v.superseded_by_id,
    isCurrent: v.superseded_by_id === null,
  });

  return generatableArtifacts().map((a) => {
    const mine = versions.filter((v) => v.artifact_code === a.code).map(toVersion);
    const resolution = resolveArtifactSource(a.code, source);
    return {
      artifactCode: a.code,
      labelFr: a.labelFr,
      sourceComplete: resolution.ok,
      missing: resolution.ok ? [] : resolution.missing,
      current: mine.find((v) => v.isCurrent) ?? null,
      previous: mine.filter((v) => !v.isCurrent),
    };
  });
}
