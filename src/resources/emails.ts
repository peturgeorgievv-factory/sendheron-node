import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type {
  EmailSendRecord,
  ScheduledEmail,
  SendBulkPayload,
  SendBulkResult,
  SendEmailPayload,
  SendTemplatePayload,
} from '../types.js';

const serializeSendAt = (sendAt?: Date | string): string | undefined =>
  sendAt instanceof Date ? sendAt.toISOString() : sendAt;

type WithSendAt = { sendAt: Date | string };
type WithoutSendAt = { sendAt?: undefined };

/**
 * The send routes. A 201 is an OUTCOME, not proof of dispatch:
 *
 * - `data.status === 'sent'`       → accepted by the provider; persist
 *                                    `data.id` and `data.providerMessageId`.
 * - `data.status === 'suppressed'` → the compliance gate refused; the reason
 *                                    is in `data.errorMessage`. Never retry.
 * - `isHeld(data)`                 → `queued` with a `holdReason`: waiting
 *                                    for daily capacity or a new sender's
 *                                    warm-up. It goes out by itself on the
 *                                    same record (`get(data.id)`). Never
 *                                    retry.
 * - `error.statusCode === 503`     → provider failure, attempt recorded; or
 *                                    `emailSending.sendHeld`, a send with
 *                                    attachments that cannot wait. Safe to
 *                                    retry with the same key.
 * - `error.statusCode === 429`     → rate limited; Retry-After was honored
 *                                    before the client gave up.
 *
 * With `sendAt`, the result is the ScheduledEmail instead: its id is for
 * `cancelScheduled()`, not for `get()`.
 */
export class Emails {
  constructor(private readonly client: HttpClient) {}

  send(
    payload: SendEmailPayload & WithSendAt,
    options?: RequestOptions,
  ): Promise<Result<ScheduledEmail>>;
  send(
    payload: SendEmailPayload & WithoutSendAt,
    options?: RequestOptions,
  ): Promise<Result<EmailSendRecord>>;
  send(
    payload: SendEmailPayload,
    options?: RequestOptions,
  ): Promise<Result<EmailSendRecord | ScheduledEmail>>;
  send(
    payload: SendEmailPayload,
    options?: RequestOptions,
  ): Promise<Result<EmailSendRecord | ScheduledEmail>> {
    return this.client.post(
      '/api/v1/emails/send',
      {
        ...payload,
        sendAt: serializeSendAt(payload.sendAt),
      },
      options,
    );
  }

  sendTemplate(
    payload: SendTemplatePayload & WithSendAt,
    options?: RequestOptions,
  ): Promise<Result<ScheduledEmail>>;
  sendTemplate(
    payload: SendTemplatePayload & WithoutSendAt,
    options?: RequestOptions,
  ): Promise<Result<EmailSendRecord>>;
  sendTemplate(
    payload: SendTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<EmailSendRecord | ScheduledEmail>>;
  sendTemplate(
    payload: SendTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<EmailSendRecord | ScheduledEmail>> {
    return this.client.post(
      '/api/v1/emails/send-template',
      {
        ...payload,
        sendAt: serializeSendAt(payload.sendAt),
      },
      options,
    );
  }

  /**
   * Queues one send per eligible recipient, paced per organization. A
   * recipient can wait for daily capacity or a new sender's warm-up: its
   * send record reads `queued` with a `holdReason` until it goes out by
   * itself.
   */
  sendBulk(
    payload: SendBulkPayload,
    options?: RequestOptions,
  ): Promise<Result<SendBulkResult>> {
    return this.client.post('/api/v1/emails/send-bulk', payload, options);
  }

  /**
   * Read one send back by the id a send response returned: including the
   * delivery lifecycle written later by provider events (deliveredAt,
   * bounced, complainedAt) and open/click counts by people, with machines
   * and privacy proxies counted beside them. A held send reads `queued`
   * with `holdReason` and `heldUntil` here until it goes, then its outcome.
   * Works for recipients who are not contacts.
   */
  get(id: string, options?: RequestOptions): Promise<Result<EmailSendRecord>> {
    return this.client.get(
      `/api/v1/emails/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }

  /**
   * Cancel a scheduled send (raw or templated) before it fires. Once it is
   * no longer pending (dispatching, sent, cancelled, suppressed or failed),
   * the API answers 400.
   */
  cancelScheduled(
    id: string,
    options?: RequestOptions,
  ): Promise<Result<ScheduledEmail>> {
    return this.client.delete(
      `/api/v1/emails/scheduled/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }
}
