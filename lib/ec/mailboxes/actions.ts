"use server";

/**
 * EMP-1 → EMP-5F — mailbox administration, WRITE SIDE. Now empty, on purpose.
 *
 * WHAT WAS HERE, AND WHY IT HAD TO GO
 * -----------------------------------
 * `setMailboxActive` wrote `ec_mailbox.is_active` directly. It worked when
 * EMP-1 shipped it. Then EMP-4A made `provisioning_status` the administrative
 * lifecycle and added a BEFORE INSERT OR UPDATE trigger:
 *
 *     new.is_active := (new.provisioning_status = 'ACTIVE');
 *
 * From that moment an UPDATE that set only `is_active` was silently reverted by
 * the trigger — `new.provisioning_status` still held the old value, so the
 * derived boolean snapped straight back. The action changed NOTHING, reported
 * success, and wrote an `ec.mailbox.activated` / `ec.mailbox.deactivated` audit
 * row for a change that never happened, under the same action codes the real
 * lifecycle uses. An administrator clicking « Désactiver » saw the mailbox stay
 * active and the audit trail claim it had been disabled.
 *
 * That is worse than a dead control: it is a SECOND, IMPOTENT LIFECYCLE that
 * lies in the one record meant to settle disputes. EMP-5F removes it rather
 * than repairing it, because repairing it would mean pointing a
 * `communication:manage` gate at the lifecycle, and lifecycle changes require
 * `communication:mailbox:provision` — repair would have been a privilege
 * widening dressed as a bug fix.
 *
 * Deactivation lives in `admin-actions.ts::setMailboxEnabled`, activation in
 * `admin-actions.ts::activateMailbox` behind the activation guard, and routing
 * follows `provisioning_status` through the trigger. One lifecycle, one writer.
 *
 * This module is kept as the record of that, and exports nothing.
 */

export {};
