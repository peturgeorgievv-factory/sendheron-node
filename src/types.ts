/**
 * What the SDK adds to the generated contract (generated.ts): names for the
 * enums the API document declares inline, the lists and helpers integrators
 * branch on, and the send payloads that take a Date. Every request and
 * response shape comes from the document; tests hold these lists to it.
 */
import type {
  DroppedRecipientResponse,
  PlanPositionResponse,
  Routes,
  SendEmailRequest,
  SendRecordResponse,
  SendTemplateEmailRequest,
  SuppressionCheckResponse,
  SuppressionEntryResponse,
  TemplateResponse,
  WarmupUsageResponse,
} from './generated.js';

/** A template's declared type. Decides suppression and unsubscribe behavior. */
export type EmailType = TemplateResponse['emailType'];

/** The reputation stream a message goes out on. */
export type SendStream = NonNullable<SendRecordResponse['stream']>;

/**
 * The send path behind a record: `TRANSACTIONAL_API` for `emails.send()`,
 * `DIRECT` for `emails.sendTemplate()`, `BULK` for the recipients of
 * `emails.sendBulk()`.
 */
export type SendChannel = NonNullable<SendRecordResponse['channel']>;

/**
 * Lifecycle of one send. `SUPPRESSED` is an OUTCOME, not an error: the
 * compliance gate refused the send and recorded why, so never retry it.
 * `QUEUED` with a `holdReason` is a held send (`isHeld`): it waits for daily
 * capacity, a new sender's warm-up or an import's checked first sends, and
 * goes out by itself, so never retry it either. `SCHEDULED` is a send with
 * `sendAt` that has not fired, and `CANCELLED` one cancelled before it did.
 * `OPENED` and `CLICKED` mean a person opened or clicked. A send that only
 * machines touched (security scanners, link checkers, a privacy proxy
 * fetching the pixel) reads `DELIVERED`: their events still prove delivery.
 */
export type EmailSendStatus = SendRecordResponse['status'];

/**
 * Why a send was refused. Carried in `errorMessage` when `status` is
 * `SUPPRESSED`, in a dropped copy's `reason`, and in a check's
 * `blockReason`. Stable, machine-readable values.
 */
export const SEND_BLOCK_REASONS = [
  'HARD_SUPPRESSED',
  'CONSENT_SUPPRESSED',
  'CONTACT_HARD_BLOCKED',
  'ADDRESS_UNDELIVERABLE',
  'CONTACT_UNSUBSCRIBED',
  'LIST_UNSUBSCRIBED',
  'ORG_SENDING_PAUSED',
  'WORKSPACE_ARCHIVED',
  'SENDER_DOMAIN_UNVERIFIED',
  'SENDER_DOMAIN_UNVERIFIED_IN_WORKSPACE',
  'SENDER_NOT_CONFIGURED',
  'SENDER_UNDER_REVIEW',
] as const satisfies readonly SendBlockReason[];

export type SendBlockReason = DroppedRecipientResponse['reason'];

/**
 * Refusals caused by the SENDING side: the workspace's own configuration or
 * state. These are your bugs or setup to fix (alert on them), not facts
 * about the recipient. `SENDER_UNDER_REVIEW` clears once the organization is
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
 * Refusals that are facts about the RECIPIENT (suppression, opt-out, an
 * address that cannot receive email). Never retry these; surface them.
 * `ADDRESS_UNDELIVERABLE`: the address is on the platform-wide list of
 * addresses that hard-bounced as nonexistent, or the contact's screening
 * found it undeliverable. It blocks every stream, transactional included:
 * drop the address.
 */
export const RECIPIENT_BLOCK_REASONS = [
  'HARD_SUPPRESSED',
  'CONSENT_SUPPRESSED',
  'CONTACT_HARD_BLOCKED',
  'ADDRESS_UNDELIVERABLE',
  'CONTACT_UNSUBSCRIBED',
  'LIST_UNSUBSCRIBED',
] as const satisfies readonly SendBlockReason[];

/**
 * True when a suppressed send's `errorMessage` names a sender-side problem.
 * Unknown or future reasons return false (treated as recipient-side, the
 * never-retry direction): update the SDK to pick up new groupings.
 */
export const isSenderSideBlock = (reason: string | null | undefined): boolean =>
  (SENDER_SIDE_BLOCK_REASONS as readonly string[]).includes(reason ?? '');

/**
 * Why a send is waiting instead of going out now. Carried in `holdReason`
 * when `status` is `QUEUED`. Waiting is not failing: the send goes out by
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
 * - `IMPORT_SAMPLE`: the first email to a contact from an import whose
 *   people were last mailed over a year ago goes out in checked slices of
 *   that import, and this send waits for the next one. It applies once
 *   warm-up is over; a warming sender's slices cover those contacts.
 * - `IMPORT_SAMPLE_FAILED`: a slice of that import bounced or drew
 *   complaints past the line, so the rest of it waits until a person at
 *   SendHeron has looked at it.
 */
export const SEND_HOLD_REASONS = [
  'PLATFORM_DAILY_LIMIT',
  'ORGANIZATION_DAILY_SHARE',
  'EARNED_VOLUME',
  'WARMUP_SAMPLE',
  'WARMUP_SAMPLE_FAILED',
  'IMPORT_SAMPLE',
  'IMPORT_SAMPLE_FAILED',
] as const satisfies readonly SendHoldReason[];

export type SendHoldReason = NonNullable<SendRecordResponse['holdReason']>;

/**
 * True when a send is held: status `QUEUED` with a `holdReason`. It waits
 * for daily capacity, a new sender's warm-up or an import's checked first
 * sends, and goes out by itself, on the same record (`emails.get(id)` reads
 * its outcome once it has gone). Never retry it: a new idempotency key
 * would send it twice, and the same key replays the held response. Any
 * `holdReason` counts, including one this SDK version does not know yet:
 * it is waiting all the same.
 */
export const isHeld = <
  T extends { status: string; holdReason?: string | null },
>(
  record: T,
): record is T & { status: 'QUEUED'; holdReason: string } =>
  record.status === 'QUEUED' && !!record.holdReason;

/**
 * Why an address is suppressed. `BOUNCE` and `COMPLAINT` are recorded by the
 * platform from provider events; `MANUAL` and `ADMIN` are set by hand, and
 * `ONE_CLICK` by the recipient.
 */
export type SuppressionReason = SuppressionEntryResponse['reason'];

/**
 * `HARD` (a bounce or complaint) blocks every stream, transactional
 * included, in every workspace of the account. `CONSENT` blocks marketing
 * only, in its own workspace.
 */
export type SuppressionTier = SuppressionEntryResponse['tier'];

/** What recorded a suppression. */
export type SuppressionSource = NonNullable<SuppressionEntryResponse['source']>;

/** A contact's status. Anything but `SUBSCRIBED` also gates sending. */
export type ContactStatus = NonNullable<
  SuppressionCheckResponse['contactStatus']
>;

/**
 * What address screening concluded about a contact, when it was created,
 * imported or its address changed. Only `UNDELIVERABLE` stops mail
 * (`ADDRESS_UNDELIVERABLE`, every stream), and one that rests on DNS alone
 * (`DOMAIN_NOT_FOUND`, `NO_MAIL_SERVER`) only for a day after the check, as
 * a new domain may still be setting up its mail. `RISKY` (a throwaway
 * domain, a likely typo, a role or system mailbox) and `UNCHECKED` (DNS did
 * not answer in time) stay mailable.
 */
export type ScreeningVerdict = NonNullable<
  SuppressionCheckResponse['screeningVerdict']
>;

/**
 * One fact screening found about an address. A verdict can carry several,
 * listed most serious first, in this order. Stable, machine-readable values.
 *
 * - `INVALID_SYNTAX`: not an email address.
 * - `KNOWN_HARD_BOUNCE`: it hard-bounced as nonexistent before, in any
 *   organization on the platform.
 * - `DOMAIN_NOT_FOUND`: the domain does not exist.
 * - `NO_MAIL_SERVER`: the domain accepts no mail.
 * - `DISPOSABLE_DOMAIN`: a throwaway mailbox service.
 * - `LIKELY_TYPO`: one slip away from a big mailbox provider;
 *   `suggestedEmail` has the fix.
 * - `ROLE_ADDRESS`: a mailbox for a function (`info@`, `sales@`), not a
 *   person.
 * - `SYSTEM_ADDRESS`: a mailbox nobody subscribes from (`abuse@`,
 *   `postmaster@`, `noreply@`).
 * - `DNS_UNCHECKED`: DNS did not answer in time, so the mail server is
 *   unknown.
 *
 * The first four make the verdict `UNDELIVERABLE`, the next four `RISKY`,
 * and `DNS_UNCHECKED` without any of them `UNCHECKED`.
 */
export const SCREENING_REASONS = [
  'INVALID_SYNTAX',
  'KNOWN_HARD_BOUNCE',
  'DOMAIN_NOT_FOUND',
  'NO_MAIL_SERVER',
  'DISPOSABLE_DOMAIN',
  'LIKELY_TYPO',
  'ROLE_ADDRESS',
  'SYSTEM_ADDRESS',
  'DNS_UNCHECKED',
] as const satisfies readonly ScreeningReason[];

export type ScreeningReason =
  SuppressionCheckResponse['screeningReasons'][number];

/**
 * Whether the plan gates apply: `ACTIVE` (the plan caps apply), `LAPSED`
 * (no live subscription: growth is refused, transactional mail is bounded
 * by a small grace) or `UNLIMITED`.
 */
export type PlanGateStatus = PlanPositionResponse['status'];

/**
 * Why the plan gates treat an organization as LAPSED. Four different things
 * to react to: subscribe, fix the card, or resubscribe. `TRIAL_EXPIRED` and
 * `NEVER_SUBSCRIBED` mean nothing was ever paid, so transactional sends get
 * no grace either: `monthlySends.pool` is 0 and every send is refused. A
 * customer who has paid before keeps the transactional grace through dunning.
 */
export type LapsedReason = NonNullable<PlanPositionResponse['lapsedReason']>;

/**
 * Where the organization stands with its sender review. Until `APPROVED`,
 * mail reaches only its verified members (members who confirmed their email
 * address) and addresses on its own verified domains: every other send, an
 * unverified member included, is suppressed with `SENDER_UNDER_REVIEW`, on
 * every endpoint, transactional included. `SANDBOX`: no review requested
 * yet. `REQUESTED`: the organization owner asked for it and it is not
 * approved yet; same reach as `SANDBOX`. `APPROVED`: the sandbox is lifted.
 */
export type SendingReviewStatus = PlanPositionResponse['sendingReview'];

/**
 * The new-sender warm-up. `WARMING`: mail to addresses the organization has
 * never mailed goes out in checked slices. `HELD`: a slice crossed the
 * bounce or complaint line, and new-address mail on `heldStreams` waits for
 * a person at SendHeron. `COMPLETE`: warm-up is over. It only slows mail
 * once `plan.sendingReview` is `APPROVED`: before that, the review sandbox
 * decides who can be reached.
 */
export type WarmupStatus = WarmupUsageResponse['status'];

/**
 * `emails.send()`'s payload: the API's, with `sendAt` also taking a Date.
 */
export type SendEmailPayload = Omit<SendEmailRequest, 'sendAt'> & {
  /**
   * Schedule the send: a Date, or an ISO-8601 string. The answer is the send
   * record with status `SCHEDULED` and `scheduledAt`; `emails.get(id)` reads
   * it, and `emails.cancelScheduled(id)` cancels it until it fires. Not
   * combinable with attachments.
   */
  sendAt?: Date | string;
};

/**
 * `emails.sendTemplate()`'s payload: the API's, with `sendAt` also taking a
 * Date.
 */
export type SendTemplatePayload = Omit<SendTemplateEmailRequest, 'sendAt'> & {
  /**
   * Schedule the send: a Date, or an ISO-8601 string. Rendering and every
   * gate run when it fires. The answer is the send record with status
   * `SCHEDULED` and `scheduledAt`; `emails.cancelScheduled(id)` cancels it
   * until then.
   */
  sendAt?: Date | string;
};

/** `templates.list()`'s filters and page. `page` is zero-based. */
export type ListTemplatesParams = Routes['GET /api/v1/templates']['query'];

/** `suppressions.list()`'s filters and page. `page` is zero-based. */
export type ListSuppressionsParams =
  Routes['GET /api/v1/suppressions']['query'];
