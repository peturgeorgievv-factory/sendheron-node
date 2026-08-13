import { randomUUID } from 'node:crypto';
import { SendHeronError, type Result } from './errors.js';
import { VERSION } from './version.js';

export interface ClientOptions {
  /** Defaults to https://api.sendheron.com */
  baseUrl?: string;
  /**
   * Retries AFTER the first attempt, for retry-safe requests only (GETs, and
   * any request carrying an idempotency key). 429 waits per Retry-After;
   * 5xx/network failures back off exponentially. Default 2; 0 disables.
   */
  maxRetries?: number;
}

export interface RequestOptions {
  /**
   * Business-level idempotency key. On the email send routes one is
   * AUTO-GENERATED when absent, and the same key is reused across the
   * client's internal retries — a timeout can never double-send. Provide
   * your own to deduplicate across your own retries too.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
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
const IDEMPOTENCY_HEADER = 'idempotency-key';
/** The routes whose idempotency layer we auto-arm. */
const AUTO_IDEMPOTENCY_PREFIX = '/api/v1/emails/';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 5_000;
/** Never sleep longer than this on a Retry-After, however large. */
const RETRY_AFTER_CAP_MS = 30_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;

  constructor(apiKey: string | undefined, options: ClientOptions = {}) {
    const key =
      apiKey ??
      (typeof process !== 'undefined'
        ? process.env.SENDHERON_API_KEY
        : undefined);

    if (!key) {
      // A missing credential is a programming error, so it throws — unlike
      // API failures, which come back as { data, error } values.
      throw new Error(
        'Missing API key. Pass it to the constructor: `new SendHeron("ema_live_...")`, or set the SENDHERON_API_KEY environment variable.',
      );
    }

    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async request<T>(req: InternalRequest): Promise<Result<T>> {
    const url = this.buildUrl(req.path, req.query);

    // Auto-idempotency: minted ONCE, before the retry loop, so every internal
    // attempt replays the same request instead of sending a new email.
    const idempotencyKey =
      req.options?.idempotencyKey ??
      (req.method === 'POST' && req.path.startsWith(AUTO_IDEMPOTENCY_PREFIX)
        ? randomUUID()
        : undefined);

    // Only requests the server can safely see twice are retried: reads, and
    // writes that carry an idempotency key. Everything else fails fast.
    const retryable = req.method === 'GET' || idempotencyKey !== undefined;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': `sendheron-node/${VERSION}`,
    };
    if (idempotencyKey) {
      headers[IDEMPOTENCY_HEADER] = idempotencyKey;
    }

    let lastError: SendHeronError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: globalThis.Response;
      try {
        response = await fetch(url, {
          method: req.method,
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal: req.options?.signal,
        });
      } catch (cause) {
        if (req.options?.signal?.aborted) {
          return {
            data: null,
            error: new SendHeronError({
              statusCode: null,
              code: 'aborted',
              message: 'The request was aborted by the caller.',
            }),
          };
        }

        lastError = new SendHeronError({
          statusCode: null,
          code: 'network_error',
          message:
            cause instanceof Error ? cause.message : 'Network request failed',
        });

        if (retryable && attempt < this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        return { data: null, error: lastError };
      }

      if (response.ok) {
        return { data: await this.parseBody<T>(response), error: null };
      }

      const retryAfterSeconds = this.parseRetryAfter(response);
      const error = await this.toError(response, retryAfterSeconds);
      lastError = error;

      if (
        RETRYABLE_STATUSES.has(response.status) &&
        retryable &&
        attempt < this.maxRetries
      ) {
        const wait =
          retryAfterSeconds !== undefined
            ? Math.min(retryAfterSeconds * 1000, RETRY_AFTER_CAP_MS)
            : this.backoff(attempt);
        await sleep(wait);
        continue;
      }

      return { data: null, error };
    }

    // Unreachable in practice (the loop always returns), kept for the types.
    return {
      data: null,
      error:
        lastError ??
        new SendHeronError({ statusCode: null, code: 'network_error' }),
    };
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

  private parseRetryAfter(response: globalThis.Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (!header) {
      return undefined;
    }
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }

  private async parseBody<T>(response: globalThis.Response): Promise<T> {
    const text = await response.text();
    if (!text) {
      return null as T;
    }
    return JSON.parse(text) as T;
  }

  private async toError(
    response: globalThis.Response,
    retryAfterSeconds: number | undefined,
  ): Promise<SendHeronError> {
    const text = await response.text();

    try {
      const body = JSON.parse(text) as {
        message?: string;
        error?: string;
        description?: string;
      };
      return new SendHeronError({
        statusCode: response.status,
        code: body.message ?? 'unknown_error',
        message: body.message ?? `HTTP ${response.status}`,
        description: body.description ?? body.error,
        retryAfterSeconds,
      });
    } catch {
      // Not our API's JSON (an edge/proxy page, most likely).
      return new SendHeronError({
        statusCode: response.status,
        code: 'invalid_response',
        message: `HTTP ${response.status}: ${text.slice(0, 200)}`,
        retryAfterSeconds,
      });
    }
  }
}
