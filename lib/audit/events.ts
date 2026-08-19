/**
 * Foundation audit action codes (AUD-2).
 * ---------------------------------------------------------------------------
 * A small, typed catalog of the audit actions used by the FOUNDATION (auth,
 * RBAC, admin governance). Business-domain action codes arrive with their
 * modules. Convention: "<entity>.<change>"; "system.*" = unattributed system
 * events; "*.override" = governance overrides (require an overrideReason).
 */
export const AuditActions = {
  USER_CREATED: "user.created",
  // Phase 5.0E-4 — a staff user created with a generated temporary password. The action
  // NAME is audited; the password itself never is.
  USER_CREATED_WITH_TEMP_PASSWORD: "user.created_with_temp_password",
  USER_ACTIVATED: "user.activated",
  USER_DEACTIVATED: "user.deactivated",
  // Phase 8.1A — permanent-departure lifecycle. Archive PRESERVES every row the user ever
  // touched (audit, shipments, customs, documents, invoices, AI activity); only access and
  // future assignability end. Restore is the only exit, back to active.
  USER_ARCHIVED: "user.archived",
  USER_RESTORED: "user.restored",
  USER_ROLE_ASSIGNED: "user.role.assigned",
  USER_ROLE_REVOKED: "user.role.revoked",
  // Phase 5.0E-4 — welcome / setup-link lifecycle (safe metadata only; NEVER the link).
  USER_WELCOME_RESEND_REQUESTED: "user.welcome.resend_requested",
  USER_WELCOME_LINK_RETURNED: "user.welcome.link_returned",
  // Phase 6.0E-3 — an outstanding invitation cancelled (the user is deactivated, which
  // getCurrentUser enforces, so the outstanding setup link becomes unusable).
  USER_INVITATION_CANCELLED: "user.invitation.cancelled",
  // 2026-07-29 — staff password lifecycle. The generated password NEVER appears in any
  // of these payloads; what is recorded is that one was issued, by whom, against whom,
  // for which ratified reason, and from which IP.
  USER_TEMP_PASSWORD_GENERATED: "user.temp_password.generated",
  USER_PASSWORD_RESET_SENT: "user.password_reset.sent",
  USER_PASSWORD_CHANGED: "user.password.changed",
  USER_ACCOUNT_UNLOCKED: "user.account.unlocked",
  ADMIN_OVERRIDE_ACCESS: "admin.override.access", // isOverride: true
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  // Phase 1.16 — Google OAuth (staff)
  AUTH_LOGIN_GOOGLE: "auth.login.google", // staff, attributed (actorId)
  AUTH_LOGIN_REJECTED: "auth.login.rejected", // machine: unknown/disabled/mismatch (reason only)
  // Phase 1.16 — Staff password recovery (attributed; only emitted for an active app_user)
  AUTH_PASSWORD_RESET_REQUESTED: "auth.password_reset.requested",
  AUTH_PASSWORD_RESET_COMPLETED: "auth.password_reset.completed",
  SYSTEM_SEED: "system.seed",
  // Phase 1.1 — Client Management
  CLIENT_CREATED: "client.created",
  CLIENT_UPDATED: "client.updated",
  CLIENT_ARCHIVED: "client.archived",
  CLIENT_RESTORED: "client.restored",
  // Phase 1.2 — Operational File + Shipment
  FILE_CREATED: "file.created",
  FILE_UPDATED: "file.updated",
  FILE_TRANSITION: "file.transition",
  FILE_ARCHIVED: "file.archived",
  // Phase 3.2A — Dossier delete/cancel + assignment
  FILE_CANCELLED: "file.cancelled",
  FILE_DELETED: "file.deleted",
  FILE_ASSIGNED: "file.assigned",
  // TMS-1 — the Responsable client (Account Manager), a different act from
  // the working assignee above.
  FILE_COMMERCIAL_OWNER_ASSIGNED: "file.commercial_owner_assigned",
  FILE_UNASSIGNED: "file.unassigned",
  // Phase 1.3 — Tasks
  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_STATUS_CHANGED: "task.status_changed",
  TASK_ASSIGNED: "task.assigned",
  TASK_COMPLETED: "task.completed",
  TASK_CANCELLED: "task.cancelled",
  // Phase 1.8 — Documents
  DOCUMENT_UPLOADED: "document.uploaded",
  DOCUMENT_UPDATED: "document.updated",
  DOCUMENT_APPROVED: "document.approved",
  DOCUMENT_REJECTED: "document.rejected",
  DOCUMENT_EXPIRED: "document.expired", // reserved — set by the deferred scheduler
  DOCUMENT_DELETED: "document.deleted",
  // Phase 1.9 — Customs
  CUSTOMS_CREATED: "customs.created",
  CUSTOMS_UPDATED: "customs.updated",
  CUSTOMS_STATUS_CHANGED: "customs.status_changed",
  CUSTOMS_DECLARED: "customs.declared",
  CUSTOMS_RELEASED: "customs.released",
  CUSTOMS_BLOCKED: "customs.blocked",
  CUSTOMS_DELETED: "customs.deleted",
  // TMS-6 — external transport subcontractors. Master data, not a dossier
  // fact, so the dossier-scoped business-event ledger is deliberately unused.
  PROVIDER_CREATED: "transport_provider.created",
  PROVIDER_UPDATED: "transport_provider.updated",
  PROVIDER_STATUS_CHANGED: "transport_provider.status_changed",
  // Phase 1.10 — Transport
  // TMS-5 — Parc & Flotte. Vehicle master data is NOT a dossier fact, so the
  // business-event ledger (dossier-scoped) is deliberately not used: the
  // append-only audit log is the immutable history of these changes.
  VEHICLE_CREATED: "vehicle.created",
  VEHICLE_UPDATED: "vehicle.updated",
  VEHICLE_STATUS_CHANGED: "vehicle.status_changed",
  VEHICLE_COMPLIANCE_RECORDED: "vehicle.compliance_recorded",
  VEHICLE_MAINTENANCE_OPENED: "vehicle.maintenance_opened",
  VEHICLE_MAINTENANCE_CLOSED: "vehicle.maintenance_closed",
  // TMS-5C — permanent removal of a vehicle that never served. The audit row
  // carries the immatriculation, so the trail still names what was destroyed
  // once the row itself is gone.
  VEHICLE_DELETED: "vehicle.deleted",
  TRANSPORT_CREATED: "transport.created",
  // TMS-4 — the REQUEST act (transport:request), distinct from starting
  // execution: the Account Manager raises the need, transport executes.
  TRANSPORT_REQUESTED: "transport.requested",
  TRANSPORT_UPDATED: "transport.updated",
  TRANSPORT_ASSIGNED: "transport.assigned",
  TRANSPORT_STATUS_CHANGED: "transport.status_changed",
  TRANSPORT_PICKED_UP: "transport.picked_up",
  TRANSPORT_DELIVERED: "transport.delivered",
  TRANSPORT_POD_RECEIVED: "transport.pod_received",
  TRANSPORT_CANCELLED: "transport.cancelled",
  TRANSPORT_DELETED: "transport.deleted",
  // Phase 1.11 — Finance
  CHARGE_CREATED: "charge.created",
  CHARGE_UPDATED: "charge.updated",
  CHARGE_DELETED: "charge.deleted",
  INVOICE_CREATED: "invoice.created",
  INVOICE_UPDATED: "invoice.updated",
  INVOICE_ISSUED: "invoice.issued",
  // UAT-2B — customer delivery of the official invoice artifact. The success
  // record carries the delivered artifact's SHA-256, so "what did the customer
  // actually receive" stays answerable. Failures are recorded too: a silent
  // failed send is indistinguishable from never having tried.
  INVOICE_SENT: "invoice.sent",
  INVOICE_SEND_FAILED: "invoice.send_failed",
  INVOICE_VOIDED: "invoice.voided",
  INVOICE_DELETED: "invoice.deleted",
  PAYMENT_RECORDED: "payment.recorded",
  PAYMENT_REVERSED: "payment.reversed",
  // Phase 1.15A — Payment verification / reconciliation
  PAYMENT_VERIFIED: "payment.verified",
  PAYMENT_REJECTED: "payment.rejected",
  // Phase 1.15B — Payment provider integration (intents + webhooks)
  PAYMENT_INTENT_CREATED: "payment_intent.created", // staff/portal-attributed
  PAYMENT_INTENT_CANCELLED: "payment_intent.cancelled", // staff/portal-attributed
  PAYMENT_INTENT_SUCCEEDED: "payment_intent.succeeded", // machine (webhook)
  PAYMENT_INTENT_FAILED: "payment_intent.failed", // machine (webhook)
  PAYMENT_INTENT_EXPIRED: "payment_intent.expired", // machine (TTL sweep)
  PROVIDER_WEBHOOK_RECEIVED: "provider.webhook.received", // machine
  PROVIDER_WEBHOOK_REPLAYED: "provider.webhook.replayed", // machine (dup/replay/reject)
  PAYMENT_AUTO_RECORDED: "payment.auto_recorded", // machine (webhook success)
  // Phase EC-1 — inbound email capture. MACHINE events (a mail provider posted;
  // there is no human actor). Payloads carry identifiers, outcome and a short
  // classification ONLY — never a subject, body, address, filename or header.
  EC_INBOUND_RECEIVED: "ec.inbound.received", // machine (captured + routed)
  EC_INBOUND_QUARANTINED: "ec.inbound.quarantined", // machine (unroutable — kept, tenant-less)
  // EMP-1 — the only human-initiated change to a mailbox. Creation and deletion
  // deliberately have no action code because this platform offers neither.
  EC_MAILBOX_ACTIVATED: "ec.mailbox.activated",
  EC_MAILBOX_DEACTIVATED: "ec.mailbox.deactivated",
  // EMP-3 — a human resolving a send stuck in SENDING. The platform refuses to
  // guess whether the provider accepted, so the decision is a recorded act.
  COMMUNICATION_RECONCILED: "communication.reconciled",
  COMMUNICATION_DRAFTED: "communication.drafted",
  // EMP-4 — an inbound attachment promoted into a dossier document. The
  // TIMELINE entry for that document comes from the DOCUMENT_UPLOADED trigger;
  // this records the ingestion decision, which is a different fact.
  EC_ATTACHMENT_INGESTED: "ec.attachment.ingested",
  // EMP-4A — mailbox membership and operator-assisted provisioning. Each records
  // a decision a person made; the platform performs no external provisioning and
  // so never reports one of its own.
  EC_MAILBOX_MEMBER_GRANTED: "ec.mailbox.member_granted",
  EC_MAILBOX_MEMBER_REVOKED: "ec.mailbox.member_revoked",
  EC_MAILBOX_PROVISIONED: "ec.mailbox.provisioned",
  EC_MAILBOX_SETUP_CONFIRMED: "ec.mailbox.setup_confirmed",
  EC_MAILBOX_SETUP_FAILED: "ec.mailbox.setup_failed",
  EC_MAILBOX_SETUP_RETRIED: "ec.mailbox.setup_retried",
  // EMP-5E — a mailbox's department eligibility changed: which department is
  // PROPOSED this mailbox. It grants and revokes nothing, so it is deliberately
  // a separate action from the membership events above.
  EC_MAILBOX_CLASSIFIED: "ec.mailbox.classified",
  // EMP-5F — the governed lifecycle. Each step is its own act because each is
  // done by a person who must be nameable afterwards: the one who recorded the
  // configuration, the one who submitted it, the one who verified it, and the
  // one who put it into service — who must not be the one who verified it.
  EC_MAILBOX_CONFIGURED: "ec.mailbox.configured",
  EC_MAILBOX_VERIFICATION_SUBMITTED: "ec.mailbox.verification_submitted",
  EC_MAILBOX_VERIFICATION_PASSED: "ec.mailbox.verification_passed",
  EC_MAILBOX_VERIFICATION_FAILED: "ec.mailbox.verification_failed",
  // A decision ABOUT a legacy-unverified ACTIVE mailbox. Records the intention
  // and its reason; changes nothing about the mailbox.
  EC_MAILBOX_LEGACY_DECISION: "ec.mailbox.legacy_decision",
  // EMP-4A — one row for the batch, beside one row per changed membership, so
  // "what happened on Tuesday" and "who got access" are both answerable.
  EC_MAILBOX_BULK_ASSIGNED: "ec.mailbox.bulk_assigned",
  EC_INBOUND_REJECTED: "ec.inbound.rejected", // machine (signature refused)
  // Phase 1.12 — Customer Portal
  PORTAL_USER_INVITED: "portal.user.invited",
  PORTAL_USER_ACTIVATED: "portal.user.activated",
  // Phase 3.2B — temporary-password onboarding (password NEVER in the payload)
  PORTAL_USER_CREATED_WITH_TEMP_PASSWORD: "portal.user.created_with_temp_password",
  PORTAL_USER_TEMP_PASSWORD_RESET: "portal.user.temp_password_reset",
  PORTAL_USER_PASSWORD_CHANGED: "portal.user.password_changed",
  PORTAL_LOGIN: "portal.login",
  PORTAL_DOCUMENT_DOWNLOADED: "portal.document.downloaded",
  PORTAL_INVOICE_VIEWED: "portal.invoice.viewed",
  // Phase 3.3B — Client self-service portal (customer-initiated writes, attributed
  // to the client_user; never bypass validation — uploads land PENDING_REVIEW,
  // payment proofs never auto-mark an invoice paid, requests/messages are tasks).
  PORTAL_DOCUMENT_UPLOADED: "portal.document.uploaded", // customer upload → PENDING_REVIEW
  PORTAL_DOCUMENT_REPLACED: "portal.document.replaced", // new version supersedes a rejected doc
  PORTAL_PAYMENT_PROOF_SUBMITTED: "portal.payment_proof.submitted", // proof doc, finance verifies
  PORTAL_UPDATE_REQUESTED: "portal.update.requested", // rate-limited status-update request
  PORTAL_MESSAGE_SENT: "portal.message.sent", // contact-center message → assigned dossier owner
  // Phase 1.16 — Portal Google OAuth + password recovery (parity with staff)
  PORTAL_LOGIN_GOOGLE: "portal.login.google", // attributed (clientUserId)
  PORTAL_LOGIN_REJECTED: "portal.login.rejected", // machine: unknown/disabled/mismatch
  PORTAL_PASSWORD_RESET_REQUESTED: "portal.password_reset.requested", // attributed
  PORTAL_PASSWORD_RESET_COMPLETED: "portal.password_reset.completed", // attributed
  // Phase 7.6C — Customer AI Assistant. Attributed to the PORTAL actor (clientUserId), never a
  // staff actor. Records SAFE metadata only (provider/model/duration/tokens/outcome) — never the
  // prompt, the answer, the conversation, or any shipment detail.
  PORTAL_COPILOT_QUERY: "portal.copilot.query",
  // Phase 1.14 — Communications Hub
  COMMUNICATION_QUEUED: "communication.queued",
  COMMUNICATION_SENT: "communication.sent",
  COMMUNICATION_FAILED: "communication.failed",
  COMMUNICATION_CANCELLED: "communication.cancelled",
  // Phase 2.1 — Automatic department handoff tasks
  HANDOFF_TASK_CREATED: "handoff.task.created",
  HANDOFF_TASK_COMPLETED: "handoff.task.completed",
  // Phase 2.5 — Customer notifications
  NOTIFICATION_CUSTOMER_CREATED: "notification.customer.created",
  NOTIFICATION_CUSTOMER_SENT: "notification.customer.sent",
  // Phase 3.4 — Real-time operations tracking. Session + material operational
  // events are audited (NOT every GPS position — that would be excessive volume).
  TRACKING_SESSION_STARTED: "tracking.session.started",
  TRACKING_SESSION_PAUSED: "tracking.session.paused",
  TRACKING_SESSION_RESUMED: "tracking.session.resumed",
  TRACKING_SESSION_COMPLETED: "tracking.session.completed",
  TRACKING_SESSION_CANCELLED: "tracking.session.cancelled",
  TRACKING_POSITION_MANUAL_RECORDED: "tracking.position.manual_recorded",
  TRACKING_EVENT_CREATED: "tracking.event.created",
  TRACKING_DELAY_REPORTED: "tracking.delay.reported",
  TRACKING_INCIDENT_REPORTED: "tracking.incident.reported",
  TRACKING_PROVIDER_WEBHOOK_RECEIVED: "tracking.provider.webhook_received", // machine (reserved — no provider wired)
  // Phase 3.4C — Driver mobile execution + dispatcher assignment.
  TRANSPORT_DRIVER_ASSIGNED: "transport.driver.assigned",
  TRANSPORT_DRIVER_UNASSIGNED: "transport.driver.unassigned",
  TRACKING_BATCH_RECEIVED: "tracking.batch.received", // batch acceptance (NOT per GPS point)
  TRANSPORT_POD_UPLOADED: "transport.pod.uploaded",
  // Phase 3.0B — Report / Power BI exports (attributed; date range in `after`)
  REPORT_EXPORT_CSV: "report.export.csv",
  REPORT_EXPORT_XLSX: "report.export.xlsx",
  REPORT_EXPORT_PDF: "report.export.pdf",
  REPORT_EXPORT_POWERBI: "report.export.powerbi",
  // Phase 4.0B — Platform administration (attributed via platform_actor_id; the
  // tenant_id, when set, is the TARGET tenant being administered). Never carries
  // secrets, passwords, keys, or tenant operational payloads.
  PLATFORM_TENANT_METADATA_UPDATED: "platform.tenant.metadata_updated",
  PLATFORM_TENANT_STATUS_CHANGED: "platform.tenant.status_changed",
  PLATFORM_TENANT_PLAN_CHANGED: "platform.tenant.plan_changed",
  PLATFORM_ROLE_TEMPLATE_UPDATED: "platform.role_template.updated",
  PLATFORM_BRANDING_UPDATED: "platform.branding.updated",
  // Phase 6.0F — a Platform Copilot query. Records SAFE metadata only (actor, provider,
  // model, tenant count, context categories, token/outcome) — never the prompt, the
  // answer, or any tenant secret.
  PLATFORM_COPILOT_QUERY: "platform.copilot.query",
  // Phase 7.6A — a Logistics Copilot query (tenant-scoped). Records SAFE metadata only
  // (actor, tenant, provider, model, modules consulted, recommendation count, duration,
  // outcome) — NEVER the prompt body, the answer, or any operational secret.
  LOGISTICS_COPILOT_QUERY: "logistics.copilot.query",
  // Phase 7.7 — Executive Intelligence Dashboard. Records ACCESS only (who looked, what
  // degraded), never the metrics themselves: executive figures are derived on read from the
  // authoritative module readers and are never stored or snapshotted in the audit.
  EXECUTIVE_DASHBOARD_VIEWED: "executive.dashboard.viewed",
  EXECUTIVE_DASHBOARD_EXPORTED: "executive.dashboard.exported",
  EXECUTIVE_COPILOT_QUERY: "executive.copilot.query",
  // Phase 10.0F-2 — Operations Copilot. Records SAFE metadata only (actor, tenant, provider,
  // model, question focus class, fallback flag, duration, outcome) — NEVER the question body,
  // the answer, the operational context, KPI amounts, alert contents, or any secret.
  OPERATIONS_COPILOT_QUERY: "operations.copilot.query",

  // DBC-1 — Digital Brand Center. Payloads carry only changed field NAMES, asset kinds/ids,
  // membership ids, status transitions, and safe file metadata (size/MIME). NEVER raw files,
  // the whistleblower URL, public-card tokens, signed URLs, or full profile contents.
  BRAND_PROFILE_UPDATED: "brand.profile.updated",
  BRAND_ASSET_UPLOADED: "brand.asset.uploaded",
  BRAND_ASSET_REPLACED: "brand.asset.replaced",
  BRAND_ASSET_RETIRED: "brand.asset.retired",
  BRAND_MEMBERSHIP_CREATED: "brand.membership.created",
  BRAND_MEMBERSHIP_UPDATED: "brand.membership.updated",
  BRAND_MEMBERSHIP_RETIRED: "brand.membership.retired",
  BRAND_WORKFORCE_PROFILE_UPDATED: "brand.workforce_profile.updated",
  // DBC-2 — email signature engine. Safe metadata only (actor/tenant/employee/variant/
  // format) — NEVER the generated HTML, plain text, URLs, or phone values.
  BRAND_SIGNATURE_PREVIEWED: "brand.signature.previewed",
  BRAND_SIGNATURE_GENERATED: "brand.signature.generated",
  BRAND_SIGNATURE_DOWNLOADED: "brand.signature.downloaded",
  BRAND_SIGNATURE_COPIED: "brand.signature.copied",
  // DBC-3 — public digital business card. Safe metadata only (actor/tenant/employee/format)
  // — NEVER the token, URL, contact values, QR payload, or vCard content.
  BRAND_CARD_ENABLED: "brand.card.enabled",
  BRAND_CARD_DISABLED: "brand.card.disabled",
  BRAND_CARD_TOKEN_ROTATED: "brand.card.token_rotated",
  BRAND_CARD_PREVIEWED: "brand.card.previewed",
  BRAND_CARD_VCARD_DOWNLOADED: "brand.card.vcard_downloaded",
  BRAND_CARD_QR_DOWNLOADED: "brand.card.qr_downloaded",
  // DBC-4 — corporate document platform. Safe metadata only (actor/tenant/type/format) —
  // NEVER the document body, customer data, prices, line items, or the generated file.
  BRAND_DOCUMENT_PREVIEWED: "brand.document.previewed",
  BRAND_DOCUMENT_GENERATED: "brand.document.generated",
  BRAND_DOCUMENT_DOWNLOADED: "brand.document.downloaded",
  BRAND_DOCUMENT_TEMPLATE_UPDATED: "brand.document.template_updated", // reserved (no editor in DBC-4)
  // DBC-5 — presentation + communication platform. Safe metadata only (actor/tenant/type/
  // kind) — NEVER the generated slides, PPTX, banner, or user content.
  BRAND_PRESENTATION_PREVIEWED: "brand.presentation.previewed",
  BRAND_PRESENTATION_GENERATED: "brand.presentation.generated",
  BRAND_PRESENTATION_DOWNLOADED: "brand.presentation.downloaded",
  BRAND_COMMUNICATION_GENERATED: "brand.communication.generated",
  // DBC-6 — marketing templates + governance. Safe metadata only (actor/tenant/category/
  // key/state/provider) — NEVER the generated HTML or user content.
  BRAND_TEMPLATE_CREATED: "brand.template.created",
  BRAND_TEMPLATE_UPDATED: "brand.template.updated",
  BRAND_TEMPLATE_LIFECYCLE_CHANGED: "brand.template.lifecycle_changed",
  BRAND_DOWNLOAD_GENERATED: "brand.download.generated",
  BRAND_GUIDE_VIEWED: "brand.guide.viewed",

  // Phase 5.0B — official process engine. Payloads carry only step KEYS, state
  // names, actor ids and evidence KEYS. NEVER document contents, file bytes,
  // secrets, passwords, or raw client data — enforced by the audit-safety test in
  // tests/process-engine-compat.test.ts, which scans lib/process/engine/actions.ts.
  PROCESS_INITIALIZED: "process.initialized",
  PROCESS_STEP_ACTIVATED: "process.step.activated",
  PROCESS_STEP_SUBMITTED: "process.step.submitted",
  PROCESS_STEP_APPROVED: "process.step.approved",
  PROCESS_STEP_REJECTED: "process.step.rejected",
  PROCESS_STEP_COMPLETED: "process.step.completed",
  PROCESS_CORRECTION_SUBMITTED: "process.correction.submitted",
  PROCESS_HANDOFF_SENT: "process.handoff.sent",
  PROCESS_HANDOFF_RECEIVED: "process.handoff.received",
  PROCESS_HANDOFF_REJECTED: "process.handoff.rejected",
  PROCESS_GATE_BLOCKED: "process.gate.blocked",
  PROCESS_GATE_SATISFIED: "process.gate.satisfied",
  /** Self-validation override. Requires process:override + a justification. */
  PROCESS_MAKER_CHECKER_OVERRIDE: "process.maker_checker.override",
  PROCESS_COMPATIBILITY_MAPPED: "process.compatibility.mapped",
  PROCESS_OPERATIONALLY_COMPLETED: "process.operationally_completed",
  PROCESS_CLOSED: "process.closed",

  // Phase 5.0D — post-delivery chain (official steps 18-26). Payloads carry ids,
  // states, actor ids, evidence KEYS, amounts and reasons. NEVER a full email body,
  // never a collection conversation transcript, never document contents, never bank
  // credentials. Enforced by the audit-safety test in tests/process-5d.test.ts.
  INVOICE_DRAFT_SUBMITTED: "invoice.draft.submitted",
  INVOICE_VALIDATED: "invoice.validated",
  INVOICE_VALIDATION_REJECTED: "invoice.validation.rejected",
  INVOICE_EMAILED: "invoice.emailed",
  INVOICE_EMAIL_FAILED: "invoice.email.failed",
  DEPOSIT_PREPARED: "deposit.prepared",
  DEPOSIT_COURIER_ASSIGNED: "deposit.courier.assigned",
  DEPOSIT_STARTED: "deposit.started",
  DEPOSIT_COMPLETED: "deposit.completed",
  DEPOSIT_FAILED: "deposit.failed",
  DEPOSIT_PROOF_SUBMITTED: "deposit.proof.submitted",
  DEPOSIT_PROOF_ACCEPTED: "deposit.proof.accepted",
  DEPOSIT_PROOF_REJECTED: "deposit.proof.rejected",
  DEPOSIT_HANDED_TO_COLLECTIONS: "deposit.handed_to_collections",
  COLLECTION_FOLLOW_UP: "collection.follow_up",
  COLLECTION_PROMISE_RECORDED: "collection.promise.recorded",
  COLLECTION_DISPUTE_RECORDED: "collection.dispute.recorded",
  CLOSURE_READINESS_EVALUATED: "closure.readiness.evaluated",

  // Phase 5.0D-4 — Collections + explicit closure. Payloads carry ids, channels,
  // outcomes, dates and blocker CODES. NEVER a follow-up note's content, never a
  // conversation transcript, never bank or provider credentials.
  COLLECTIONS_HANDOFF_RECEIVED: "collections.handoff.received",
  COLLECTOR_ASSIGNED: "collections.collector.assigned",
  COLLECTOR_REASSIGNED: "collections.collector.reassigned",
  COLLECTION_PROMISE_MISSED: "collection.promise.missed",
  COLLECTION_ESCALATED: "collection.escalated",
  COLLECTION_DISPUTE_RESOLVED: "collection.dispute.resolved",
  COLLECTIONS_COMPLETED: "collections.completed",
  DOSSIER_CLOSURE_BLOCKED: "closure.blocked",

  // Phase 7.2A — Shipping Line Platform. Operator/system actions + SAFE summaries only
  // (shipment id, milestone, provider code, event type, safe error category). NEVER a raw
  // provider payload, provider credentials, tokens, full documents, customer PII, or
  // unrestricted telemetry — the high-volume external tracking events live in the dedicated
  // ocean_tracking_event store, NOT here.
  SHIPPING_SHIPMENT_UPDATED: "shipping.shipment.updated",
  SHIPPING_BOOKING_UPDATED: "shipping.booking.updated",
  SHIPPING_CONTAINER_LINKED: "shipping.container.linked",
  SHIPPING_TRACKING_MANUAL_EVENT: "shipping.tracking.manual_event_added",
  SHIPPING_MILESTONE_CHANGED: "shipping.milestone.changed",
  SHIPPING_PROVIDER_REFRESH_REQUESTED: "shipping.provider.refresh_requested",
  SHIPPING_PROVIDER_REFRESH_SUCCEEDED: "shipping.provider.refresh_succeeded",
  SHIPPING_PROVIDER_REFRESH_FAILED: "shipping.provider.refresh_failed",
  SHIPPING_ETA_CHANGED: "shipping.eta.changed",
  // Phase 7.2B — ocean management (same safe-metadata rule as above).
  SHIPPING_CARRIER_CREATED: "shipping.carrier.created",
  SHIPPING_CARRIER_UPDATED: "shipping.carrier.updated",
  SHIPPING_PORT_CREATED: "shipping.port.created",
  SHIPPING_PORT_UPDATED: "shipping.port.updated",
  SHIPPING_VESSEL_CREATED: "shipping.vessel.created",
  SHIPPING_VESSEL_UPDATED: "shipping.vessel.updated",
  SHIPPING_VOYAGE_CREATED: "shipping.voyage.created",
  SHIPPING_VOYAGE_UPDATED: "shipping.voyage.updated",
  SHIPPING_CONTAINER_CREATED: "shipping.container.created",
  SHIPPING_CONTAINER_REASSIGNED: "shipping.container.reassigned",
  SHIPPING_ROUTE_UPDATED: "shipping.route.updated",
  SHIPPING_ETA_UPDATED: "shipping.eta.updated",

  // Phase 7.3A — Air Cargo (sibling of shipping; same safe-metadata rule — actor/tenant/
  // entity id/changed field NAMES/milestones only; NEVER coordinates, PII, credentials, raw
  // telemetry). High-volume air events live in air_tracking_event, not the audit log.
  AIR_AIRLINE_CREATED: "air.airline.created",
  AIR_AIRLINE_UPDATED: "air.airline.updated",
  AIR_AIRPORT_CREATED: "air.airport.created",
  AIR_AIRPORT_UPDATED: "air.airport.updated",
  AIR_FLIGHT_CREATED: "air.flight.created",
  AIR_FLIGHT_UPDATED: "air.flight.updated",
  AIR_FLIGHT_LEG_UPDATED: "air.flight_leg.updated",
  AIR_AWB_UPDATED: "air.awb.updated",
  AIR_ULD_CREATED: "air.uld.created",
  AIR_CARGO_CREATED: "air.cargo.created",
  AIR_TRACKING_MANUAL_EVENT: "air.tracking.manual_event_added",
  AIR_MILESTONE_CHANGED: "air.milestone.changed",
  AIR_ETA_UPDATED: "air.eta.updated",

  // Phase 7.4A — Document Intelligence. SAFE metadata ONLY (document id, class, job id,
  // provider code, field KEY, review decision, target domain, outcome category, counts).
  // NEVER extracted text, document contents, invoice values, customer names, evidence
  // excerpts, provider credentials, raw AI response, or prompts with customer data.
  DOCUMENT_INTELLIGENCE_REQUESTED: "document.intelligence.requested",
  DOCUMENT_CLASSIFIED: "document.classified",
  DOCUMENT_EXTRACTION_COMPLETED: "document.extraction.completed",
  DOCUMENT_EXTRACTION_FAILED: "document.extraction.failed",
  DOCUMENT_REVIEW_COMPLETED: "document.review.completed",
  DOCUMENT_FIELD_APPLIED: "document.field.applied",
  DOCUMENT_FIELD_APPLICATION_FAILED: "document.field.application_failed",

  // Phase 9.0B — workflow structural extensions. Payloads carry ids, states, step
  // KEYS, categories, team codes and outcome codes — NEVER a blocker's internal
  // description body, a decision's full narrative, or any financial detail.
  PROCESS_OWNER_ASSIGNED: "process.owner.assigned",
  PROCESS_OWNER_CHANGED: "process.owner.changed",
  PROCESS_DECISION_REQUESTED: "process.decision.requested",
  PROCESS_DECISION_FINALIZED: "process.decision.finalized",
  PROCESS_BLOCKER_OPENED: "process.blocker.opened",
  PROCESS_BLOCKER_ACKNOWLEDGED: "process.blocker.acknowledged",
  PROCESS_BLOCKER_RESOLVED: "process.blocker.resolved",
  PROCESS_BLOCKER_CANCELLED: "process.blocker.cancelled",
  PROCESS_TEAM_MEMBER_ADDED: "process.team.member_added",
  PROCESS_TEAM_MEMBER_REMOVED: "process.team.member_removed",
  PROCESS_TEAM_ASSIGNED: "process.team.assigned",
  PROCESS_STEP_SKIPPED: "process.step.skipped",
  PROCESS_STEP_SKIP_REOPENED: "process.step.skip_reopened",
  // Phase 9.0D — a Transit step assigned to a specific eligible user (declarant,
  // chef). Safe metadata only: step key + assignee id, never a UUID in any label.
  PROCESS_STEP_ASSIGNED: "process.step.assigned",
  PROCESS_TRANSIT_RECEIVED: "process.transit.received",

  // Phase 9.0E — Finance execution. Safe metadata only: category, status,
  // amount/currency, references — never free-text notes or beneficiary banking
  // details, and NEVER a claim the data does not support (an approval is not a
  // payment; evidence submission is not verification).
  FINANCE_REQUEST_CREATED: "finance.request.created",
  FINANCE_REQUEST_REVIEWED: "finance.request.reviewed",
  FINANCE_REQUEST_DISBURSED: "finance.request.disbursed",
  FINANCE_EVIDENCE_SUBMITTED: "finance.request.evidence_submitted",
  FINANCE_EVIDENCE_VERIFIED: "finance.request.evidence_verified",
  FINANCE_REQUEST_BILLED: "finance.request.billed",
  FINANCE_CLEARED: "finance.cleared",

  // Phase 8.7 — Effitrans Messaging Center. The message table itself is the immutable
  // record of what was said, so ordinary sends are audited by ID + safe metadata only
  // (conversation, sender, message type, department) — NEVER the message body.
  MESSAGING_CONVERSATION_CREATED: "messaging.conversation.created",
  MESSAGING_CONVERSATION_ASSIGNED: "messaging.conversation.assigned",
  MESSAGING_CONVERSATION_STATUS_CHANGED: "messaging.conversation.status_changed",
  MESSAGING_CONVERSATION_CLOSED: "messaging.conversation.closed",
  MESSAGING_CONVERSATION_REOPENED: "messaging.conversation.reopened",
  MESSAGING_MESSAGE_SENT: "messaging.message.sent",
  MESSAGING_ATTACHMENT_UPLOADED: "messaging.attachment.uploaded",
  MESSAGING_MESSAGE_REDACTED: "messaging.message.redacted",
  MESSAGING_PARTICIPANT_ADDED: "messaging.participant.added",
  MESSAGING_PARTICIPANT_REMOVED: "messaging.participant.removed",

  // Phase HR-1 — Employee Registry. HR holds the platform's most sensitive data,
  // so audit payloads carry SAFE METADATA ONLY: entity ids, status before/after,
  // the NAMES of changed fields, department, and dates — NEVER contact values
  // (phone/email), NEVER emergency-contact values, and the excluded-forever
  // fields (salary/national-ID/medical) do not exist to log. Account
  // linking/unlinking is audited without asserting any grant (it grants nothing).
  HR_EMPLOYEE_CREATED: "hr.employee.created",
  HR_EMPLOYEE_UPDATED: "hr.employee.updated",
  HR_EMPLOYEE_STATUS_CHANGED: "hr.employee.status_changed",
  HR_EMPLOYEE_ACCOUNT_LINKED: "hr.employee.account_linked",
  HR_EMPLOYEE_ACCOUNT_UNLINKED: "hr.employee.account_unlinked",

  // Phase 11.0B — Finance Expense Documents (Autorisation / Bon de Dépenses).
  // Safe metadata only: ids, document type, status, version number, number
  // prefix — NEVER amounts, beneficiary, account/registration values, or PDF
  // content. Approval/signature/payment events are added in 11.0C..11.0E.
  EXPENSE_AUTHORIZATION_CREATED: "finance.expense.authorization.created",
  EXPENSE_AUTHORIZATION_SUBMITTED: "finance.expense.authorization.submitted",
  EXPENSE_AUTHORIZATION_VERSION_CREATED: "finance.expense.authorization.version_created",
  EXPENSE_VOUCHER_CREATED: "finance.expense.voucher.created",
  EXPENSE_VOUCHER_SUBMITTED: "finance.expense.voucher.submitted",
  EXPENSE_VOUCHER_VERSION_CREATED: "finance.expense.voucher.version_created",
  EXPENSE_APPROVAL_ATTEMPT_OPENED: "finance.expense.approval_attempt.opened",

  // Phase 11.0C — draft editing, supporting documents and PDF rendering. Same
  // redaction rule: file NAMES and ids only (never attachment CONTENT, never a
  // signed URL), and the PDF event records the template version, never the bytes.
  EXPENSE_AUTHORIZATION_UPDATED: "finance.expense.authorization.updated",
  EXPENSE_ATTACHMENT_ADDED: "finance.expense.attachment.added",
  EXPENSE_ATTACHMENT_RETIRED: "finance.expense.attachment.retired",
  EXPENSE_AUTHORIZATION_PDF_GENERATED: "finance.expense.authorization.pdf_generated",

  // Phase 11.0D — the approval chain. Payload carries step code/ordinal,
  // decision, attempt, version and resulting status ONLY: never the amount, the
  // beneficiary, the signer's comment text, or the document's field values.
  EXPENSE_VISA_RECORDED: "finance.expense.visa.recorded",

  // Phase WES-7 — versioned workflow policy registry (ADR-WES-012). Safe
  // metadata only: version numbers, scope, hashes and error COUNTS — never the
  // policy document, never validation error text containing identifiers.
  WORKFLOW_POLICY_DRAFT_CREATED: "workflow.policy.draft.created",
  WORKFLOW_POLICY_VALIDATION_PASSED: "workflow.policy.validation.passed",
  WORKFLOW_POLICY_VALIDATION_FAILED: "workflow.policy.validation.failed",
  WORKFLOW_POLICY_ACTIVATED: "workflow.policy.activated",
  WORKFLOW_POLICY_DOSSIER_MIGRATED: "workflow.policy.dossier.migrated",
} as const;

export type AuditActionCode = (typeof AuditActions)[keyof typeof AuditActions];
