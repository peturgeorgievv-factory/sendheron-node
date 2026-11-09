import { randomUUID } from 'node:crypto';
import { IN_PROGRESS_CODE, type Result, SendHeronError } from './errors.js';
import { VERSION } from './version.js';

export interface ClientOptions {
  /** Defaults to https://api.sendheron.com */
  baseUrl?: string;
  /**
   * Retries AFTER the first attempt. 429 always retries (a rate-limited
   * request was never processed), waiting per Retry-After; 5xx and network
   * failures retry only when the request is retry-safe (a read, or an email
   * send carrying an idempotency key), with exponential backoff, except
   * that a 503 waits per its Retry-After too. A Retry-After over 30 seconds
   * is never slept: the error returns at once with `retryAfterSeconds`, for
   * a queue to reschedule. Default 2; 0 disables.
   */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 60000. */
  timeout?: number;
}

export interface RequestOptions {
  /**
   * Idempotency key for the three send routes (`emails.send`,
   * `emails.sendTemplate`, `emails.sendBulk`), the only ones the API
   * deduplicates; anywhere else it is not sent. One is auto-generated when
   * absent and reused across the client's internal retries, so a timeout
   * cannot double-send. Supply your own to deduplicate across YOUR retries
   * too; after the client gives up, the key it used is on
   * `error.idempotencyKey`. Keys are scoped to the API key's workspace and
   * the endpoint, and expire after 24 hours.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Override the client-level maxRetries for this call. */
  maxRetries?: number;
}

type QueryValue = string | number | boolean | readonly string[] | undefined;

interface InternalRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  options?: RequestOptions;
}

const DEFAULT_BASE_URL = 'https://api.sendheron.com';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const IDEMPOTENCY_HEADER = 'idempotency-key';
/** The routes the API deduplicates by idempotency key: the three sends. */
const IDEMPOTENT_SEND_PATHS = new Set([
  '/api/v1/emails/send',
  '/api/v1/emails/send-template',
  '/api/v1/emails/send-bulk',
]);
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 5_000;
/** A Retry-After beyond this goes back to the caller instead of being slept. */
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
    kind: 'transport',
    statusCode: null,
    code: 'aborted',
    message: 'The request was aborted by the caller.',
  });

const invalidResponse = (
  status: number,
  detail: string,
  retryAfterSeconds?: number,
) =>
  new SendHeronError({
    kind: 'transport',
    statusCode: status,
    code: 'invalid_response',
    message: `HTTP ${status}: ${detail}`,
    retryAfterSeconds,
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
    // the same logical request instead of sending a new email. Only the
    // three sends carry one: the API serves every other route fresh, so a
    // key there would promise a replay that never happens.
    const isSend = req.method === 'POST' && IDEMPOTENT_SEND_PATHS.has(req.path);
    const idempotencyKey = isSend
      ? (req.options?.idempotencyKey ?? randomUUID())
      : undefined;

    // 5xx/network retries are safe for reads, and for the sends the server
    // deduplicates. No other write is replayed: that is how duplicate
    // templates get created.
    const safeForReplay = req.method === 'GET' || isSend;

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
      kind: 'transport',
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
          kind: 'transport',
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
        // Every route answers a JSON body, so an empty one is a broken
        // answer, never `data`: typing it as T would hand callers a null
        // they were promised could not happen.
        if (!bodyText) {
          return fail(invalidResponse(response.status, 'empty body'));
        }
        try {
          return { data: JSON.parse(bodyText) as T, error: null };
        } catch {
          // A 2xx whose body is not our JSON (a proxy page, a truncation
          // that kept Content-Length honest) is a broken response, not a
          // crash in the consumer's process.
          return fail(invalidResponse(response.status, bodyText.slice(0, 200)));
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
    query?: Record<string, QueryValue>,
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

  /** No route takes a body on DELETE. */
  delete<T>(path: string, options?: RequestOptions): Promise<Result<T>> {
    return this.request<T>({ method: 'DELETE', path, options });
  }

  /**
   * Null = do not retry. Policy:
   * - 429 retries on EVERY method (a rate-limited request was never
   *   processed), honoring Retry-After.
   * - 409 "request in progress" retries only replay-safe requests: the
   *   concurrent original completes and a later attempt lands on the
   *   server's replay branch. The OTHER 409 (key reused with a different
   *   payload) is a caller bug and never retries.
   * - 5xx retries only replay-safe requests. A 503 honors Retry-After: the
   *   API sends it on every send 503, the time until the provider may take
   *   the send again or a hold lifts.
   * - Everything else never retries, the 422 for a message the provider
   *   refused for good included: it would fail the same way.
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
      return this.retryAfterDelayMs(retryAfterSeconds, attempt);
    }

    if (status === 409 && code === IN_PROGRESS_CODE && safeForReplay) {
      return this.backoff(attempt);
    }

    if (RETRYABLE_STATUSES.has(status) && safeForReplay) {
      return status === 503
        ? this.retryAfterDelayMs(retryAfterSeconds, attempt)
        : this.backoff(attempt);
    }

    return null;
  }

  /**
   * The wait the server asked for (backoff when it named none), or null
   * when it exceeds the cap: an attempt that would certainly be refused
   * again helps nobody, and a queue reschedules a long wait better than a
   * process sleeping through it.
   */
  private retryAfterDelayMs(
    retryAfterSeconds: number | undefined,
    attempt: number,
  ): number | null {
    const wait =
      retryAfterSeconds !== undefined
        ? retryAfterSeconds * 1000
        : this.backoff(attempt);
    return wait <= RETRY_AFTER_CAP_MS ? wait : null;
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(this.baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) {
        // A list filter (`tagIds`) is the parameter repeated.
        for (const item of value) {
          url.searchParams.append(name, item);
        }
      } else if (value !== undefined) {
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

  /**
   * Every API refusal, a 429 included, is `{ statusCode, message, error,
   * description? }`: `message` is the stable key, `error` only the HTTP
   * status name, `description` the sentence when there is one. A body
   * without a key is not the API's answer (an edge or proxy page), so it is
   * a transport failure, never an API code.
   */
  private toError(
    status: number,
    bodyText: string | null,
    retryAfterSeconds: number | undefined,
  ): SendHeronError {
    let body: { message?: unknown; description?: unknown } | null = null;
    try {
      body = JSON.parse(bodyText ?? '');
    } catch {}

    if (typeof body?.message !== 'string' || body.message === '') {
      return invalidResponse(
        status,
        (bodyText ?? '').slice(0, 200),
        retryAfterSeconds,
      );
    }

    return new SendHeronError({
      kind: 'api',
      statusCode: status,
      code: body.message,
      message: body.message,
      description:
        typeof body.description === 'string' ? body.description : undefined,
      retryAfterSeconds,
    });
  }
}
