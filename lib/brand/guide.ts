import "server-only";

/**
 * BCG-A — readiness for the brand guide. SERVER-ONLY, READ-ONLY.
 *
 * RQ-BC.1, ratified: this guide computes its readiness from BRAND COMPLETENESS,
 * not from authority-holder counts. The Brand Center's real gate is the eleven
 * completeness items — « Un modèle ne peut être publié que si la marque est
 * complète » — so a guide that counted permissions would print « disponible »
 * forever and teach nothing.
 *
 * Nothing is hard-coded and nothing is stored: `getBrandCenterOverview()` is
 * the product's own reader, and `deriveBrandCompleteness` its own model. The
 * guide asks the same question the hub asks, and reports the same answer —
 * « N éléments sur 11 complétés », with the model's own per-item evidence, and
 * deliberately no percentage.
 */
import { getBrandCenterOverview } from "@/lib/brand/server/service";
import { BRAND_GUIDE_SECTIONS, type BrandGuideSection } from "./guide/content";

export {
  BRAND_GUIDE_SECTIONS, brandGuideAnchorForRoute, documentedBrandRoutes,
} from "./guide/content";
export type { BrandGuideSection } from "./guide/content";

export type BrandGuideReadiness = {
  /** « N éléments sur 11 complétés » — the product's own wording. */
  summary: string;
  completed: number;
  total: number;
  /** Missing items, with the evidence the model itself gives for each. */
  missing: { label: string; evidence: string }[];
  complete: boolean;
};

export type BrandSectionView = {
  section: BrandGuideSection;
  /**
   * True when this section's workflow is currently affected by an incomplete
   * brand — publication and the generators. Editing sections are never
   * affected: they are HOW the brand becomes complete.
   */
  affectedByIncompleteness: boolean;
};

export type BrandGuideData = {
  readiness: BrandGuideReadiness;
  sections: BrandSectionView[];
};

export async function getBrandGuideData(): Promise<BrandGuideData> {
  // Self-gating: the service asserts admin:config:manage, exactly as the hub.
  const { completeness } = await getBrandCenterOverview();
  const missing = completeness.items
    .filter((i) => !i.complete)
    .map((i) => ({ label: i.label, evidence: i.evidence }));
  const readiness: BrandGuideReadiness = {
    summary: completeness.summary,
    completed: completeness.completed,
    total: completeness.total,
    missing,
    complete: missing.length === 0,
  };
  return {
    readiness,
    sections: BRAND_GUIDE_SECTIONS.map((section) => ({
      section,
      affectedByIncompleteness: section.completenessDependent && !readiness.complete,
    })),
  };
}
