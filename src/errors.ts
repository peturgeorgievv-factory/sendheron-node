/**
 * The 409 the API answers while another request with the same idempotency
 * key is still being processed.
 */
export const IN_PROGRESS_CODE = 'idempotency.requestInProgress';

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
  /**
   * Seconds to wait before trying again, from Retry-After. On a 429, until
   * the rate-limit window resets. On a 503, until the provider may take the
   * send again, or until a hold lifts (`emailSending.sendHeld`), which can
   * be hours.
   */
  readonly retryAfterSeconds?: number;
  /**
   * The idempotency key the failed request carried (including an
   * auto-generated one). Reuse it to resume the SAME logical send after the
   * client has exhausted its retries: a fresh key could double-send.
   */
  idempotencyKey?: string;

  /**
   * Whether retrying the SAME request (same idempotency key) later is
   * sensible. Rate limits, 5xx, timeouts, network failures and a 409
   * `idempotency.requestInProgress` (the request with this key is still
   * running, and its outcome is not known yet) are. Other 4xx request bugs,
   * a 422 `emailSending.providerRejected` (the provider refused the message
   * itself) and caller aborts are not. Job runners should fail permanently
   * when this is false instead of burning attempts. When it is true, retry
   * with `idempotencyKey`, after `retryAfterSeconds` if that is set.
   */
  get retryable(): boolean {
    if (this.code === 'aborted') {
      return false;
    }
    if (this.statusCode === 409) {
      return this.code === IN_PROGRESS_CODE;
    }
    return (
      this.statusCode === null ||
      this.statusCode === 429 ||
      this.statusCode >= 500
    );
  }

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
