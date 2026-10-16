/**
 * Contract types for the SendHeron API, pinned by the committed OpenAPI
 * snapshot in spec/.
 */

/** A template's declared type. Decides suppression and unsubscribe behavior. */
export type EmailType = 'MARKETING' | 'TRANSACTIONAL';

/** Reputation/metrics stream a message went out on. */
export type SendStream = 'MARKETING' | 'TRANSACTIONAL';

/**
 * Lifecycle of one send. `suppressed` is an OUTCOME, not an error: the
 * compliance gate refused the send and recorded why: never retry those.
 * `queued` with a `holdReason` is a held send (`isHeld`): it waits for daily
 * capacity or a new sender's warm-up and goes out by itself, so never retry
 * those either.
 * `opened` and `clicked` mean a person opened or clicked. A send that only
 * machines touched (security scanners, link checkers, a privacy proxy
 * fetching the pixel) reads `delivered`: their events still prove delivery.
 */
export type EmailSendStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'failed'
  | 'suppressed';

/**
 * Why a send was refused. Carried in `errorMessage` when `status` is
 * `suppressed`. Stable, machine-readable values.
 */
export const SEND_BLOCK_REASONS = [
  'HARD_SUPPRESSED',
  'CONSENT_SUPPRESSED',
  'CONTACT_HARD_BLOCKED',
  'CONTACT_UNSUBSCRIBED',
  'LIST_UNSUBSCRIBED',
  'ORG_SENDING_PAUSED',
  'WORKSPACE_ARCHIVED',
  'SENDER_DOMAIN_UNVERIFIED',
  'SENDER_DOMAIN_UNVERIFIED_IN_WORKSPACE',
  'SENDER_NOT_CONFIGURED',
  'SENDER_UNDER_REVIEW',
] as const;

export type SendBlockReason = (typeof SEND_BLOCK_REASONS)[number];

/**
 * Refusals caused by the SENDING side: the workspace's own configuration or
 * state. These are your bugs/setup to fix (alert on them), not facts about
 * the recipient. `SENDER_UNDER_REVIEW` clears once the organization is
 * approved as a sender: watch `plan.sendingReview` on `usage.get()`.
 */
export const SENDER_SIDE_BLOCK_REASONS = [
  'ORG_SENDING_PAUSED',
  'WORKSPACE_ARCHIVED',
  'SENDER_DOMAIN_UNVERIFIED',
  'SENDER_DOMAIN_UNVERIFIED_IN_WORKSPACE',
  'SENDER_NOT_CONFIGURED',
  'SENDER_UNDER_REVIEW',
] as const satisfies readonly SendBlockReason[];

/**
 * Refusals that are facts about the RECIPIENT (suppression, opt-out).
 * Never retry these; surface them.
 */
export const RECIPIENT_BLOCK_REASONS = [
  'HARD_SUPPRESSED',
  'CONSENT_SUPPRESSED',
  'CONTACT_HARD_BLOCKED',
  'CONTACT_UNSUBSCRIBED',
  'LIST_UNSUBSCRIBED',
] as const satisfies readonly SendBlockReason[];

/**
 * True when a suppressed send's `errorMessage` names a sender-side problem.
 * Unknown/future reasons return false (treated as recipient-side, the
 * never-retry direction) - update the SDK to pick up new groupings.
 */
export const isSenderSideBlock = (reason: string | null | undefined): boolean =>
  (SENDER_SIDE_BLOCK_REASONS as readonly string[]).includes(reason ?? '');

/**
 * Why a send is waiting instead of going out now. Carried in `holdReason`
 * when `status` is `queued`. Waiting is not failing: the send goes out by
 * itself, on the same record, once the cause clears. Stable,
 * machine-readable values.
 *
 * - `PLATFORM_DAILY_LIMIT`: the shared 24-hour sending quota reached its
 *   marketing line, or, for transactional mail, is spent.
 * - `ORGANIZATION_DAILY_SHARE`: the organization used its share of that
 *   quota.
 * - `EARNED_VOLUME`: marketing above the daily volume the organization has
 *   proven it sends cleanly.
 * - `WARMUP_SAMPLE`: a new sender's mail to never-mailed addresses goes out
 *   in checked slices, and this send waits for the next one.
 * - `WARMUP_SAMPLE_FAILED`: a slice crossed the bounce or complaint line, so
 *   new-address mail on that stream waits until a person at SendHeron has
 *   looked at it.
 */
export const SEND_HOLD_REASONS = [
  'PLATFORM_DAILY_LIMIT',
  'ORGANIZATION_DAILY_SHARE',
  'EARNED_VOLUME',
  'WARMUP_SAMPLE',
  'WARMUP_SAMPLE_FAILED',
] as const;

export type SendHoldReason = (typeof SEND_HOLD_REASONS)[number];

/**
 * The send record every send route returns and `emails.get()` reads back.
 *
 * Opens and clicks count people: `openCount`, `clickCount`, the first and
 * last opened and clicked timestamps, and the `opened` and `clicked`
 * statuses. Machines are counted beside them, never in them. Counts land 5
 * to 15 s after the open or click. Engagement recorded before the API began
 * separating machines from people (2026-10-15) was not reclassified, so it
 * still includes machines.
 */
export interface EmailSendRecord {
  id: string;
  to: string;
  /** The RESOLVED sender: not necessarily what you passed. */
  from: string | null;
  /**
   * The rendered subject. A templated send that was suppressed, or is still
   * held, records the template's subject unrendered.
   */
  subject: string;
  templateId?: string | null;
  campaignId?: string | null;
  sequenceStepId?: string | null;
  /** The provider's message id. Persist it: delivery events correlate on it. */
  providerMessageId?: string | null;
  provider?: string | null;
  stream?: SendStream | null;
  status: EmailSendStatus;
  /**
   * When `status` is `suppressed`: a SendBlockReason value.
   * When `failed`/`bounced`: diagnostics, usually the provider's. A send
   * with attachments that could not wait (503 `emailSending.sendHeld`)
   * records the SendHoldReason here.
   */
  errorMessage?: string | null;
  /**
   * Why the send is waiting (status `queued`): see SEND_HOLD_REASONS and
   * `isHeld`. It is tried again at `heldUntil`, goes out by itself on this
   * record, and is cleared when it does. Null or absent when nothing is
   * waiting.
   */
  holdReason?: SendHoldReason | null;
  /**
   * When a held send is next tried, ISO-8601. It can be held again then,
   * with a later `heldUntil`. Null or absent when nothing is waiting.
   */
  heldUntil?: string | null;
  /**
   * True when the send counted in a new sender's warm-up slice: the
   * organization had never mailed this address. A held send reads false
   * until it goes.
   */
  warmupFirstContact: boolean;
  organizationId: string;
  workspaceId: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  complainedAt?: string | null;
  firstOpenedAt?: string | null;
  lastOpenedAt?: string | null;
  /** Opens by people. */
  openCount: number;
  firstClickedAt?: string | null;
  lastClickedAt?: string | null;
  /** Clicks by people. */
  clickCount: number;
  /**
   * Opens by security scanners, link checkers and HEAD or prefetch
   * requests.
   */
  machineOpenCount: number;
  /**
   * Clicks by security scanners, link checkers and HEAD or prefetch
   * requests.
   */
  machineClickCount: number;
  /**
   * Pixel fetches by a mail privacy proxy (Apple Mail Privacy Protection):
   * maybe a reader, maybe nobody.
   */
  unconfirmedOpenCount: number;
  createdAt?: string;
}

/**
 * True when a send is held: status `queued` with a `holdReason`. It waits
 * for daily capacity or a new sender's warm-up and goes out by itself, on
 * the same record (`emails.get(id)` reads its outcome once it has gone).
 * Never retry it: a new idempotency key would send it twice, and the same
 * key replays the held response. Any `holdReason` counts, including one
 * this SDK version does not know yet: it is waiting all the same.
 */
export const isHeld = <
  T extends { status: string; holdReason?: string | null },
>(
  record: T,
): record is T & { status: 'queued'; holdReason: string } =>
  record.status === 'queued' && !!record.holdReason;

export type ScheduledEmailStatus =
  | 'SCHEDULED'
  | 'DISPATCHING'
  | 'SENT'
  | 'CANCELLED'
  | 'SUPPRESSED'
  | 'FAILED';

/**
 * Returned when a send carries `sendAt`, and by `emails.cancelScheduled()`.
 * Its `id` is for `emails.cancelScheduled()`, not for `emails.get()`.
 */
export interface ScheduledEmail {
  id: string;
  to: string;
  cc?: string[] | null;
  bcc?: string[] | null;
  from?: string | null;
  fromName?: string | null;
  replyTo?: string | null;
  /** Raw sends: the full subject. Templated: the optional override, or null. */
  subject?: string | null;
  /** Raw sends only; templated rows render at fire time. */
  html?: string | null;
  templateId?: string | null;
  contactId?: string | null;
  sendAt: string;
  status: ScheduledEmailStatus;
  /**
   * Set once it fires: the send record carrying the outcome. A send held
   * when it fires is `SCHEDULED` again at a later `sendAt`, and its record
   * reads `queued` with a `holdReason` meanwhile.
   */
  emailSendLogId?: string | null;
  errorMessage?: string | null;
  organizationId: string;
  workspaceId: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Pass-through attachment (SendGrid-compatible shape). Transactional sends
 * only; max 10 per message, 10 MB decoded total, allowlisted MIME types.
 * Bytes are never stored server-side and are excluded from the idempotency
 * fingerprint: a retried request with a regenerated file replays instead of
 * conflicting.
 */
export interface Attachment {
  /** Base64-encoded file content. */
  content: string;
  filename: string;
  /** MIME type, e.g. `application/pdf`. */
  type: string;
  /** Only `"attachment"` is supported. */
  disposition?: 'attachment';
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  html: string;
  /**
   * Defaults to the workspace's default sender identity. With no identity
   * configured, the send is suppressed with `SENDER_NOT_CONFIGURED`.
   */
  from?: string;
  /** Display-name override. Max 100 chars; no CR/LF or angle brackets. */
  fromName?: string;
  replyTo?: string;
  /** Max 50. Each copy is suppression-checked; blocked copies are dropped. */
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  /** Schedule for later. Not combinable with attachments. */
  sendAt?: Date | string;
  attachments?: Attachment[];
}

export interface SendTemplatePayload {
  to: string;
  templateId: string;
  /** Render variables. `contact.*` is auto-populated when contactId is set. */
  variables?: Record<string, unknown>;
  /**
   * Populates `contact.firstName`, `contact.lastName`, `contact.email` and
   * each custom property as `contact.<key>`. For a MARKETING template it
   * also decides whose unsubscribe link the mail carries; transactional
   * mail carries none.
   */
  contactId?: string;
  /** Subject override (same template syntax). */
  subject?: string;
  /**
   * Defaults to the workspace's default sender identity. With no identity
   * configured, the send is suppressed with `SENDER_NOT_CONFIGURED`.
   */
  from?: string;
  fromName?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  /** Schedule for later; rendering and every gate run at fire time. */
  sendAt?: Date | string;
  /** Requires a TRANSACTIONAL template. */
  attachments?: Attachment[];
}

export interface SendBulkPayload {
  templateId: string;
  /**
   * Defaults to the workspace's default sender identity. With no identity
   * configured, every send is suppressed with `SENDER_NOT_CONFIGURED`.
   */
  from?: string;
  /**
   * Template variables rendered into EVERY recipient's real mail, not
   * preview-only data. `contact.*` is set per recipient on top.
   */
  sampleData?: Record<string, unknown>;
  listId?: string;
  contactIds?: string[];
  /** Every subscribed contact in the API key's workspace. */
  sendToAll?: boolean;
}

export interface SendBulkResult {
  batchId: string | null;
  totalRecipients: number;
  queued: number;
  blocked: number;
}

export interface Template {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  document?: Record<string, unknown> | null;
  bodyMjml?: string | null;
  emailType: EmailType;
  variables?: string[] | null;
  organizationId: string;
  workspaceId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTemplatePayload {
  name: string;
  subject: string;
  /** Exactly one of bodyHtml / document. */
  bodyHtml?: string;
  document?: Record<string, unknown>;
  bodyMjml?: string;
  /** Required: the type decides suppression and unsubscribe behavior. */
  emailType: EmailType;
  tagIds?: string[];
}

export interface UpdateTemplatePayload {
  name?: string;
  subject?: string;
  bodyHtml?: string;
  /** Object: recompile from blocks. Explicit null: eject to raw HTML. */
  document?: Record<string, unknown> | null;
  bodyMjml?: string;
  emailType?: EmailType;
  /** Required whenever emailType actually changes. */
  confirmEmailTypeChange?: boolean;
  tagIds?: string[];
}

export interface PreviewTemplatePayload {
  /** Exactly one of bodyHtml / document. */
  bodyHtml?: string;
  document?: Record<string, unknown>;
  emailType?: EmailType;
  /**
   * Channel to preview through. `CAMPAIGN` and `BULK` are always marketing,
   * whatever the template says; `TRANSACTIONAL_API` and `CAMPAIGN_TEST` are
   * always transactional; `SEQUENCE` and `DIRECT` follow the template.
   */
  channel?: string;
  sampleData?: Record<string, unknown>;
}

export interface TemplatePreview {
  /** Composed exactly as a real send composes it. */
  renderedHtml: string;
  injectedUnsubscribeFooter: boolean;
  hasUnrecognizedUnsubscribeLink: boolean;
  appendedPromoBadge: boolean;
  /**
   * The template references {{unsubscribe_url}} but its policy never
   * supplies it: the link renders EMPTY in a real send.
   */
  unsubscribeVariableIgnored: boolean;
}

export type SuppressionTier = 'HARD' | 'CONSENT';

export interface SuppressionEntry {
  id: string;
  email: string;
  reason: string;
  source: string;
  workspaceId?: string | null;
  note?: string | null;
  createdAt?: string;
}

export interface ChannelDeliverability {
  allowed: boolean;
  blockReason: SendBlockReason | null;
}

/**
 * `suppressions.check()`: the recipient and organization verdict
 * (suppression tiers, contact status, sending pause). Sender configuration,
 * list opt-outs and an archived workspace are only evaluated on a real send.
 */
export interface EmailDeliverability {
  email: string;
  suppressed: boolean;
  tier: SuppressionTier | null;
  reason: string | null;
  source: string | null;
  suppressedAt: string | null;
  note: string | null;
  contactStatus: string | null;
  marketing: ChannelDeliverability;
  transactional: ChannelDeliverability;
}

export type PlanGateStatus = 'ACTIVE' | 'LAPSED' | 'UNLIMITED';

/**
 * Why the plan gates treat an organization as LAPSED. Four different things
 * to react to: subscribe, fix the card, or resubscribe. `TRIAL_EXPIRED` and
 * `NEVER_SUBSCRIBED` mean nothing was ever paid, so transactional sends get
 * no grace either: `monthlySends.pool` is 0 and every send is refused. A
 * customer who has paid before keeps the transactional grace through dunning.
 */
export type LapsedReason =
  | 'NEVER_SUBSCRIBED'
  | 'TRIAL_EXPIRED'
  | 'PAYMENT_FAILED'
  | 'CANCELED';

/**
 * Where the organization stands with its sender review. Until `APPROVED`,
 * mail reaches only its verified members (members who confirmed their email
 * address) and addresses on its own verified domains: every other send,
 * an unverified member included, is suppressed with `SENDER_UNDER_REVIEW`, on
 * every endpoint, transactional included. `SANDBOX`: no review requested
 * yet. `REQUESTED`: the organization owner asked for it and it is not
 * approved yet; same reach as `SANDBOX`. `APPROVED`: the sandbox is lifted.
 */
export type SendingReviewStatus = 'SANDBOX' | 'REQUESTED' | 'APPROVED';

/**
 * One plan cap's position. `remaining` never goes below 0, so `used` can
 * sit above `cap`, after a lapse for instance.
 */
export interface CountUsage {
  used: number;
  /** Null without an active subscription cap; 0 when LAPSED. */
  cap: number | null;
  /** How many more fit. Null without an active subscription cap. */
  remaining: number | null;
}

/**
 * The new-sender warm-up. `WARMING`: mail to addresses the organization has
 * never mailed goes out in checked slices. `HELD`: a slice crossed the
 * bounce or complaint line, and new-address mail on `heldStreams` waits for
 * a person at SendHeron. `COMPLETE`: warm-up is over. It only slows mail
 * once `plan.sendingReview` is `APPROVED`: before that, the review sandbox
 * decides who can be reached.
 */
export type WarmupStatus = 'WARMING' | 'HELD' | 'COMPLETE';

export interface WarmupUsage {
  status: WarmupStatus;
  /** When warm-up completed, ISO-8601. Null until it has. */
  completedAt: string | null;
  /** Never-mailed addresses each stream may have waiting for their check. */
  sampleSize: number;
  /** The streams whose new-address mail waits for a person (`HELD`). */
  heldStreams: SendStream[];
}

/**
 * The organization's place in the shared rolling 24-hour sending quota.
 * Counts are recipients (to, cc and bcc). Not a plan cap: mail over a line
 * waits as a held send (`isHeld`) and goes out by itself.
 */
export interface SendingCapacityUsage {
  /**
   * Recipients sent in the rolling 24 hours, both streams. Null when
   * unreadable.
   */
  last24Hours: number | null;
  /** The transactional part of `last24Hours`. Null when unreadable. */
  transactionalLast24Hours: number | null;
  /**
   * The most of the shared quota one organization may take. Null when the
   * quota is unlimited.
   */
  share: number | null;
  /**
   * The daily volume the organization has proven it sends cleanly:
   * marketing above it waits.
   */
  earnedVolume: number;
  /** Marketing recipients that still fit right now. Null when unreadable. */
  marketingRemaining: number | null;
  /**
   * The platform reached its daily marketing line: everyone's marketing
   * waits for the window.
   */
  platformMarketingHeld: boolean;
  /** Sends waiting now (status `queued` with a `holdReason`). */
  held: number;
  warmup: WarmupUsage;
}

export interface OrganizationUsage {
  plan: {
    status: PlanGateStatus;
    name: string | null;
    /**
     * When the running trial ends, ISO-8601. Null once the plan is paid, and
     * when there is no trial. The trial ceilings apply until this instant.
     */
    trialEndsAt: string | null;
    /** Why the plan is LAPSED. Null for every other status. */
    lapsedReason: LapsedReason | null;
    /**
     * The sender review. Never null. Until `APPROVED`, a send to anyone
     * outside your verified members and your own verified domains is
     * suppressed with `SENDER_UNDER_REVIEW`.
     */
    sendingReview: SendingReviewStatus;
  };
  monthlySends: {
    used: number;
    /** Null without an active subscription cap. */
    pool: number | null;
    marketingRemaining: number | null;
    transactionalCeiling: number | null;
    transactionalRemaining: number | null;
    resetsAt: string;
  };
  /** The contact cap, which counts SUBSCRIBED contacts only. */
  contacts: {
    subscribed: number;
    /** Null without an active subscription cap; 0 when LAPSED. */
    cap: number | null;
    /** How many more contacts fit. Null without an active subscription cap. */
    remaining: number | null;
  };
  /**
   * Sending domains, in any verification state, counted once however many
   * workspaces share one. A running trial can lower the cap.
   */
  domains: CountUsage;
  /**
   * Live workspaces: archived ones do not count. `cap` is the plan's, or a
   * per-organization override when one is set.
   */
  workspaces: CountUsage;
  /** Team members, pending invitations included: an invitation holds a seat. */
  teamMembers: CountUsage;
  /**
   * The rolling 24-hour position on the shared sending quota, and the
   * new-sender warm-up. Null when the position cannot be reported.
   */
  sending: SendingCapacityUsage | null;
  rateLimits: {
    perKeyPerMinute: number;
    organizationPerMinute: {
      READ: number;
      WRITE: number;
      SEND: number;
    };
  };
}

export interface PaginatedResult<T> {
  data: T[];
  totalCount?: number;
  pageInfo?: Record<string, unknown>;
}

export interface ListTemplatesParams {
  /** 0-based. */
  page?: number;
  limit?: number;
  term?: string;
  emailType?: EmailType;
}

export interface ListSuppressionsParams {
  /** 0-based. */
  page?: number;
  limit?: number;
  email?: string;
  reason?: string;
  tier?: SuppressionTier;
  source?: string;
}
