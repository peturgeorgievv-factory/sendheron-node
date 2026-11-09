import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type {
  BulkSendResponse,
  DeletedResponse,
  SendBulkEmailRequest,
  SendRecordResponse,
} from '../generated.js';
import type { SendEmailPayload, SendTemplatePayload } from '../types.js';

const serializeSendAt = (sendAt?: Date | string): string | undefined =>
  sendAt instanceof Date ? sendAt.toISOString() : sendAt;

/**
 * The send routes. A 201 is an OUTCOME, not proof of dispatch:
 *
 * - `data.status === 'SENT'`       → accepted by the provider; persist
 *                                    `data.id` and `data.providerMessageId`.
 *                                    `data.droppedRecipients` lists any copy
 *                                    the gate refused; it went without them.
 * - `data.status === 'SUPPRESSED'` → the compliance gate refused; the reason
 *                                    is in `data.errorMessage`. Never retry.
 * - `isHeld(data)`                 → `QUEUED` with a `holdReason`: waiting
 *                                    for daily capacity, a new sender's
 *                                    warm-up or an import's checked first
 *                                    sends. It goes out by itself on the
 *                                    same record (`get(data.id)`). Never
 *                                    retry.
 * - `data.status === 'SCHEDULED'`  → a send with `sendAt`, due at
 *                                    `data.scheduledAt`: `get(data.id)`
 *                                    follows it, `cancelScheduled(data.id)`
 *                                    cancels it until it fires.
 * - `error.statusCode === 503`     → the provider could not take it now,
 *                                    attempt recorded; or
 *                                    `emailSending.sendHeld`, a send with
 *                                    attachments that cannot wait. Retry
 *                                    with the same key after
 *                                    `error.retryAfterSeconds` (waited out
 *                                    here when it is 30 s or less).
 * - `error.statusCode === 422`     → `emailSending.providerRejected`: the
 *                                    provider refused the message itself.
 *                                    `error.description` says in
 *                                    SendHeron's words what was refused:
 *                                    the sender, a recipient address, a
 *                                    header, an attachment or the size.
 *                                    Final: never retry it.
 * - `error.statusCode === 409`     → `idempotency.requestInProgress`: the
 *                                    request with this key is still
 *                                    running, and its outcome is unknown.
 *                                    Retry later with
 *                                    `error.idempotencyKey`. The other 409
 *                                    (the key was reused with a different
 *                                    payload) is a bug: never retry it.
 * - `error.statusCode === 429`     → `tooManyRequests`; Retry-After was
 *                                    honored before the client gave up.
 */
export class Emails {
  constructor(private readonly client: HttpClient) {}

  send(
    payload: SendEmailPayload,
    options?: RequestOptions,
  ): Promise<Result<SendRecordResponse>> {
    return this.client.post(
      '/api/v1/emails/send',
      { ...payload, sendAt: serializeSendAt(payload.sendAt) },
      options,
    );
  }

  sendTemplate(
    payload: SendTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<SendRecordResponse>> {
    return this.client.post(
      '/api/v1/emails/send-template',
      { ...payload, sendAt: serializeSendAt(payload.sendAt) },
      options,
    );
  }

  /**
   * Queues one send per eligible recipient, paced per organization. Name
   * the audience once: `listId`, `contactIds` or `sendToAll` (more than one
   * is a 400 `emailSending.oneAudienceSelector`). `variables` render into
   * every recipient's mail, with `contact.*` set per recipient on top. A
   * recipient can wait for daily capacity or a new sender's warm-up: its
   * send record reads `QUEUED` with a `holdReason` until it goes out by
   * itself.
   */
  sendBulk(
    payload: SendBulkEmailRequest,
    options?: RequestOptions,
  ): Promise<Result<BulkSendResponse>> {
    return this.client.post('/api/v1/emails/send-bulk', payload, options);
  }

  /**
   * Read one send back by the id a send returned: including the delivery
   * lifecycle written later by provider events (deliveredAt, bounced,
   * complainedAt) and open and click counts by people, with machines and
   * privacy proxies counted beside them. A held send reads `QUEUED` with
   * `holdReason` and `heldUntil` until it goes, then its outcome. The id a
   * send with `sendAt` answered reads `SCHEDULED` while it waits
   * (`CANCELLED` after a cancel, `FAILED` when dispatch gave up); once it
   * has fired, it answers the send record it became, under that record's
   * own id. Works for recipients who are not contacts.
   */
  get(
    id: string,
    options?: RequestOptions,
  ): Promise<Result<SendRecordResponse>> {
    return this.client.get(
      `/api/v1/emails/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }

  /**
   * Cancel a scheduled send (raw or templated) before it fires: answers
   * `{ deleted: true }`, and the record reads `CANCELLED`. Once it is no
   * longer `SCHEDULED`, the API answers 400.
   */
  cancelScheduled(
    id: string,
    options?: RequestOptions,
  ): Promise<Result<DeletedResponse>> {
    return this.client.delete(
      `/api/v1/emails/scheduled/${encodeURIComponent(id)}`,
      options,
    );
  }
}
