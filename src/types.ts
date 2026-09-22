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
] as const;

export type SendBlockReason = (typeof SEND_BLOCK_REASONS)[number];

/**
 * Refusals caused by the SENDING side: the workspace's own configuration or
 * state. These are your bugs/setup to fix (alert on them), not facts about
 * the recipient.
 */
export const SENDER_SIDE_BLOCK_REASONS = [
  'ORG_SENDING_PAUSED',
  'WORKSPACE_ARCHIVED',
  'SENDER_DOMAIN_UNVERIFIED',
  'SENDER_DOMAIN_UNVERIFIED_IN_WORKSPACE',
  'SENDER_NOT_CONFIGURED',
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

/** The send record every send route returns and `emails.get()` reads back. */
export interface EmailSendRecord {
  id: string;
  to: string;
  /** The RESOLVED sender: not necessarily what you passed. */
  from: string | null;
  /** The rendered subject. */
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
   * When `failed`/`bounced`: provider diagnostics.
   */
  errorMessage?: string | null;
  organizationId: string;
  workspaceId: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  complainedAt?: string | null;
  firstOpenedAt?: string | null;
  lastOpenedAt?: string | null;
  openCount: number;
  firstClickedAt?: string | null;
  lastClickedAt?: string | null;
  clickCount: number;
  createdAt?: string;
}

export type ScheduledEmailStatus =
  | 'SCHEDULED'
  | 'DISPATCHING'
  | 'SENT'
  | 'CANCELLED'
  | 'SUPPRESSED'
  | 'FAILED';

/** Returned when a send carries `sendAt`: and by `emails.cancelScheduled()`. */
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
  /** Set once dispatched: the send record carrying the outcome. */
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
  contactId?: string;
  /** Subject override (same template syntax). */
  subject?: string;
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
  from?: string;
  sampleData?: Record<string, unknown>;
  listId?: string;
  contactIds?: string[];
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

/** `suppressions.check()`: the same gate function the send paths run. */
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
