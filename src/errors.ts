/**
 * The 409 the API answers while another request with the same idempotency
 * key is still being processed.
 */
export const IN_PROGRESS_CODE = 'idempotency.requestInProgress';

/**
 * The codes of a failure that brought no usable answer from the API
 * (`kind: 'transport'`): no response in time (`timeout`), none at all
 * (`network_error`), your `signal` (`aborted`), or an answer that was not
 * the API's (`invalid_response`: an edge or proxy page, an empty or cut-off
 * body).
 */
export const TRANSPORT_ERROR_CODES = [
  'network_error',
  'timeout',
  'aborted',
  'invalid_response',
] as const;

export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[number];

/**
 * One API failure, as a value.
 *
 * The client never throws on API responses: every call resolves to
 * `{ data, error }` and this is the `error` half. The only thing that throws
 * is construction with no API key, which is a programming error, not a
 * runtime outcome.
 */
export class SendHeronError extends Error {
  /**
   * `api`: the API answered with a refusal, and `code` is its stable key.
   * `transport`: no usable answer arrived, and `code` is a
   * `TransportErrorCode`. The two never share a code.
   */
  readonly kind: 'api' | 'transport';
  /** HTTP status, or null when the request never got a response. */
  readonly statusCode: number | null;
  /**
   * Machine-readable code. With `kind: 'api'`, the API's stable key, such as
   * `emailSending.sendFailed`, `apiKeys.insufficientScopes` or
   * `tooManyRequests`. With `kind: 'transport'`, one of
   * `TRANSPORT_ERROR_CODES`.
   */
  readonly code: string;
  /**
   * The API's sentence about this refusal, when it gave one. Never the
   * HTTP status name.
   */
  readonly description?: string;
  /**
   * Seconds to wait before trying again, from Retry-After. On a 429, until
   * the rate-limit window resets. On a 503, until the provider may take the
   * send again, or until a hold lifts (`emailSending.sendHeld`), which can
   * be hours.
   */
  readonly retryAfterSeconds?: number;
  /**
   * The idempotency key the failed send carried (including an
   * auto-generated one). Reuse it to resume the SAME logical send after the
   * client has exhausted its retries: a fresh key could double-send. Only
   * the three send routes carry one.
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
    /** Derived from `code` when left out. */
    kind?: 'api' | 'transport';
    statusCode: number | null;
    code: string;
    message?: string;
    description?: string;
    retryAfterSeconds?: number;
  }) {
    super(options.message ?? options.code);
    this.name = 'SendHeronError';
    this.kind =
      options.kind ??
      ((TRANSPORT_ERROR_CODES as readonly string[]).includes(options.code)
        ? 'transport'
        : 'api');
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.description = options.description;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type Result<T> =
  | { data: T; error: null }
  | { data: null; error: SendHeronError };
