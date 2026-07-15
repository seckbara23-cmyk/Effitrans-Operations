import "server-only";

/**
 * The shared secure welcome / set-password send (Phase 6.0E-3, extracted from the
 * Phase 5.0E-4 createUser flow). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE implementation of "mint a recovery link and (if a provider is configured) deliver
 * the staff_welcome email", reused by BOTH the tenant user-management action and the
 * platform invitation action — so there is exactly one invitation pipeline, not two.
 *
 * HONEST by construction:
 *   - distinguishes "no provider" / "provider failed" / "link couldn't be minted" /
 *     "delivery failed" (classifyWelcome);
 *   - with no provider it RETURNS the one-time link for out-of-band delivery and never
 *     claims an email was sent;
 *   - marks onboarding_email_sent_at ONLY on a true, provider-backed delivery;
 *   - NEVER emails a password (a recovery link only), and the link is never logged,
 *     audited or persisted.
 *
 * Never throws — a welcome failure must never fail the caller's primary operation.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { queueAndSend } from "@/lib/comms/queue";
import { isProviderConfigured } from "@/lib/comms/provider";
import { reportError } from "@/lib/observability/report";
import { staffWelcomeVars } from "./welcome";
import { classifyWelcome, isDelivered, returnsLink } from "./welcome-outcome";
import type { WelcomeOutcome } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/** A welcome attempt's outcome plus the one-time link when there is no provider. */
export type WelcomeResult = { outcome: WelcomeOutcome; setupLink?: string };

export async function sendStaffWelcome(
  supabase: Admin,
  ctx: { tenantId: string; actorId: string; platformActor?: boolean },
  recipient: { userId: string; email: string; name: string | null },
): Promise<WelcomeResult> {
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const loginUrl = `${siteUrl}/login`;
    const providerConfigured = isProviderConfigured();

    // The ONLY credential mechanism that travels — a recovery link, never a password.
    const { data: link } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: recipient.email,
      options: { redirectTo: `${siteUrl}/auth/update-password` },
    });
    const setupLink = link?.properties?.action_link ?? null;

    if (!providerConfigured) {
      const outcome = classifyWelcome({ providerConfigured: false, linkGenerated: !!setupLink, deliveryAccepted: false });
      await writeAudit({
        action: AuditActions.USER_WELCOME_LINK_RETURNED,
        ...(ctx.platformActor ? { platformActorId: ctx.actorId } : { actorId: ctx.actorId }),
        tenantId: ctx.tenantId,
        entity: "app_user",
        entityId: recipient.userId,
        // The ID and template only — NEVER the link.
        after: { providerConfigured: false, linkGenerated: !!setupLink },
      });
      return { outcome, setupLink: outcome === "link_returned" ? (setupLink as string) : undefined };
    }

    if (!setupLink) {
      return { outcome: classifyWelcome({ providerConfigured: true, linkGenerated: false, deliveryAccepted: false }) };
    }

    const res = await queueAndSend({
      tenantId: ctx.tenantId,
      createdBy: ctx.actorId,
      templateKey: "staff_welcome",
      vars: staffWelcomeVars({ name: recipient.name, email: recipient.email, loginUrl, setupLink }),
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      related: "user",
      relatedId: recipient.userId,
    });
    const outcome = classifyWelcome({
      providerConfigured: true,
      linkGenerated: true,
      deliveryAccepted: res.status === "SENT",
    });

    if (isDelivered(outcome)) {
      await supabase
        .from("app_user")
        .update({ onboarding_email_sent_at: new Date().toISOString() })
        .eq("id", recipient.userId);
    }
    return { outcome };
  } catch (e) {
    reportError(e, { scope: "action", event: "users.welcome_email", extra: { userId: recipient.userId } });
    return { outcome: "delivery_failed" };
  }
}

export { returnsLink };
