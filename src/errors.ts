/**
 * One API failure, as a value.
 *
 * The client never throws on API responses: every call resolves to
 * `{ data, error }` and this is the `error` half. The only thing that throws
 * is construction with no API key, which is a programming error, not a
 * runtime outcome.
 */
export class SendHeronError extends Error {
  /** HTTP status, or null when the request never got a response. */
  readonly statusCode: number | null;
  /**
   * Machine-readable code: the API's stable translation key
   * (e.g. `emailSending.sendFailed`, `apiKeys.insufficientScopes`), or
   * `network_error` / `invalid_response` for transport-level failures.
   */
  readonly code: string;
  /** Human-oriented detail when the API provided one. */
  readonly description?: string;
  /** Seconds until the rate-limit window resets, from Retry-After. */
  readonly retryAfterSeconds?: number;
  /**
   * The idempotency key the failed request carried (including an
   * auto-generated one). Reuse it to resume the SAME logical send after the
   * client has exhausted its retries: a fresh key could double-send.
   */
  idempotencyKey?: string;

  constructor(options: {
    statusCode: number | null;
    code: string;
    message?: string;
    description?: string;
    retryAfterSeconds?: number;
  }) {
    super(options.message ?? options.code);
    this.name = 'SendHeronError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.description = options.description;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type Result<T> =
  | { data: T; error: null }
  | { data: null; error: SendHeronError };
