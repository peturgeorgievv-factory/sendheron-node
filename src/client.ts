import { randomUUID } from 'node:crypto';
import { type Result, SendHeronError } from './errors.js';
import { VERSION } from './version.js';

export interface ClientOptions {
  /** Defaults to https://api.sendheron.com */
  baseUrl?: string;
  /**
   * Retries AFTER the first attempt. 429 always retries (a rate-limited
   * request was never processed), waiting per Retry-After; 5xx and network
   * failures retry only when the request is retry-safe (a read, or an email
   * send carrying an idempotency key), with exponential backoff.
   * Default 2; 0 disables.
   */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 60000. */
  timeout?: number;
}

export interface RequestOptions {
  /**
   * Idempotency key for the email send routes. One is auto-generated when
   * absent and reused across the client's internal retries, so a timeout
   * cannot double-send. Supply your own to deduplicate across YOUR retries
   * too; after the client gives up, the key it used is on `error.idempotencyKey`.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Override the client-level maxRetries for this call. */
  maxRetries?: number;
}

interface InternalRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  options?: RequestOptions;
}

const DEFAULT_BASE_URL = 'https://api.sendheron.com';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const IDEMPOTENCY_HEADER = 'idempotency-key';
/** The server implements idempotency on these routes only. */
const IDEMPOTENT_PATH_PREFIX = '/api/v1/emails/';
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const IN_PROGRESS_CODE = 'idempotency.requestInProgress';
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 5_000;
/** A Retry-After beyond this is not worth burning an attempt on. */
const RETRY_AFTER_CAP_MS = 30_000;

/** Resolves early when the signal aborts; the caller re-checks the signal. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

const abortedError = () =>
  new SendHeronError({
    statusCode: null,
    code: 'aborted',
    message: 'The request was aborted by the caller.',
  });

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeout: number;

  constructor(apiKey: string | undefined, options: ClientOptions = {}) {
    const key =
      apiKey ??
      (typeof process !== 'undefined'
        ? process.env.SENDHERON_API_KEY
        : undefined);

    if (!key) {
      throw new Error(
        'Missing API key. Pass it to the constructor: `new SendHeron("ema_live_...")`, or set the SENDHERON_API_KEY environment variable.',
      );
    }

    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxRetries = Math.max(
      0,
      Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES),
    );
    this.timeout = Math.max(1, options.timeout ?? DEFAULT_TIMEOUT_MS);
  }

  async request<T>(req: InternalRequest): Promise<Result<T>> {
    const url = this.buildUrl(req.path, req.query);
    const callerSignal = req.options?.signal;
    const maxRetries = Math.max(
      0,
      Math.floor(req.options?.maxRetries ?? this.maxRetries),
    );

    // Minted ONCE, before the retry loop, so every internal attempt replays
    // the same logical request instead of sending a new email.
    const idempotencyKey =
      req.options?.idempotencyKey ??
      (req.method === 'POST' && req.path.startsWith(IDEMPOTENT_PATH_PREFIX)
        ? randomUUID()
        : undefined);

    // 5xx/network retries are safe for reads, and for writes the server can
    // deduplicate. A key on a route the server ignores it for must not arm
    // retries: that is how duplicate templates get created.
    const safeForReplay =
      req.method === 'GET' ||
      (idempotencyKey !== undefined &&
        req.path.startsWith(IDEMPOTENT_PATH_PREFIX));

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': `sendheron-node/${VERSION}`,
    };
    if (idempotencyKey) {
      headers[IDEMPOTENCY_HEADER] = idempotencyKey;
    }

    const fail = (error: SendHeronError): Result<T> => ({
      data: null,
      error: Object.assign(error, { idempotencyKey }),
    });

    let lastError = new SendHeronError({
      statusCode: null,
      code: 'network_error',
      message: 'The request was never attempted.',
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (callerSignal?.aborted) {
        return fail(abortedError());
      }

      const attemptController = new AbortController();
      const timer = setTimeout(() => attemptController.abort(), this.timeout);
      const onCallerAbort = () => attemptController.abort();
      callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

      let response: globalThis.Response | null = null;
      let bodyText: string | null = null;
      try {
        response = await fetch(url, {
          method: req.method,
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal: attemptController.signal,
        });
        // Read inside the same try: a connection dropped mid-body is a
        // network failure exactly like one dropped before the headers.
        bodyText = await response.text();
      } catch (cause) {
        if (callerSignal?.aborted) {
          return fail(abortedError());
        }

        lastError = new SendHeronError({
          statusCode: response?.status ?? null,
          code: attemptController.signal.aborted ? 'timeout' : 'network_error',
          message: this.describeTransportError(cause),
        });

        if (safeForReplay && attempt < maxRetries) {
          await sleep(this.backoff(attempt), callerSignal);
          continue;
        }
        return fail(lastError);
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', onCallerAbort);
      }

      if (response.ok) {
        if (!bodyText) {
          return { data: null as T, error: null };
        }
        try {
          return { data: JSON.parse(bodyText) as T, error: null };
        } catch {
          // A 2xx whose body is not our JSON (a proxy page, a truncation
          // that kept Content-Length honest) is a broken response, not a
          // crash in the consumer's process.
          return fail(
            new SendHeronError({
              statusCode: response.status,
              code: 'invalid_response',
              message: `HTTP ${response.status}: ${bodyText.slice(0, 200)}`,
            }),
          );
        }
      }

      const retryAfterSeconds = this.parseRetryAfter(response);
      const error = this.toError(response.status, bodyText, retryAfterSeconds);
      lastError = error;

      const retryDelayMs = this.retryDelayMs(
        response.status,
        error.code,
        retryAfterSeconds,
        safeForReplay,
        attempt,
        maxRetries,
      );

      if (retryDelayMs !== null) {
        await sleep(retryDelayMs, callerSignal);
        continue;
      }

      return fail(error);
    }

    return fail(lastError);
  }

  get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
    options?: RequestOptions,
  ): Promise<Result<T>> {
    return this.request<T>({ method: 'GET', path, query, options });
  }

  post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<Result<T>> {
    return this.request<T>({ method: 'POST', path, body, options });
  }

  patch<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<Result<T>> {
    return this.request<T>({ method: 'PATCH', path, body, options });
  }

  delete<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<Result<T>> {
    return this.request<T>({ method: 'DELETE', path, body, options });
  }

  /**
   * Null = do not retry. Policy:
   * - 429 retries on EVERY method (a rate-limited request was never
   *   processed), honoring Retry-After: unless waiting would exceed the
   *   cap, where burning an attempt that will certainly 429 again helps
   *   nobody.
   * - 409 "request in progress" retries only replay-safe requests: the
   *   concurrent original completes and a later attempt lands on the
   *   server's replay branch. The OTHER 409 (key reused with a different
   *   payload) is a caller bug and never retries.
   * - 5xx retries only replay-safe requests.
   */
  private retryDelayMs(
    status: number,
    code: string,
    retryAfterSeconds: number | undefined,
    safeForReplay: boolean,
    attempt: number,
    maxRetries: number,
  ): number | null {
    if (attempt >= maxRetries) {
      return null;
    }

    if (status === 429) {
      const wait =
        retryAfterSeconds !== undefined
          ? retryAfterSeconds * 1000
          : this.backoff(attempt);
      return wait <= RETRY_AFTER_CAP_MS ? wait : null;
    }

    if (status === 409 && code === IN_PROGRESS_CODE && safeForReplay) {
      return this.backoff(attempt);
    }

    if (RETRYABLE_STATUSES.has(status) && safeForReplay) {
      return this.backoff(attempt);
    }

    return null;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(this.baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }
    return url.toString();
  }

  private backoff(attempt: number): number {
    const exponential = BACKOFF_BASE_MS * 2 ** attempt;
    return Math.min(exponential, BACKOFF_CAP_MS) + Math.random() * 100;
  }

  /** Handles both Retry-After forms: delta-seconds and an HTTP date. */
  private parseRetryAfter(response: globalThis.Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (!header) {
      return undefined;
    }

    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return seconds >= 0 ? seconds : undefined;
    }

    const date = Date.parse(header);
    if (Number.isNaN(date)) {
      return undefined;
    }
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }

  /** undici buries the useful part (ECONNREFUSED, DNS, TLS) in error.cause. */
  private describeTransportError(cause: unknown): string {
    if (cause instanceof Error) {
      const inner = cause.cause as
        | { code?: string; message?: string }
        | undefined;
      return inner?.code ?? inner?.message ?? cause.message;
    }
    return 'Network request failed';
  }

  private toError(
    status: number,
    bodyText: string | null,
    retryAfterSeconds: number | undefined,
  ): SendHeronError {
    try {
      const body = JSON.parse(bodyText ?? '') as {
        message?: string;
        error?: string;
        description?: string;
      };
      // The API's 429 body carries a human sentence, not a stable key -
      // normalize it so `code` stays machine-readable across statuses.
      const code =
        status === 429 ? 'rate_limited' : (body.message ?? 'unknown_error');
      return new SendHeronError({
        statusCode: status,
        code,
        message: body.message ?? `HTTP ${status}`,
        description: body.description ?? body.error,
        retryAfterSeconds,
      });
    } catch {
      return new SendHeronError({
        statusCode: status,
        code: 'invalid_response',
        message: `HTTP ${status}: ${(bodyText ?? '').slice(0, 200)}`,
        retryAfterSeconds,
      });
    }
  }
}
