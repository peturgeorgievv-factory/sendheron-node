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
 * - `error.statusCode === 503`     → provider failure, attempt recorded;
 *                                    safe to retry with the same key.
 * - `error.statusCode === 429`     → rate limited; Retry-After was honored
 *                                    before the client gave up.
 *
 * With `sendAt`, the result is the ScheduledEmail instead.
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

  sendBulk(
    payload: SendBulkPayload,
    options?: RequestOptions,
  ): Promise<Result<SendBulkResult>> {
    return this.client.post('/api/v1/emails/send-bulk', payload, options);
  }

  /**
   * Read one send back by the id a send response returned: including the
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
