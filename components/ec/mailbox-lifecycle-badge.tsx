import Link from "next/link";
import { canonicalState, isLegacyActive, STATE_FR } from "@/lib/ec/mailboxes/lifecycle";
import { cn } from "@/lib/cn";

/**
 * EMP-5F — a mailbox's lifecycle state, READ ONLY.
 *
 * It replaces `MailboxToggle`, which offered « Activer » / « Désactiver » here
 * in the mail workspace and could not actually do either: it wrote `is_active`,
 * which EMP-4A's trigger derives from `provisioning_status` and immediately
 * overwrote. The control changed nothing, reported success, and audited a state
 * change that never happened.
 *
 * Nothing replaces it in THIS workspace. Using a mailbox and deciding whether it
 * may be used are different jobs held by different people — the doctrine EMP-4A
 * set and EMP-IA-1 reinforced — so the lifecycle lives in Administration, and
 * this shows the state and links to where it can be changed.
 */
const TONE: Record<string, string> = {
  ACTIVE: "bg-teal-50 text-teal-700",
  VERIFIED: "bg-teal-50 text-teal-700",
  PENDING_VERIFICATION: "bg-amber-50 text-amber-800",
  CONFIGURED: "bg-slate-100 text-slate-700",
  CONFIGURATION_REQUIRED: "bg-amber-50 text-amber-800",
  RESERVED: "bg-slate-100 text-slate-600",
  FAILED: "bg-red-50 text-red-700",
  DISABLED: "bg-slate-100 text-slate-600",
};

export function MailboxLifecycleBadge({
  provisioningStatus,
  activatedBy,
  mailboxId,
  showLink = true,
}: {
  provisioningStatus: string;
  activatedBy: string | null;
  mailboxId?: string;
  showLink?: boolean;
}) {
  const state = canonicalState(provisioningStatus);
  const legacy = isLegacyActive({ provisioningStatus, activatedBy });

  return (
    <div className="flex flex-col items-start gap-1">
      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", TONE[state])}>
        {STATE_FR[state]}
      </span>

      {/* The blocking warning EMP-5F requires. It DESCRIBES: no mailbox was
          reclassified or disabled to produce it. */}
      {legacy ? (
        <span className="text-[10px] font-medium text-amber-800">
          ▲ Active sans preuve de vérification — mise en service antérieure au cycle de vie gouverné
        </span>
      ) : null}

      {showLink ? (
        <Link
          href={mailboxId
            ? `/admin/enterprise-mail/mailboxes?mailbox=${mailboxId}`
            : "/admin/enterprise-mail/mailboxes"}
          className="text-[10px] text-teal-700 hover:underline"
        >
          Gérer le cycle de vie
        </Link>
      ) : null}
    </div>
  );
}
