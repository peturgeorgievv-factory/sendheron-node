import { HttpClient, type ClientOptions } from './client.js';
import { Emails } from './resources/emails.js';
import { Templates } from './resources/templates.js';
import { Suppressions } from './resources/suppressions.js';
import { Usage } from './resources/usage.js';

export type { ClientOptions, RequestOptions } from './client.js';
export { SendHeronError, type Result } from './errors.js';
export * from './types.js';
export { VERSION } from './version.js';

/**
 * The SendHeron API client.
 *
 * ```ts
 * import { SendHeron } from 'sendheron';
 *
 * const sendheron = new SendHeron(process.env.SENDHERON_API_KEY);
 *
 * const { data, error } = await sendheron.emails.sendTemplate({
 *   to: 'user@example.com',
 *   templateId: '...',
 *   variables: { orderId: '42' },
 * });
 *
 * if (error) throw error;                      // 4xx/5xx after retries
 * if (data.status === 'suppressed') {
 *   // refused by the compliance gate: data.errorMessage says why. Never retry.
 * }
 * ```
 *
 * Defaults that differ from most SDKs, on purpose:
 * - retries are ON (2), honoring Retry-After on 429 and backing off on
 *   5xx/network failures;
 * - email sends get an idempotency key automatically, reused across internal
 *   retries: a timeout can never double-send;
 * - API failures are returned as `{ data: null, error }`, never thrown.
 */
export class SendHeron {
  readonly emails: Emails;
  readonly templates: Templates;
  readonly suppressions: Suppressions;
  readonly usage: Usage;

  constructor(apiKey?: string, options?: ClientOptions) {
    const client = new HttpClient(apiKey, options);
    this.emails = new Emails(client);
    this.templates = new Templates(client);
    this.suppressions = new Suppressions(client);
    this.usage = new Usage(client);
  }
}

export default SendHeron;
