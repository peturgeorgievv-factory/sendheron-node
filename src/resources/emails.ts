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

/**
 * A send WITHOUT `sendAt` resolves to the send record; WITH it, to the
 * scheduled email — so the common case needs no narrowing. Callers building
 * payloads dynamically (sendAt maybe-undefined) get the union and narrow on
 * `'status' in data` values.
 */
type SendResult<P> = P extends { sendAt: Date | string }
  ? ScheduledEmail
  : EmailSendRecord;

/**
 * The send routes. Every send resolves to a Result whose 201 body is an
 * OUTCOME, not proof of dispatch:
 *
 * - `data.status === 'sent'`       → accepted by the provider; persist
 *                                    `data.id` and `data.providerMessageId`.
 * - `data.status === 'suppressed'` → the compliance gate refused; the reason
 *                                    is in `data.errorMessage`. Never retry.
 * - `error.statusCode === 503`     → provider failure, attempt recorded;
 *                                    retry with the same idempotency key
 *                                    (the client already did, per maxRetries).
 * - `error.statusCode === 429`     → rate limited; the client honored
 *                                    Retry-After before giving up.
 *
 * With `sendAt`, the result is a ScheduledEmail instead.
 */
export class Emails {
  constructor(private readonly client: HttpClient) {}

  send<P extends SendEmailPayload>(
    payload: P,
    options?: RequestOptions,
  ): Promise<Result<SendResult<P>>> {
    return this.client.post<SendResult<P>>('/api/v1/emails/send', {
      ...payload,
      sendAt: serializeSendAt(payload.sendAt),
    }, options);
  }

  sendTemplate<P extends SendTemplatePayload>(
    payload: P,
    options?: RequestOptions,
  ): Promise<Result<SendResult<P>>> {
    return this.client.post<SendResult<P>>('/api/v1/emails/send-template', {
      ...payload,
      sendAt: serializeSendAt(payload.sendAt),
    }, options);
  }

  sendBulk(
    payload: SendBulkPayload,
    options?: RequestOptions,
  ): Promise<Result<SendBulkResult>> {
    return this.client.post('/api/v1/emails/send-bulk', payload, options);
  }

  /**
   * Read one send back by the id a send response returned — including the
   * delivery lifecycle written later by provider events (deliveredAt,
   * bounced, complainedAt) and open/click counts. Works for recipients who
   * are not contacts.
   */
  get(id: string, options?: RequestOptions): Promise<Result<EmailSendRecord>> {
    return this.client.get(
      `/api/v1/emails/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }

  /** Cancel a scheduled send (raw or templated) before it fires. */
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
