// Generated from spec/openapi.json by scripts/gen-types.mjs: do not edit.
// After `pnpm spec:update`, run `pnpm types:generate`.

export interface TagRefResponse {
  id: string;
  name: string;
  color: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  /** Matching records in all */
  totalCount: number;
  /** The page answered, zero-based */
  page: number;
  /** The page size that applied */
  limit: number;
  hasNextPage: boolean;
}

export interface DeletedResponse {
  deleted: boolean;
}

export interface DroppedRecipientResponse {
  email: string;
  /** Why the compliance gate refused this copy */
  reason:
    | 'HARD_SUPPRESSED'
    | 'CONSENT_SUPPRESSED'
    | 'CONTACT_HARD_BLOCKED'
    | 'ADDRESS_UNDELIVERABLE'
    | 'CONTACT_UNSUBSCRIBED'
    | 'LIST_UNSUBSCRIBED'
    | 'ORG_SENDING_PAUSED'
    | 'WORKSPACE_ARCHIVED'
    | 'SENDER_DOMAIN_UNVERIFIED'
    | 'SENDER_DOMAIN_UNVERIFIED_IN_WORKSPACE'
    | 'SENDER_NOT_CONFIGURED'
    | 'SENDER_UNDER_REVIEW';
}

export interface SendRecordResponse {
  /**
   * The record id, for GET /api/v1/emails/{id}. For a send with sendAt it also
   * cancels the send (DELETE /api/v1/emails/scheduled/{id}) until it fires.
   */
  id: string;
  workspaceId: string;
  to: string;
  /**
   * The From address. Null when the send was refused before a sender was
   * resolved (SENDER_NOT_CONFIGURED), and for a scheduled send that names none
   * until it fires.
   */
  from: string | null;
  /**
   * Null only while a templated scheduled send waits with no subject override:
   * the template subject is rendered when it fires.
   */
  subject: string | null;
  /**
   * SENT when the provider accepted it; DELIVERED, OPENED, CLICKED, BOUNCED as
   * events come in; SUPPRESSED when the compliance gate refused it (reason in
   * errorMessage); FAILED when the provider did not take it; QUEUED while it
   * waits (holdReason and heldUntil say why and until when); SCHEDULED and
   * CANCELLED for a send with sendAt that has not fired.
   */
  status:
    | 'QUEUED'
    | 'SENT'
    | 'DELIVERED'
    | 'OPENED'
    | 'CLICKED'
    | 'BOUNCED'
    | 'FAILED'
    | 'SUPPRESSED'
    | 'SCHEDULED'
    | 'CANCELLED';
  /**
   * The reputation stream the message goes out on. Null for a templated
   * scheduled send until it fires, and on records older than streams.
   */
  stream: 'TRANSACTIONAL' | 'MARKETING' | null;
  /**
   * The send path: TRANSACTIONAL_API for /emails/send, DIRECT for
   * /emails/send-template, BULK for /emails/send-bulk recipients. Null on
   * records older than channels.
   */
  channel:
    | 'CAMPAIGN'
    | 'BULK'
    | 'SEQUENCE'
    | 'DIRECT'
    | 'TRANSACTIONAL_API'
    | 'CAMPAIGN_TEST'
    | 'FORM_CONFIRMATION'
    | null;
  /**
   * The SendBlockReason of a SUPPRESSED record, our key or sentence for a
   * FAILED one; null otherwise.
   */
  errorMessage: string | null;
  /**
   * Copy recipients (cc, bcc) the compliance gate refused; the message went
   * without them. Null when none were dropped.
   */
  droppedRecipients: DroppedRecipientResponse[] | null;
  /**
   * Why a QUEUED send waits (daily capacity, new-sender warm-up, a checked
   * import slice). It goes out by itself; never retry it. Null when it is not
   * held.
   */
  holdReason:
    | 'PLATFORM_DAILY_LIMIT'
    | 'ORGANIZATION_DAILY_SHARE'
    | 'EARNED_VOLUME'
    | 'WARMUP_SAMPLE'
    | 'WARMUP_SAMPLE_FAILED'
    | 'IMPORT_SAMPLE'
    | 'IMPORT_SAMPLE_FAILED'
    | null;
  /**
   * When a held send is next tried; it may be held again then.
   *
   * @format date-time
   */
  heldUntil: string | null;
  /** The provider message id, once the provider accepted it. */
  providerMessageId: string | null;
  templateId: string | null;
  campaignId: string | null;
  /** The sequence step that sent it, for SEQUENCE records. */
  sequenceStepId: string | null;
  /**
   * The batchId a bulk send answered, on each of its recipient records; the
   * enrollment id on sequence records.
   */
  batchId: string | null;
  /**
   * When a send with sendAt is due. Null for a send that was not scheduled.
   *
   * @format date-time
   */
  scheduledAt: string | null;
  /** @format date-time */
  sentAt: string | null;
  /** @format date-time */
  deliveredAt: string | null;
  /**
   * When the recipient reported the message as spam.
   *
   * @format date-time
   */
  complainedAt: string | null;
  /** Opens by people. */
  openCount: number;
  /** Clicks by people. */
  clickCount: number;
  /** Opens by scanners, link checkers and prefetchers, never in openCount. */
  machineOpenCount: number;
  /** Clicks by scanners and automated clients, never in clickCount. */
  machineClickCount: number;
  /**
   * Pixel fetches by a mail privacy proxy (Apple Mail Privacy Protection):
   * maybe a reader, maybe nobody.
   */
  unconfirmedOpenCount: number;
  /** @format date-time */
  firstOpenedAt: string | null;
  /** @format date-time */
  lastOpenedAt: string | null;
  /** @format date-time */
  firstClickedAt: string | null;
  /** @format date-time */
  lastClickedAt: string | null;
  /** @format date-time */
  createdAt: string;
}

export interface EmailAttachmentRequest {
  /**
   * File content, base64-encoded. Bytes are passed straight to the provider and
   * never stored. Deliberately excluded from the idempotency fingerprint: a
   * retried job that regenerates the file (a fresh creation timestamp inside
   * the PDF) replays the original response instead of failing the key with 409.
   */
  content: string;
  /**
   * Filename shown to the recipient. A name ending in an extension SES refuses
   * (.exe, .bat, .js, .msi and the rest of its list, any case) is refused with
   * 400 emailSending.attachmentTypeNotAllowed.
   */
  filename: string;
  /** MIME type. Only allowlisted types are accepted. */
  type:
    | 'application/pdf'
    | 'image/png'
    | 'image/jpeg'
    | 'image/gif'
    | 'image/webp'
    | 'text/calendar'
    | 'text/csv'
    | 'text/plain'
    | 'application/zip';
  /**
   * Only "attachment" is supported. Present for SendGrid payload compatibility;
   * inline (CID) images are not supported.
   */
  disposition?: 'attachment';
}

export interface SendEmailRequest {
  /** Recipient email address */
  to: string;
  /** Email subject line */
  subject: string;
  /** Email body as HTML */
  html: string;
  /**
   * Sender address. Defaults to the workspace's default sender identity; with
   * no identity configured the send is suppressed with SENDER_NOT_CONFIGURED.
   */
  from?: string;
  /**
   * Display name for this send, overriding the sender identity's. The address
   * is what domain verification gates; the name may vary per send (one verified
   * address, several product names). Any script is fine (encoded for the
   * header). No CR/LF or angle brackets. Without one, the identity's name;
   * without that, the bare address.
   */
  fromName?: string;
  /** Reply-To address */
  replyTo?: string;
  /**
   * Carbon-copy recipients. Each address is checked against the suppression
   * list independently: a cc is a real delivery; a refused one is listed in
   * droppedRecipients. At most 50 recipients in total, To included.
   */
  cc?: string[];
  /** Blind carbon-copy recipients. Also suppression-checked. */
  bcc?: string[];
  /**
   * Custom headers. Headers the platform owns (List-Unsubscribe,
   * authentication, envelope) are rejected rather than dropped. Printable ASCII
   * only: a name of at most 126 characters, a value of at most 995, both
   * together at most 996.
   */
  headers?: Record<string, string>;
  /**
   * Schedule the send for a future time (ISO-8601). Cancel before it fires with
   * DELETE /api/v1/emails/scheduled/{id}. Compliance is evaluated when it
   * fires, not when it is scheduled.
   *
   * @format date-time
   */
  sendAt?: string;
  /**
   * Attachments (max 10, 10 MB decoded total, allowlisted MIME types).
   * Transactional sends only: this route always qualifies. Not combinable with
   * sendAt. Bytes are never stored, and are excluded from the idempotency
   * fingerprint.
   */
  attachments?: EmailAttachmentRequest[];
}

export interface SendTemplateEmailRequest {
  /** Recipient email address */
  to: string;
  /** Template ID (UUID) to render and send */
  templateId: string;
  /**
   * Dynamic variables to render into the template (Handlebars/Liquid syntax).
   * If contactId is provided, contact.* variables are auto-populated and merged
   * with these.
   */
  variables?: Record<string, unknown>;
  /**
   * Contact ID (UUID). Populates contact.firstName, contact.lastName,
   * contact.email and each custom property as contact.<key>. For a MARKETING
   * template it identifies the contact whose unsubscribe link the mail carries;
   * transactional mail carries none.
   */
  contactId?: string;
  /**
   * Override the template subject line. Supports Handlebars/Liquid syntax with
   * the same variables.
   */
  subject?: string;
  /**
   * Sender address. Defaults to the workspace's default sender identity; with
   * no identity configured the send is suppressed with SENDER_NOT_CONFIGURED.
   */
  from?: string;
  /**
   * Display name for this send, overriding the sender identity's. The address
   * is what domain verification gates; the name may vary per send. Any script
   * is fine (encoded for the header). No CR/LF or angle brackets. Without one,
   * the identity's name; without that, the bare address.
   */
  fromName?: string;
  /** Reply-to email address */
  replyTo?: string;
  /**
   * Carbon-copy recipients. Each address is checked against the suppression
   * list independently: a cc is a real delivery, and a blocked copy is dropped
   * without failing the message and listed in droppedRecipients. At most 50
   * recipients in total, To included.
   */
  cc?: string[];
  /** Blind carbon-copy recipients. Also suppression-checked. */
  bcc?: string[];
  /**
   * Schedule the send for a future time (ISO-8601). The template is rendered
   * and compliance is evaluated when it fires, not when it is scheduled. Cancel
   * before it fires with DELETE /api/v1/emails/scheduled/{id}.
   *
   * @format date-time
   */
  sendAt?: string;
  /**
   * Attachments (max 10, 10 MB decoded total, allowlisted MIME types). Only
   * allowed when the template is TRANSACTIONAL. Not combinable with sendAt.
   * Bytes are never stored, and are excluded from the idempotency fingerprint.
   */
  attachments?: EmailAttachmentRequest[];
}

export interface SendBulkEmailRequest {
  /** UUID of the email template to use */
  templateId: string;
  /**
   * Sender address. Defaults to the workspace's default sender identity; with
   * no identity configured the send is suppressed with SENDER_NOT_CONFIGURED.
   */
  from?: string;
  /**
   * Template variables merged into every recipient's render; contact.* is set
   * per recipient on top.
   */
  variables?: Record<string, unknown>;
  /**
   * UUID of a list to send to (all contacts in the list). Exactly one of
   * listId, contactIds or sendToAll.
   */
  listId?: string;
  /** Specific contact UUIDs to send to */
  contactIds?: string[];
  /** Send to every subscribed contact in this workspace */
  sendToAll?: boolean;
}

export interface BulkSendResponse {
  /**
   * The launch, carried as batchId by every recipient send record. Null when
   * nothing was queued.
   */
  batchId: string | null;
  /** Contacts the audience resolved to, before the compliance gate. */
  totalRecipients: number;
  /** Recipients queued for paced delivery. */
  queued: number;
  /** Recipients the compliance gate refused. Not failures. */
  blocked: number;
}

export interface TemplateResponse {
  id: string;
  workspaceId: string;
  name: string;
  subject: string;
  /**
   * The inbox line after the subject, sent as a hidden preheader. Null when
   * none.
   */
  previewText: string | null;
  /**
   * The HTML a send renders. For a builder template it is the compiled output
   * of document.
   */
  bodyHtml: string;
  /**
   * The block document of a builder template (docs/template-document.md); null
   * for a raw HTML template.
   */
  document: Record<string, unknown> | null;
  bodyMjml: string | null;
  /** The Handlebars variables the subject and body reference. */
  variables: string[];
  /**
   * The declared type. A MARKETING channel (campaigns, bulk sends) overrides a
   * TRANSACTIONAL template at send time.
   */
  emailType: 'MARKETING' | 'TRANSACTIONAL';
  tags: TagRefResponse[];
  /** @format date-time */
  createdAt: string;
  /** @format date-time */
  updatedAt: string;
}

export interface ValidateTemplateDocumentRequest {
  /**
   * The block document to check. Returns the issues that would refuse it, empty
   * when it would save.
   */
  document: Record<string, unknown>;
  /**
   * Preview text the template will carry. Its hidden preheader is sent in the
   * same body, so it counts toward the size limit; past its own length limit it
   * is reported as an issue.
   */
  previewText?: string;
}

export interface TemplateValidationResponse {
  /** True when the document would save. */
  valid: boolean;
  /**
   * Every problem that would refuse the document, with its path; empty when
   * valid.
   */
  issues: string[];
}

export interface PreviewTemplateRequest {
  /** Raw HTML to preview. Supply exactly one of bodyHtml or document. */
  bodyHtml?: string;
  /**
   * Block document to compile and preview. Schema: docs/template-document.md.
   */
  document?: Record<string, unknown>;
  /**
   * Template type to preview as. Decides whether the preview carries an
   * unsubscribe block.
   */
  emailType?: 'MARKETING' | 'TRANSACTIONAL';
  /**
   * Channel to preview through. CAMPAIGN and BULK are always marketing whatever
   * the template says, so previewing through one shows the unsubscribe block a
   * TRANSACTIONAL template would still gain. TRANSACTIONAL_API and
   * CAMPAIGN_TEST are always transactional. SEQUENCE and DIRECT follow the
   * template.
   */
  channel?:
    | 'CAMPAIGN'
    | 'BULK'
    | 'SEQUENCE'
    | 'DIRECT'
    | 'TRANSACTIONAL_API'
    | 'CAMPAIGN_TEST';
  /**
   * Values for the Handlebars variables, so the preview renders with
   * real-looking content instead of empty placeholders.
   */
  variables?: Record<string, unknown>;
  /** Subject to render with variables; returned as renderedSubject. */
  subject?: string;
  /**
   * Preview text to render with variables. It is placed in renderedHtml as the
   * hidden preheader, returned as renderedPreviewText, and counted by the size
   * check.
   */
  previewText?: string;
}

export interface TemplatePreviewResponse {
  /**
   * The message body as a recipient gets it: the body, the unsubscribe footer
   * when one is owed, the promo badge when the workspace shows it. Links are
   * not tracked in a preview.
   */
  renderedHtml: string;
  /** The subject with variables rendered; null when none was given. */
  renderedSubject: string | null;
  /**
   * The preview text with variables rendered, also placed in renderedHtml as
   * the hidden preheader; null when none was given.
   */
  renderedPreviewText: string | null;
  /**
   * The default unsubscribe footer was added because the content carried no
   * link to the unsubscribe URL. False for transactional content, which owes
   * none.
   */
  injectedUnsubscribeFooter: boolean;
  /**
   * The content has something that reads as an unsubscribe link but does not
   * point at our endpoint: it opts nobody out, and the real footer is added
   * underneath it.
   */
  hasUnrecognizedUnsubscribeLink: boolean;
  /** The "Sent with SendHeron" line is on for this workspace and channel. */
  appendedPromoBadge: boolean;
  /**
   * The content references {{unsubscribe_url}} but the resolved policy never
   * supplies it (transactional), so a real send renders the link empty.
   */
  unsubscribeVariableIgnored: boolean;
}

export interface CreateTemplateRequest {
  /** Template name */
  name: string;
  /** Email subject line */
  subject: string;
  /**
   * Preview text: the line inboxes show after the subject, sent as a hidden
   * preheader at the top of the body. Supports Handlebars variables. Whitespace
   * is collapsed to one line; blank means none. At most 200 characters
   * (templates.previewTextTooLong).
   */
  previewText?: string;
  /**
   * HTML body, for a raw-HTML template (supports Handlebars variables). Supply
   * exactly one of bodyHtml or document. Sending both is refused rather than
   * one silently winning.
   */
  bodyHtml?: string;
  /**
   * Block document, for a builder template. The server validates it and
   * compiles bodyHtml from it, so the compiled HTML is always exactly what the
   * blocks say: you cannot send bodyHtml alongside it. Schema and block
   * reference: docs/template-document.md. Validate one without saving via POST
   * /api/v1/templates/validate.
   */
  document?: Record<string, unknown>;
  /** MJML source (optional) */
  bodyMjml?: string;
  /**
   * Email type. Required: the type decides suppression behavior and unsubscribe
   * handling, so it must be declared, never defaulted: a password-reset
   * template that silently became MARKETING would be blocked for exactly the
   * users who unsubscribed and most need it.
   */
  emailType: 'MARKETING' | 'TRANSACTIONAL';
  /** Tag IDs to associate with this template */
  tagIds?: string[];
}

export interface UpdateTemplateRequest {
  /** Template name */
  name?: string;
  /** Email subject line */
  subject?: string;
  /**
   * Preview text, the line inboxes show after the subject (hidden preheader).
   * Omit to keep it; null or an empty string removes it. At most 200
   * characters.
   */
  previewText?: string | null;
  /** HTML body (supports Handlebars variables) */
  bodyHtml?: string;
  /**
   * Block document. An object recompiles the template from it, entering or
   * staying in builder mode. An explicit null EJECTS to raw HTML: the document
   * is dropped and the last compiled bodyHtml becomes editable. Omitting the
   * field leaves the mode alone: and editing bodyHtml directly on a builder
   * template is refused until it is ejected, so the blocks and the HTML can
   * never disagree.
   */
  document?: Record<string, unknown> | null;
  /** MJML source (optional) */
  bodyMjml?: string;
  /** Email type: MARKETING or TRANSACTIONAL */
  emailType?: 'MARKETING' | 'TRANSACTIONAL';
  /** Tag IDs to associate (replaces existing tags) */
  tagIds?: string[];
  /**
   * Required whenever emailType actually changes. Reclassifying a template is a
   * compliance event: TRANSACTIONAL to MARKETING makes its sends
   * consent-suppressible, the reverse strips unsubscribe handling, so a type
   * change without this flag returns 400
   * (templates.emailTypeChangeNeedsConfirmation).
   */
  confirmEmailTypeChange?: boolean;
}

export interface SuppressionEntryResponse {
  id: string;
  email: string;
  reason: 'MANUAL' | 'ONE_CLICK' | 'COMPLAINT' | 'BOUNCE' | 'ADMIN';
  /**
   * Derived from reason. HARD (BOUNCE, COMPLAINT) blocks every send including
   * transactional and is the account-wide record of the address; CONSENT
   * (MANUAL, ONE_CLICK, ADMIN) blocks marketing from this workspace only.
   */
  tier: 'HARD' | 'CONSENT';
  /**
   * What recorded it: a provider event, the recipient, the dashboard, the API
   * or the platform. Null on records older than sources.
   */
  source:
    | 'PROVIDER_WEBHOOK'
    | 'RECIPIENT'
    | 'DASHBOARD'
    | 'API'
    | 'SYSTEM'
    | null;
  /** The note given when it was suppressed by hand. */
  note: string | null;
  /**
   * The workspace a CONSENT entry belongs to. Null for a HARD entry, which
   * blocks every workspace of the account.
   */
  workspaceId: string | null;
  /** @format date-time */
  createdAt: string;
}

export interface ChannelDeliverabilityResponse {
  /** Would a message on this stream go out right now. */
  allowed: boolean;
  /** What stops it; null when allowed. */
  blockReason:
    | 'HARD_SUPPRESSED'
    | 'CONSENT_SUPPRESSED'
    | 'CONTACT_HARD_BLOCKED'
    | 'ADDRESS_UNDELIVERABLE'
    | 'CONTACT_UNSUBSCRIBED'
    | 'LIST_UNSUBSCRIBED'
    | 'ORG_SENDING_PAUSED'
    | 'WORKSPACE_ARCHIVED'
    | 'SENDER_DOMAIN_UNVERIFIED'
    | 'SENDER_DOMAIN_UNVERIFIED_IN_WORKSPACE'
    | 'SENDER_NOT_CONFIGURED'
    | 'SENDER_UNDER_REVIEW'
    | null;
}

export interface SuppressionCheckResponse {
  /** The address as checked, normalized. */
  email: string;
  /** A suppression entry reaches this address, whatever its tier. */
  suppressed: boolean;
  /**
   * The strictest entry's tier; null when not suppressed. Derived from reason.
   * HARD (BOUNCE, COMPLAINT) blocks every send including transactional and is
   * the account-wide record of the address; CONSENT (MANUAL, ONE_CLICK, ADMIN)
   * blocks marketing from this workspace only.
   */
  tier: 'HARD' | 'CONSENT' | null;
  reason: 'MANUAL' | 'ONE_CLICK' | 'COMPLAINT' | 'BOUNCE' | 'ADMIN' | null;
  source:
    | 'PROVIDER_WEBHOOK'
    | 'RECIPIENT'
    | 'DASHBOARD'
    | 'API'
    | 'SYSTEM'
    | null;
  /** @format date-time */
  suppressedAt: string | null;
  note: string | null;
  /**
   * The matching contact in this workspace, when there is one; its status also
   * gates sending.
   */
  contactStatus:
    | 'SUBSCRIBED'
    | 'UNSUBSCRIBED'
    | 'BOUNCED'
    | 'COMPLAINED'
    | null;
  /**
   * The matching contact's screening verdict; null without a screened contact.
   * Only UNDELIVERABLE stops mail.
   */
  screeningVerdict: 'VALID' | 'RISKY' | 'UNDELIVERABLE' | 'UNCHECKED' | null;
  screeningReasons: (
    | 'INVALID_SYNTAX'
    | 'KNOWN_HARD_BOUNCE'
    | 'DOMAIN_NOT_FOUND'
    | 'NO_MAIL_SERVER'
    | 'DISPOSABLE_DOMAIN'
    | 'LIKELY_TYPO'
    | 'ROLE_ADDRESS'
    | 'SYSTEM_ADDRESS'
    | 'DNS_UNCHECKED'
  )[];
  /** The address with a likely domain typo fixed. */
  suggestedEmail: string | null;
  /**
   * The address hard-bounced as nonexistent somewhere on the platform. Blocks
   * every stream.
   */
  knownHardBounce: boolean;
  marketing: ChannelDeliverabilityResponse;
  transactional: ChannelDeliverabilityResponse;
}

export interface SuppressEmailRequest {
  /** Address to suppress */
  email: string;
  /**
   * Manual suppression reasons only. Bounce and complaint are recorded by the
   * platform from provider events and cannot be set through this endpoint:
   * accepting them would let a caller fabricate a deliverability record that
   * blocks transactional mail.
   *
   * @default "MANUAL"
   */
  reason?: 'MANUAL' | 'ADMIN';
  /** Why this address is being suppressed. Shown to support. */
  note?: string;
}

export interface PlanPositionResponse {
  /**
   * ACTIVE (the plan caps apply), LAPSED (no live subscription: growth refused,
   * transactional bounded by the smallest plan for a customer who has paid
   * before and refused otherwise), UNLIMITED (pre-billing organization, no
   * caps).
   */
  status: 'ACTIVE' | 'LAPSED' | 'UNLIMITED';
  /** The subscribed plan; null when LAPSED or UNLIMITED. */
  name: string | null;
  /**
   * When the running trial ends and the trial ceilings stop applying; null once
   * paid, or when there is none.
   *
   * @format date-time
   */
  trialEndsAt: string | null;
  /**
   * Why LAPSED: NEVER_SUBSCRIBED, TRIAL_EXPIRED (nothing was ever paid, so no
   * transactional grace either), PAYMENT_FAILED (Stripe is retrying the
   * charge), CANCELED. Null for any other status.
   */
  lapsedReason:
    | 'NEVER_SUBSCRIBED'
    | 'TRIAL_EXPIRED'
    | 'PAYMENT_FAILED'
    | 'CANCELED'
    | null;
  /**
   * SANDBOX or REQUESTED until a person has reviewed the organization as a
   * sender: until then every send outside your own verified domains and team
   * members is suppressed with SENDER_UNDER_REVIEW. APPROVED afterwards.
   */
  sendingReview: 'SANDBOX' | 'REQUESTED' | 'APPROVED';
}

export interface MonthlySendUsageResponse {
  /** Pool-counted sends this UTC calendar month, both streams. */
  used: number;
  /** The marketing pool ceiling. Null when UNLIMITED. */
  pool: number | null;
  /** Marketing sends that still fit. Null when UNLIMITED; 0 when LAPSED. */
  marketingRemaining: number | null;
  /** Pool plus grace: where transactional sends refuse. Null when UNLIMITED. */
  transactionalCeiling: number | null;
  /** Transactional sends that still fit. Null when UNLIMITED. */
  transactionalRemaining: number | null;
  /**
   * Start of the next UTC calendar month, when used resets.
   *
   * @format date-time
   */
  resetsAt: string;
}

export interface ContactUsageResponse {
  /**
   * SUBSCRIBED contacts across the organization: the only ones the cap counts.
   */
  subscribed: number;
  /**
   * The plan contact cap (trial-capped while trialing). Null when UNLIMITED; 0
   * when LAPSED.
   */
  cap: number | null;
  /** How many more contacts fit. Null when UNLIMITED. */
  remaining: number | null;
}

export interface CountUsageResponse {
  used: number;
  /** The plan cap. Null when UNLIMITED; 0 when LAPSED (growth is refused). */
  cap: number | null;
  /** How many more fit. Null when UNLIMITED. */
  remaining: number | null;
}

export interface WarmupUsageResponse {
  /**
   * WARMING (never-mailed addresses go out in checked slices), HELD (a slice
   * crossed the bounce or complaint line; new-address sends on heldStreams wait
   * for a person), COMPLETE.
   */
  status: 'WARMING' | 'HELD' | 'COMPLETE';
  /** @format date-time */
  completedAt: string | null;
  /** Never-mailed addresses each stream may have waiting for their check. */
  sampleSize: number;
  heldStreams: ('TRANSACTIONAL' | 'MARKETING')[];
}

export interface SendingCapacityUsageResponse {
  /**
   * Recipients handed to the provider in the rolling 24 hours, both streams.
   * Null when unreadable.
   */
  last24Hours: number | null;
  transactionalLast24Hours: number | null;
  /**
   * The most of the shared quota one organization may take; null when the quota
   * is unlimited.
   */
  share: number | null;
  /**
   * Daily volume this organization has proven it sends cleanly; marketing above
   * it waits.
   */
  earnedVolume: number;
  /** Marketing recipients that still fit right now. Null when unreadable. */
  marketingRemaining: number | null;
  /**
   * The platform reached its daily marketing line: everyone's marketing waits
   * for the window.
   */
  platformMarketingHeld: boolean;
  /** Sends waiting now (status QUEUED with a holdReason). */
  held: number;
  warmup: WarmupUsageResponse;
}

export interface SignupFormsUsageResponse {
  forms: CountUsageResponse;
  /** Signups waiting for their confirmation click, not yet expired. */
  pendingSignups: number;
  /**
   * Signups that became subscribed contacts in the last 30 days (confirmed, or
   * single opt-in).
   */
  confirmedLast30Days: number;
  /**
   * Forms under attack right now: held to a trickle, every signup double
   * opt-in.
   */
  underAttack: number;
}

export interface OrganizationRateLimitsResponse {
  /** Reads per minute across every key of the organization. */
  READ: number;
  /** Mutations without outbound mail per minute across every key. */
  WRITE: number;
  /**
   * Sends, and anything that dispatches or schedules mail, per minute across
   * every key.
   */
  SEND: number;
}

export interface RateLimitsResponse {
  /** Requests per minute per key, unless a route carries its own limit. */
  perKeyPerMinute: number;
  organizationPerMinute: OrganizationRateLimitsResponse;
}

export interface UsageResponse {
  plan: PlanPositionResponse;
  monthlySends: MonthlySendUsageResponse;
  contacts: ContactUsageResponse;
  /** Distinct sending domains across the organization against the plan cap. */
  domains: CountUsageResponse;
  /**
   * Live workspaces against the plan cap, or the organization's own override.
   */
  workspaces: CountUsageResponse;
  /** Team members, pending invitations included, against the plan cap. */
  teamMembers: CountUsageResponse;
  /**
   * The rolling 24-hour position on the shared sending quota and the warm-up.
   * Not a plan cap: held mail waits and goes out by itself. Null when the
   * position could not be read.
   */
  sending: SendingCapacityUsageResponse | null;
  signupForms: SignupFormsUsageResponse;
  rateLimits: RateLimitsResponse;
}

export interface CreateFormSignupRequest {
  /**
   * The address that signs up. It gets the confirmation email; nothing happens
   * until its owner confirms.
   */
  email: string;
  /**
   * Kept only when the form shows a first name field, and required when the
   * form requires it.
   */
  firstName?: string;
  /**
   * Kept only when the form shows a last name field, and required when the form
   * requires it.
   */
  lastName?: string;
  /**
   * The visitor's IP address as your server saw it: behind Cloudflare the
   * CF-Connecting-IP header, never an X-Forwarded-For value the visitor can
   * write. Kept on the consent record as reported, and counted toward the
   * per-visitor limit.
   */
  ipAddress: string;
  /**
   * The visitor's User-Agent header, kept on the consent record as reported.
   */
  userAgent?: string;
}

export interface FormSignupAcceptedResponse {
  /**
   * The same for every address: new, already waiting for its confirmation,
   * already subscribed, or one we will not mail. Show the visitor "check your
   * inbox" and nothing more.
   */
  status: 'ACCEPTED';
}

/**
 * The routes this SDK calls, as the API document declares them: the body, the
 * query and the success response of each. The resources are typed to match, and
 * test/types.test.ts holds them to it.
 */
export interface Routes {
  'POST /api/v1/emails/send': {
    body: SendEmailRequest;
    response: SendRecordResponse;
  };
  'POST /api/v1/emails/send-template': {
    body: SendTemplateEmailRequest;
    response: SendRecordResponse;
  };
  'POST /api/v1/emails/send-bulk': {
    body: SendBulkEmailRequest;
    response: BulkSendResponse;
  };
  'GET /api/v1/emails/{id}': {
    response: SendRecordResponse;
  };
  'DELETE /api/v1/emails/scheduled/{id}': {
    response: DeletedResponse;
  };
  'GET /api/v1/templates': {
    query: {
      /**
       * Page number, zero-based
       *
       * @default 0
       * @minimum 0
       */
      page?: number;
      /**
       * Items per page
       *
       * @default 50
       * @minimum 1
       * @maximum 100
       */
      limit?: number;
      /** Search by template name or subject (ILIKE) */
      term?: string;
      /** Filter by tag IDs (comma-separated or repeated query param) */
      tagIds?: string[];
      /**
       * Filter by declared email type. This is the template tag, not the
       * effective policy: a MARKETING channel overrides a TRANSACTIONAL
       * template at send time.
       */
      emailType?: 'MARKETING' | 'TRANSACTIONAL';
    };
    response: PaginatedResponse<TemplateResponse>;
  };
  'POST /api/v1/templates': {
    body: CreateTemplateRequest;
    response: TemplateResponse;
  };
  'GET /api/v1/templates/{id}': {
    response: TemplateResponse;
  };
  'PATCH /api/v1/templates/{id}': {
    body: UpdateTemplateRequest;
    response: TemplateResponse;
  };
  'DELETE /api/v1/templates/{id}': {
    response: DeletedResponse;
  };
  'POST /api/v1/templates/validate': {
    body: ValidateTemplateDocumentRequest;
    response: TemplateValidationResponse;
  };
  'POST /api/v1/templates/preview': {
    body: PreviewTemplateRequest;
    response: TemplatePreviewResponse;
  };
  'GET /api/v1/suppressions': {
    query: {
      /**
       * Page number, zero-based
       *
       * @default 0
       * @minimum 0
       */
      page?: number;
      /**
       * Items per page
       *
       * @default 50
       * @minimum 1
       * @maximum 100
       */
      limit?: number;
      /** Search by email (ILIKE) */
      email?: string;
      /** Filter by why the address was suppressed */
      reason?: 'MANUAL' | 'ONE_CLICK' | 'COMPLAINT' | 'BOUNCE' | 'ADMIN';
      /**
       * HARD (bounce/complaint) blocks every channel including transactional.
       * CONSENT blocks marketing only.
       */
      tier?: 'HARD' | 'CONSENT';
      /** Filter by what recorded the suppression */
      source?:
        | 'PROVIDER_WEBHOOK'
        | 'RECIPIENT'
        | 'DASHBOARD'
        | 'API'
        | 'SYSTEM';
    };
    response: PaginatedResponse<SuppressionEntryResponse>;
  };
  'POST /api/v1/suppressions': {
    body: SuppressEmailRequest;
    response: SuppressionEntryResponse;
  };
  'GET /api/v1/suppressions/check': {
    query: {
      /** Address to check */
      email: string;
    };
    response: SuppressionCheckResponse;
  };
  'DELETE /api/v1/suppressions/{email}': {
    response: DeletedResponse;
  };
  'GET /api/v1/usage': {
    response: UsageResponse;
  };
  'POST /api/v1/forms/{formId}/signups': {
    body: CreateFormSignupRequest;
    response: FormSignupAcceptedResponse;
  };
}
