import { afterEach, describe, expect, it } from 'vitest';
import {
  type CountUsageResponse,
  type DroppedRecipientResponse,
  type FormSignupAcceptedResponse,
  isHeld,
  isSenderSideBlock,
  type ScreeningReason,
  type ScreeningVerdict,
  type SendBlockReason,
  SendHeron,
  SendHeronError,
  type SendHoldReason,
  type SendingCapacityUsageResponse,
  type SendRecordResponse,
  type SignupFormsUsageResponse,
  type SuppressionCheckResponse,
  type TemplateResponse,
  type WarmupStatus,
  type WarmupUsageResponse,
} from '../src/index.js';
import { type MockServer, startMockServer } from './mock-server.js';

const KEY = 'ema_live_test_key';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A send the provider accepted, as every send route and `emails.get()`
 * answer it: every field present, null when empty.
 */
const sentRecord: SendRecordResponse = {
  id: 'log-1',
  workspaceId: 'ws-1',
  to: 'user@example.com',
  from: 'billing@customer.com',
  subject: 'Receipt',
  status: 'SENT',
  stream: 'TRANSACTIONAL',
  channel: 'TRANSACTIONAL_API',
  errorMessage: null,
  droppedRecipients: null,
  holdReason: null,
  heldUntil: null,
  providerMessageId: 'ses-123',
  templateId: null,
  campaignId: null,
  sequenceStepId: null,
  batchId: null,
  scheduledAt: null,
  sentAt: '2026-11-09T10:00:00.000Z',
  deliveredAt: null,
  complainedAt: null,
  openCount: 0,
  clickCount: 0,
  machineOpenCount: 0,
  machineClickCount: 0,
  unconfirmedOpenCount: 0,
  firstOpenedAt: null,
  lastOpenedAt: null,
  firstClickedAt: null,
  lastClickedAt: null,
  createdAt: '2026-11-09T10:00:00.000Z',
};

/** The send record with some fields changed, typed: only what the API answers. */
const record = (fields: Partial<SendRecordResponse>): SendRecordResponse => ({
  ...sentRecord,
  ...fields,
});

/** A send that has not gone: no provider id, no sent time. */
const notSent = { providerMessageId: null, sentAt: null } as const;

/** Every refusal, a 429 included: the key, the status name, the sentence. */
const tooManyRequests = {
  statusCode: 429,
  message: 'tooManyRequests',
  error: 'TOO_MANY_REQUESTS',
  description: 'Rate limit exceeded. Try again later.',
};

/** The suppressions.check() answer for an address nothing refuses. */
const deliverable: SuppressionCheckResponse = {
  email: 'jane@example.com',
  suppressed: false,
  tier: null,
  reason: null,
  source: null,
  suppressedAt: null,
  note: null,
  contactStatus: null,
  screeningVerdict: null,
  screeningReasons: [],
  suggestedEmail: null,
  knownHardBounce: false,
  marketing: { allowed: true, blockReason: null },
  transactional: { allowed: true, blockReason: null },
};

/** A new organization's daily position: inside every line, warming up. */
const sendingPosition: SendingCapacityUsageResponse = {
  last24Hours: 120,
  transactionalLast24Hours: 80,
  share: 20_000,
  earnedVolume: 1_000,
  marketingRemaining: 880,
  platformMarketingHeld: false,
  held: 0,
  warmup: {
    status: 'WARMING',
    completedAt: null,
    sampleSize: 100,
    heldStreams: [],
  },
};

/** A saved template, as every template route answers it. */
const savedTemplate: TemplateResponse = {
  id: 't-1',
  workspaceId: 'ws-1',
  name: 'Welcome',
  subject: 'Welcome, {{contact.firstName}}',
  previewText: 'Your first steps, and where to find help',
  bodyHtml: '<p>Hi {{contact.firstName}}</p>',
  document: null,
  bodyMjml: null,
  emailType: 'TRANSACTIONAL',
  variables: ['contact.firstName'],
  tags: [{ id: 'tag-1', name: 'onboarding', color: null }],
  createdAt: '2026-10-18T16:00:00.000Z',
  updatedAt: '2026-10-18T16:00:00.000Z',
};

/** A block document, for the validate route. */
const blockDocument = {
  version: 1,
  settings: { contentWidth: 600, backgroundColor: '#f4f4f5' },
  blocks: [{ id: 'b1', type: 'heading', text: 'Hello', level: 1 }],
};

let server: MockServer;

afterEach(async () => {
  await server?.close();
});

const build = (maxRetries = 2) =>
  new SendHeron(KEY, { baseUrl: server.url, maxRetries });

describe('authentication', () => {
  it('sends the bearer key and a versioned user agent', async () => {
    server = await startMockServer([{ status: 201, body: sentRecord }]);

    await build().emails.send({ to: 'a@b.co', subject: 's', html: '<p>x</p>' });

    const request = server.requests[0]!;
    expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request.headers['user-agent']).toMatch(/^sendheron-node\/\d/);
  });

  it('falls back to SENDHERON_API_KEY and throws without any key', async () => {
    server = await startMockServer([{ status: 201, body: sentRecord }]);

    process.env.SENDHERON_API_KEY = 'ema_live_from_env';
    try {
      const sdk = new SendHeron(undefined, { baseUrl: server.url });
      await sdk.usage.get();
      expect(server.requests[0]!.headers.authorization).toBe(
        'Bearer ema_live_from_env',
      );
    } finally {
      delete process.env.SENDHERON_API_KEY;
    }

    expect(() => new SendHeron(undefined)).toThrow(/Missing API key/);
  });
});

describe('send outcomes', () => {
  it('returns a typed sent record', async () => {
    server = await startMockServer([{ status: 201, body: sentRecord }]);

    const { data, error } = await build().emails.send({
      to: 'user@example.com',
      subject: 'Receipt',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: 'SENT',
      providerMessageId: 'ses-123',
    });
  });

  it('names the copies the gate dropped, and reads null back when none was', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: record({
          droppedRecipients: [
            { email: 'old@example.com', reason: 'HARD_SUPPRESSED' },
            { email: 'outsider@example.org', reason: 'SENDER_UNDER_REVIEW' },
          ],
        }),
      },
      { status: 200, body: sentRecord },
    ]);
    const sdk = build();

    const { data, error } = await sdk.emails.send({
      to: 'user@example.com',
      subject: 'Receipt',
      html: '<p>x</p>',
      cc: ['old@example.com', 'accounts@example.com'],
      bcc: ['outsider@example.org'],
    });

    expect(error).toBeNull();
    // The message still went, to everyone else.
    expect(data!.status).toBe('SENT');
    const dropped: DroppedRecipientResponse[] = data!.droppedRecipients!;
    const reasons: SendBlockReason[] = dropped.map((copy) => copy.reason);
    expect(dropped.map((copy) => copy.email)).toEqual([
      'old@example.com',
      'outsider@example.org',
    ]);
    // A fact about that address, versus the organization's own setup.
    expect(reasons.map(isSenderSideBlock)).toEqual([false, true]);

    const { data: none } = await sdk.emails.get('log-1');
    expect(none!.droppedRecipients).toBeNull();
  });

  it('passes a suppressed 201 through as DATA, not an error', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: record({
          ...notSent,
          status: 'SUPPRESSED',
          errorMessage: 'HARD_SUPPRESSED',
        }),
      },
    ]);

    const { data, error } = await build().emails.send({
      to: 'bounced@example.com',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: 'SUPPRESSED',
      errorMessage: 'HARD_SUPPRESSED',
    });
    // One request: a suppression is an outcome and must never be retried.
    expect(server.requests).toHaveLength(1);
  });

  it('passes a held 201 through as DATA, never retried', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: record({
          ...notSent,
          status: 'QUEUED',
          holdReason: 'PLATFORM_DAILY_LIMIT',
          heldUntil: '2026-10-16T11:10:00.000Z',
        }),
      },
    ]);

    const { data, error } = await build().emails.send({
      to: 'user@example.com',
      subject: 'Receipt',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(isHeld(data!)).toBe(true);
    expect(data).toMatchObject({
      status: 'QUEUED',
      holdReason: 'PLATFORM_DAILY_LIMIT',
      heldUntil: '2026-10-16T11:10:00.000Z',
    });
    // One request: a held send goes out by itself. Retrying with a new key
    // would send it twice.
    expect(server.requests).toHaveLength(1);
  });

  it('reads a held send back on the same record until it goes out', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: record({
          ...notSent,
          status: 'QUEUED',
          holdReason: 'WARMUP_SAMPLE',
          heldUntil: '2026-10-16T11:40:00.000Z',
        }),
      },
      { status: 200, body: sentRecord },
    ]);
    const sdk = build();

    const waiting = await sdk.emails.get('log-1');
    expect(isHeld(waiting.data!)).toBe(true);

    const gone = await sdk.emails.get('log-1');
    expect(isHeld(gone.data!)).toBe(false);
    expect(gone.data).toMatchObject({
      id: 'log-1',
      status: 'SENT',
      holdReason: null,
      heldUntil: null,
    });
  });

  it('passes an ADDRESS_UNDELIVERABLE refusal through as DATA, recipient-side', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: record({
          ...notSent,
          to: 'gone@example.com',
          status: 'SUPPRESSED',
          errorMessage: 'ADDRESS_UNDELIVERABLE',
        }),
      },
    ]);

    const { data, error } = await build().emails.send({
      to: 'gone@example.com',
      subject: 'Receipt',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: 'SUPPRESSED',
      errorMessage: 'ADDRESS_UNDELIVERABLE',
    });
    // The address cannot receive email, transactional included: drop it.
    expect(isSenderSideBlock(data!.errorMessage)).toBe(false);
    expect(server.requests).toHaveLength(1);
  });

  it('passes an import slice hold through as DATA', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: record({
          ...notSent,
          channel: 'DIRECT',
          status: 'QUEUED',
          holdReason: 'IMPORT_SAMPLE',
          heldUntil: '2026-10-19T09:40:00.000Z',
        }),
      },
    ]);

    const { data, error } = await build().emails.sendTemplate({
      to: 'user@example.com',
      templateId: 't-1',
      contactId: 'contact-1',
    });

    expect(error).toBeNull();
    expect(isHeld(data!)).toBe(true);
    expect(data).toMatchObject({
      status: 'QUEUED',
      holdReason: 'IMPORT_SAMPLE',
    });
    // One request: it goes out by itself with the import's next slice.
    expect(server.requests).toHaveLength(1);
  });

  it('reads an import held past its line back as held', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: record({
          ...notSent,
          status: 'QUEUED',
          holdReason: 'IMPORT_SAMPLE_FAILED',
          heldUntil: '2026-10-19T10:10:00.000Z',
        }),
      },
    ]);

    const { data } = await build().emails.get('log-1');

    // A slice of the import bounced or drew complaints past the line: the
    // rest of it waits for a person at SendHeron, still never retried.
    expect(isHeld(data!)).toBe(true);
    const reason: SendHoldReason | null = data!.holdReason;
    expect(reason).toBe('IMPORT_SAMPLE_FAILED');
  });

  it('surfaces API errors as typed values, never throws', async () => {
    server = await startMockServer([
      {
        status: 400,
        body: {
          statusCode: 400,
          message: 'emailSending.attachmentsRequireTransactional',
          error: 'BAD_REQUEST',
        },
      },
    ]);

    const { data, error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(SendHeronError);
    expect(error!.kind).toBe('api');
    expect(error!.statusCode).toBe(400);
    expect(error!.code).toBe('emailSending.attachmentsRequireTransactional');
  });

  it('reports a non-JSON body (an edge page) as invalid_response', async () => {
    server = await startMockServer([
      {
        status: 403,
        headers: { 'content-type': 'text/html' },
        rawBody: 'error code: 1010',
      },
    ]);

    const { error } = await build(0).emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error!.statusCode).toBe(403);
    expect(error!.kind).toBe('transport');
    expect(error!.code).toBe('invalid_response');
    expect(error!.message).toContain('error code: 1010');
  });
});

describe('idempotency', () => {
  it('auto-generates an idempotency key for email sends', async () => {
    server = await startMockServer([{ status: 201, body: sentRecord }]);

    await build().emails.send({ to: 'a@b.co', subject: 's', html: '<p>x</p>' });

    expect(server.requests[0]!.headers['idempotency-key']).toMatch(
      UUID_PATTERN,
    );
  });

  it('a caller-supplied key wins over the generated one', async () => {
    server = await startMockServer([{ status: 201, body: sentRecord }]);

    await build().emails.sendTemplate(
      { to: 'a@b.co', templateId: 't-1' },
      { idempotencyKey: 'receipt-42' },
    );

    expect(server.requests[0]!.headers['idempotency-key']).toBe('receipt-42');
  });

  it('does NOT auto-arm idempotency outside the email routes', async () => {
    server = await startMockServer([{ status: 201, body: savedTemplate }]);

    await build().templates.create({
      name: 'n',
      subject: 's',
      bodyHtml: '<p>x</p>',
      emailType: 'TRANSACTIONAL',
    });

    expect(server.requests[0]!.headers['idempotency-key']).toBeUndefined();
  });

  it('sends a key on the three sends only, never one the API would not honor', async () => {
    // The API deduplicates the three send routes and serves every other
    // route fresh, so a key anywhere else would promise a replay that never
    // happens.
    server = await startMockServer([
      { status: 201, body: savedTemplate },
      { status: 200, body: sentRecord },
      { status: 200, body: { deleted: true } },
    ]);
    const sdk = build();
    const options = { idempotencyKey: 'not-a-send' };

    await sdk.templates.create(
      { name: 'n', subject: 's', bodyHtml: '<p>x</p>', emailType: 'MARKETING' },
      options,
    );
    await sdk.emails.get('log-1', options);
    const { data } = await sdk.emails.cancelScheduled('log-1', options);

    expect(data).toEqual({ deleted: true });
    for (const request of server.requests) {
      expect(request.headers['idempotency-key']).toBeUndefined();
    }
  });
});

describe('retries', () => {
  it('retries a 503 with the SAME idempotency key, then succeeds', async () => {
    server = await startMockServer([
      {
        status: 503,
        body: { statusCode: 503, message: 'emailSending.sendFailed' },
      },
      { status: 201, body: sentRecord },
    ]);

    const { data, error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data!.status).toBe('SENT');
    expect(server.requests).toHaveLength(2);
    // The whole point: both attempts replay ONE logical request.
    expect(server.requests[0]!.headers['idempotency-key']).toBe(
      server.requests[1]!.headers['idempotency-key'],
    );
  });

  it('retries a 503 sendHeld with the SAME key and exposes it for resume', async () => {
    // Attachments are never stored, so a send carrying them cannot wait:
    // the API answers 503 instead, retryable like a provider failure.
    server = await startMockServer([
      {
        status: 503,
        body: { statusCode: 503, message: 'emailSending.sendHeld' },
      },
    ]);

    const { error } = await build(1).emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
      attachments: [
        { content: 'JVBERi0=', filename: 'r.pdf', type: 'application/pdf' },
      ],
    });

    expect(server.requests).toHaveLength(2);
    const key = server.requests[0]!.headers['idempotency-key'];
    expect(server.requests[1]!.headers['idempotency-key']).toBe(key);
    expect(error!.statusCode).toBe(503);
    expect(error!.code).toBe('emailSending.sendHeld');
    expect(error!.retryable).toBe(true);
    // Resume the SAME logical send later: a fresh key could double-send.
    expect(error!.idempotencyKey).toBe(key);
  });

  it('honors Retry-After on 429', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '0' },
        body: tooManyRequests,
      },
      { status: 201, body: sentRecord },
    ]);

    const { data } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(data!.status).toBe('SENT');
    expect(server.requests).toHaveLength(2);
  });

  it('exposes retryAfterSeconds once retries are exhausted', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '17' },
        body: tooManyRequests,
      },
    ]);

    const { error } = await build(0).emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error!.statusCode).toBe(429);
    expect(error!.retryAfterSeconds).toBe(17);
  });

  it('recovers from a destroyed socket on a retry-safe request', async () => {
    server = await startMockServer([
      { destroy: true },
      { status: 201, body: sentRecord },
    ]);

    const { data, error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data!.status).toBe('SENT');
  });

  it('never retries a write without an idempotency key', async () => {
    server = await startMockServer([
      { status: 503, body: { statusCode: 503, message: 'oops' } },
      { status: 201, body: savedTemplate },
    ]);

    const { error } = await build().templates.create({
      name: 'n',
      subject: 's',
      bodyHtml: '<p>x</p>',
      emailType: 'TRANSACTIONAL',
    });

    expect(error!.statusCode).toBe(503);
    expect(server.requests).toHaveLength(1);
  });

  it('retries GETs on 5xx', async () => {
    server = await startMockServer([
      { status: 502, body: { statusCode: 502, message: 'bad gateway' } },
      { status: 200, body: sentRecord },
    ]);

    const { data } = await build().emails.get('log-1');

    expect(data!.id).toBe('log-1');
    expect(server.requests).toHaveLength(2);
  });

  it('maxRetries: 0 disables retries entirely', async () => {
    server = await startMockServer([
      { status: 503, body: { statusCode: 503, message: 'down' } },
      { status: 201, body: sentRecord },
    ]);

    const { error } = await build(0).emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error!.statusCode).toBe(503);
    expect(server.requests).toHaveLength(1);
  });

  it('waits out a 503 Retry-After within the cap, then retries with the SAME key', async () => {
    server = await startMockServer([
      {
        status: 503,
        headers: { 'retry-after': '1' },
        body: { statusCode: 503, message: 'emailSending.sendFailed' },
      },
      { status: 201, body: sentRecord },
    ]);

    const startedAt = Date.now();
    const { data, error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data!.status).toBe('SENT');
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]!.headers['idempotency-key']).toBe(
      server.requests[0]!.headers['idempotency-key'],
    );
    // The server's second, not the first backoff step (400 to 500 ms).
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(950);
  });

  it('hands a 503 back at once when its Retry-After exceeds the cap, for a queue', async () => {
    // 300 s: the provider account cannot send. Sleeping in-process would
    // hold the caller for minutes; a queue reschedules it instead.
    server = await startMockServer([
      {
        status: 503,
        headers: { 'retry-after': '300' },
        body: { statusCode: 503, message: 'emailSending.sendFailed' },
      },
      { status: 201, body: sentRecord },
    ]);

    const { error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(server.requests).toHaveLength(1);
    expect(error!.statusCode).toBe(503);
    expect(error!.code).toBe('emailSending.sendFailed');
    expect(error!.retryAfterSeconds).toBe(300);
    expect(error!.retryable).toBe(true);
    expect(error!.idempotencyKey).toBe(
      server.requests[0]!.headers['idempotency-key'],
    );
  });

  it('hands a send held for hours back at once, with when the hold lifts', async () => {
    // Each retry of a held send with attachments records another failed
    // attempt, and the hold will not have lifted a second later.
    server = await startMockServer([
      {
        status: 503,
        headers: { 'retry-after': '7200' },
        body: { statusCode: 503, message: 'emailSending.sendHeld' },
      },
      { status: 201, body: sentRecord },
    ]);

    const { error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
      attachments: [
        { content: 'JVBERi0=', filename: 'r.pdf', type: 'application/pdf' },
      ],
    });

    expect(server.requests).toHaveLength(1);
    expect(error!.code).toBe('emailSending.sendHeld');
    expect(error!.retryAfterSeconds).toBe(7200);
    expect(error!.retryable).toBe(true);
    expect(error!.idempotencyKey).toBe(
      server.requests[0]!.headers['idempotency-key'],
    );
  });

  it('reads Retry-After off a 503 it may not retry', async () => {
    server = await startMockServer([
      {
        status: 503,
        headers: { 'retry-after': '5' },
        body: { statusCode: 503, message: 'serviceUnavailable' },
      },
      { status: 201, body: savedTemplate },
    ]);

    const { error } = await build().templates.create({
      name: 'n',
      subject: 's',
      bodyHtml: '<p>x</p>',
      emailType: 'TRANSACTIONAL',
    });

    // Not replay-safe, so not retried even though the wait is short.
    expect(server.requests).toHaveLength(1);
    expect(error!.retryAfterSeconds).toBe(5);
  });

  it('never retries a 422 providerRejected: the provider refused the message for good', async () => {
    server = await startMockServer([
      {
        status: 422,
        body: {
          statusCode: 422,
          message: 'emailSending.providerRejected',
          error: 'UNPROCESSABLE_ENTITY',
          // SendHeron's sentence for what was refused, never SES's wording.
          description: 'A header in the message was refused.',
        },
      },
      { status: 201, body: sentRecord },
    ]);

    const { data, error } = await build().emails.sendTemplate({
      to: 'a@b.co',
      templateId: 't-1',
    });

    expect(data).toBeNull();
    expect(server.requests).toHaveLength(1);
    expect(error!.statusCode).toBe(422);
    expect(error!.code).toBe('emailSending.providerRejected');
    expect(error!.description).toBe('A header in the message was refused.');
    expect(error!.retryable).toBe(false);
  });
});

describe('edge cases', () => {
  it('an aborted signal surfaces as a typed aborted error, no retries', async () => {
    server = await startMockServer([{ status: 201, body: sentRecord }]);
    const controller = new AbortController();
    controller.abort();

    const { error } = await build().emails.send(
      { to: 'a@b.co', subject: 's', html: '<p>x</p>' },
      { signal: controller.signal },
    );

    expect(error!.code).toBe('aborted');
    expect(server.requests).toHaveLength(0);
  });

  it('normalizes a trailing slash on baseUrl', async () => {
    server = await startMockServer([{ status: 200, body: sentRecord }]);
    const sdk = new SendHeron(KEY, { baseUrl: `${server.url}/` });

    await sdk.emails.get('log-1');

    expect(server.requests[0]!.url).toBe('/api/v1/emails/log-1');
  });

  it('does not retry a 409: an idempotency conflict is a fact, not a blip', async () => {
    server = await startMockServer([
      {
        status: 409,
        body: {
          statusCode: 409,
          message: 'idempotency.keyReusedWithDifferentPayload',
        },
      },
      { status: 201, body: sentRecord },
    ]);

    const { error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error!.statusCode).toBe(409);
    expect(error!.code).toBe('idempotency.keyReusedWithDifferentPayload');
    expect(error!.retryable).toBe(false);
    expect(server.requests).toHaveLength(1);
  });

  it('uses PATCH for template updates', async () => {
    server = await startMockServer([{ status: 200, body: savedTemplate }]);
    const sdk = build();

    await sdk.templates.update('t-1', {
      emailType: 'MARKETING',
      confirmEmailTypeChange: true,
    });

    expect(server.requests[0]!.method).toBe('PATCH');
    expect(server.requests[0]!.url).toBe('/api/v1/templates/t-1');
  });

  it('deletes take no body and answer { deleted: true }', async () => {
    server = await startMockServer([{ status: 200, body: { deleted: true } }]);
    const sdk = build();

    const results = [
      await sdk.templates.remove('t-1'),
      await sdk.suppressions.remove('a+b@c.co'),
      await sdk.emails.cancelScheduled('sched-1'),
    ];

    expect(results.map((result) => result.data)).toEqual([
      { deleted: true },
      { deleted: true },
      { deleted: true },
    ]);
    expect(server.requests.map((request) => request.url)).toEqual([
      '/api/v1/templates/t-1',
      '/api/v1/suppressions/a%2Bb%40c.co',
      '/api/v1/emails/scheduled/sched-1',
    ]);
    for (const request of server.requests) {
      expect(request.method).toBe('DELETE');
      expect(request.body).toBe('');
    }
  });

  it('sendBulk posts the audience payload and returns the batch result', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: { batchId: 'b-1', totalRecipients: 10, queued: 9, blocked: 1 },
      },
    ]);

    const { data } = await build().emails.sendBulk({
      templateId: 't-1',
      listId: 'l-1',
      variables: { offer: 'Spring sale' },
    });

    expect(server.requests[0]!.url).toBe('/api/v1/emails/send-bulk');
    expect(JSON.parse(server.requests[0]!.body)).toEqual({
      templateId: 't-1',
      listId: 'l-1',
      variables: { offer: 'Spring sale' },
    });
    expect(data).toMatchObject({ batchId: 'b-1', queued: 9, blocked: 1 });
  });
});

describe('review-pinned behaviors', () => {
  it('a 2xx with a non-JSON body is invalid_response, never a thrown SyntaxError', async () => {
    server = await startMockServer([
      { status: 200, rawBody: '<html>proxy injected</html>' },
    ]);

    const { data, error } = await build().usage.get();

    expect(data).toBeNull();
    expect(error!.code).toBe('invalid_response');
    expect(error!.statusCode).toBe(200);
  });

  it('a response truncated mid-body is a network failure and is retried', async () => {
    server = await startMockServer([
      { destroyMidBody: true },
      { status: 201, body: sentRecord },
    ]);

    const { data, error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data!.status).toBe('SENT');
    expect(server.requests).toHaveLength(2);
  });

  it('retries 409 requestInProgress until the server replays the original', async () => {
    // The concurrent original finishes; a later attempt lands on the
    // server's replay branch. Surfacing the 409 would push callers toward
    // "retry with a NEW key": the exact double send the key prevents.
    server = await startMockServer([
      {
        status: 409,
        body: { statusCode: 409, message: 'idempotency.requestInProgress' },
      },
      { status: 201, body: sentRecord },
    ]);

    const { data, error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data!.status).toBe('SENT');
    expect(server.requests).toHaveLength(2);
  });

  it('a requestInProgress left when the retries run out is retryable, with the key', async () => {
    // The first attempt times out while the server is still sending; the
    // retry finds that request still running. Its outcome is unknown (the
    // mail may well have gone), so a job runner must retry with the same
    // key, never dead-letter it and never mint a new one.
    server = await startMockServer([
      { hang: true },
      {
        status: 409,
        body: {
          statusCode: 409,
          message: 'idempotency.requestInProgress',
          error: 'CONFLICT',
        },
      },
    ]);
    const sdk = new SendHeron(KEY, {
      baseUrl: server.url,
      maxRetries: 1,
      timeout: 150,
    });

    const { error } = await sdk.emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(server.requests).toHaveLength(2);
    const key = server.requests[0]!.headers['idempotency-key'];
    expect(server.requests[1]!.headers['idempotency-key']).toBe(key);
    expect(error!.statusCode).toBe(409);
    expect(error!.code).toBe('idempotency.requestInProgress');
    expect(error!.retryable).toBe(true);
    expect(error!.idempotencyKey).toBe(key);
  });

  it('429 retries even on a non-keyed write: it was never processed', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '0' },
        body: tooManyRequests,
      },
      { status: 201, body: savedTemplate },
    ]);

    const { data } = await build().templates.create({
      name: 'n',
      subject: 's',
      bodyHtml: '<p>x</p>',
      emailType: 'TRANSACTIONAL',
    });

    expect(data).toMatchObject({ id: 't-1' });
    expect(server.requests).toHaveLength(2);
  });

  it('reads a 429 like every other refusal: the key and the sentence', async () => {
    server = await startMockServer([{ status: 429, body: tooManyRequests }]);

    const { error } = await build(0).usage.get();

    expect(error!.kind).toBe('api');
    expect(error!.statusCode).toBe(429);
    expect(error!.code).toBe('tooManyRequests');
    expect(error!.description).toBe('Rate limit exceeded. Try again later.');
    expect(error!.retryable).toBe(true);
  });

  it('does not burn an attempt when Retry-After exceeds the wait cap', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '3600' },
        body: tooManyRequests,
      },
      { status: 201, body: sentRecord },
    ]);

    const { error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error!.statusCode).toBe(429);
    expect(error!.retryAfterSeconds).toBe(3600);
    expect(server.requests).toHaveLength(1);
  });

  it('parses the HTTP-date form of Retry-After', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': new Date(Date.now() + 1000).toUTCString() },
        body: tooManyRequests,
      },
      { status: 201, body: sentRecord },
    ]);

    const { data } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(data!.status).toBe('SENT');
    expect(server.requests).toHaveLength(2);
  });

  it('aborting during the backoff sleep returns promptly', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '20' },
        body: tooManyRequests,
      },
    ]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const startedAt = Date.now();
    const { error } = await build().emails.send(
      { to: 'a@b.co', subject: 's', html: '<p>x</p>' },
      { signal: controller.signal },
    );

    expect(error!.code).toBe('aborted');
    expect(error!.kind).toBe('transport');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('exhausts exactly maxRetries+1 attempts and exposes the idempotency key for resume', async () => {
    server = await startMockServer([
      {
        status: 503,
        body: { statusCode: 503, message: 'emailSending.sendFailed' },
      },
    ]);

    const { error } = await build(2).emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(server.requests).toHaveLength(3);
    expect(error!.statusCode).toBe(503);
    // Resume the SAME logical send: a fresh key could double-send.
    expect(error!.idempotencyKey).toMatch(UUID_PATTERN);
    expect(error!.idempotencyKey).toBe(
      server.requests[0]!.headers['idempotency-key'],
    );
  });

  it('a caller key outside the email routes does not arm retries', async () => {
    // The server deduplicates the three sends only; a key it ignores must
    // not make a 503 retry create a duplicate template.
    server = await startMockServer([
      { status: 503, body: { statusCode: 503, message: 'oops' } },
      { status: 201, body: savedTemplate },
    ]);

    const { error } = await build().templates.create(
      {
        name: 'n',
        subject: 's',
        bodyHtml: '<p>x</p>',
        emailType: 'TRANSACTIONAL',
      },
      { idempotencyKey: 'ignored-by-server' },
    );

    expect(error!.statusCode).toBe(503);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.headers['idempotency-key']).toBeUndefined();
  });

  it('times out a hung attempt', async () => {
    server = await startMockServer([{ hang: true }]);
    const sdk = new SendHeron(KEY, {
      baseUrl: server.url,
      maxRetries: 0,
      timeout: 150,
    });

    const { error } = await sdk.usage.get();

    expect(error!.code).toBe('timeout');
    expect(error!.kind).toBe('transport');
    expect(error!.retryable).toBe(true);
  });

  it('sendBulk auto-arms an idempotency key too', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: { batchId: 'b', totalRecipients: 1, queued: 1, blocked: 0 },
      },
    ]);

    await build().emails.sendBulk({ templateId: 't-1', sendToAll: true });

    expect(server.requests[0]!.headers['idempotency-key']).toMatch(
      UUID_PATTERN,
    );
  });

  it('an empty 2xx body is invalid_response, never data', async () => {
    // Every route answers a JSON body: typing an empty one as the record
    // would hand callers a null they were promised could not happen.
    server = await startMockServer([{ status: 200 }]);

    const { data, error } = await build().usage.get();

    expect(data).toBeNull();
    expect(error!.kind).toBe('transport');
    expect(error!.code).toBe('invalid_response');
    expect(error!.statusCode).toBe(200);
  });

  it('never takes the HTTP status name for the description', async () => {
    server = await startMockServer([
      {
        status: 400,
        body: {
          statusCode: 400,
          message: 'emailSending.tooManyRecipients',
          error: 'BAD_REQUEST',
        },
      },
    ]);

    const { error } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error!.code).toBe('emailSending.tooManyRecipients');
    expect(error!.description).toBeUndefined();
  });

  it('reads a JSON body without a key as invalid_response, never an API code', async () => {
    // An edge or proxy can answer JSON too; only the API's own shape carries
    // a key in `message`.
    server = await startMockServer([
      { status: 502, body: { error: 'Bad Gateway' } },
    ]);

    const { error } = await build(0).usage.get();

    expect(error!.kind).toBe('transport');
    expect(error!.code).toBe('invalid_response');
    expect(error!.statusCode).toBe(502);
    expect(error!.retryable).toBe(true);
  });
});

describe('request shaping', () => {
  it('schedules with a Date, and answers the same record, SCHEDULED', async () => {
    const sendAt = new Date('2026-09-01T09:00:00.000Z');
    server = await startMockServer([
      {
        status: 201,
        body: record({
          ...notSent,
          id: 'sched-1',
          status: 'SCHEDULED',
          scheduledAt: '2026-09-01T09:00:00.000Z',
        }),
      },
    ]);

    const { data } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
      sendAt,
    });

    expect(JSON.parse(server.requests[0]!.body).sendAt).toBe(
      '2026-09-01T09:00:00.000Z',
    );
    // One record type: get() reads it, cancelScheduled() cancels it.
    expect(data).toMatchObject({
      id: 'sched-1',
      status: 'SCHEDULED',
      scheduledAt: '2026-09-01T09:00:00.000Z',
    });
  });

  it('builds query strings and encodes path params', async () => {
    server = await startMockServer([
      { status: 200, body: { ...deliverable, email: 'a+b@c.co' } },
    ]);
    const sdk = build();

    await sdk.suppressions.check('a+b@c.co');
    expect(server.requests[0]!.url).toBe(
      '/api/v1/suppressions/check?email=a%2Bb%40c.co',
    );

    await sdk.suppressions.remove('a+b@c.co');
    expect(server.requests[1]!.url).toBe('/api/v1/suppressions/a%2Bb%40c.co');
    expect(server.requests[1]!.body).toBe('');
  });

  it('sends a list filter as the parameter repeated', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          data: [],
          totalCount: 0,
          page: 0,
          limit: 50,
          hasNextPage: false,
        },
      },
    ]);

    await build().templates.list({ tagIds: ['tag-1', 'tag-2'], page: 2 });

    expect(server.requests[0]!.url).toBe(
      '/api/v1/templates?tagIds=tag-1&tagIds=tag-2&page=2',
    );
  });

  it('reads machine and privacy-proxy engagement beside the people counts', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: record({
          status: 'DELIVERED',
          deliveredAt: '2026-10-15T17:00:00.000Z',
          machineOpenCount: 2,
          machineClickCount: 3,
          unconfirmedOpenCount: 1,
        }),
      },
    ]);

    const { data, error } = await build().emails.get('log-1');

    expect(error).toBeNull();
    // Only machines and a privacy proxy touched it: delivered, never opened.
    expect(data!.status).toBe('DELIVERED');
    expect(data!.openCount).toBe(0);
    expect(data!.clickCount).toBe(0);
    expect(data!.machineOpenCount).toBe(2);
    expect(data!.machineClickCount).toBe(3);
    expect(data!.unconfirmedOpenCount).toBe(1);
  });

  it('reads a platform-wide hard bounce and the contact screening on a check', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          ...deliverable,
          email: 'gone@example.com',
          contactStatus: 'SUBSCRIBED',
          screeningVerdict: 'UNDELIVERABLE',
          screeningReasons: ['KNOWN_HARD_BOUNCE'],
          knownHardBounce: true,
          marketing: { allowed: false, blockReason: 'ADDRESS_UNDELIVERABLE' },
          transactional: {
            allowed: false,
            blockReason: 'ADDRESS_UNDELIVERABLE',
          },
        },
      },
    ]);

    const { data, error } =
      await build().suppressions.check('gone@example.com');

    expect(error).toBeNull();
    // It bounced in another organization: no suppression entry here, yet
    // every stream refuses it.
    expect(data!.suppressed).toBe(false);
    expect(data!.knownHardBounce).toBe(true);
    const verdict: ScreeningVerdict | null = data!.screeningVerdict;
    expect(verdict).toBe('UNDELIVERABLE');
    const reasons: ScreeningReason[] = data!.screeningReasons;
    expect(reasons).toEqual(['KNOWN_HARD_BOUNCE']);
    expect(data!.marketing.blockReason).toBe('ADDRESS_UNDELIVERABLE');
    expect(data!.transactional).toEqual({
      allowed: false,
      blockReason: 'ADDRESS_UNDELIVERABLE',
    });
  });

  it('reads a likely typo as mailable, with the suggested fix', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          ...deliverable,
          email: 'jane@gmial.com',
          contactStatus: 'SUBSCRIBED',
          screeningVerdict: 'RISKY',
          screeningReasons: ['LIKELY_TYPO'],
          suggestedEmail: 'jane@gmail.com',
        },
      },
    ]);

    const { data } = await build().suppressions.check('jane@gmial.com');

    // RISKY is a flag for a person to look at, never a refusal.
    expect(data!.screeningVerdict).toBe('RISKY');
    expect(data!.suggestedEmail).toBe('jane@gmail.com');
    expect(data!.marketing.allowed).toBe(true);
    expect(data!.transactional.allowed).toBe(true);
  });

  it('reads an address without a screened contact: no verdict, no reasons', async () => {
    server = await startMockServer([{ status: 200, body: deliverable }]);

    const { data } = await build().suppressions.check('jane@example.com');

    expect(data!.screeningVerdict).toBeNull();
    // Never null, so it iterates without a guard.
    expect(data!.screeningReasons).toEqual([]);
    expect(data!.suggestedEmail).toBeNull();
    expect(data!.knownHardBounce).toBe(false);
  });

  it('reads usage with nullable pool fields intact', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'UNLIMITED',
            name: null,
            trialEndsAt: null,
            lapsedReason: null,
            sendingReview: 'APPROVED',
          },
          monthlySends: {
            used: 766,
            pool: null,
            marketingRemaining: null,
            transactionalCeiling: null,
            transactionalRemaining: null,
            resetsAt: '2026-09-01T00:00:00.000Z',
          },
          contacts: { subscribed: 4120, cap: null, remaining: null },
          domains: { used: 3, cap: null, remaining: null },
          workspaces: { used: 4, cap: null, remaining: null },
          teamMembers: { used: 6, cap: null, remaining: null },
          sending: null,
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    expect(data!.plan.status).toBe('UNLIMITED');
    expect(data!.monthlySends.pool).toBeNull();
    expect(data!.contacts.subscribed).toBe(4120);
    expect(data!.contacts.cap).toBeNull();
    expect(data!.rateLimits.organizationPerMinute.SEND).toBe(200);
    for (const count of [data!.domains, data!.workspaces, data!.teamMembers]) {
      expect(count.cap).toBeNull();
      expect(count.remaining).toBeNull();
    }
    expect(data!.sending).toBeNull();
  });

  it('reads the trial deadline and the contact cap on a trialing plan', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'ACTIVE',
            name: 'Starter',
            trialEndsAt: '2026-09-29T12:00:00.000Z',
            lapsedReason: null,
            sendingReview: 'APPROVED',
          },
          monthlySends: {
            used: 40,
            pool: 500,
            marketingRemaining: 460,
            transactionalCeiling: 550,
            transactionalRemaining: 510,
            resetsAt: '2026-10-01T00:00:00.000Z',
          },
          contacts: { subscribed: 180, cap: 500, remaining: 320 },
          domains: { used: 1, cap: 2, remaining: 1 },
          workspaces: { used: 2, cap: 3, remaining: 1 },
          teamMembers: { used: 3, cap: 4, remaining: 1 },
          sending: sendingPosition,
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    expect(data!.plan.trialEndsAt).toBe('2026-09-29T12:00:00.000Z');
    expect(data!.plan.lapsedReason).toBeNull();
    expect(data!.contacts.remaining).toBe(320);
  });

  it('reads why a lapsed plan is refused', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'LAPSED',
            name: null,
            trialEndsAt: null,
            lapsedReason: 'TRIAL_EXPIRED',
            sendingReview: 'APPROVED',
          },
          monthlySends: {
            used: 12,
            pool: 0,
            marketingRemaining: 0,
            transactionalCeiling: 0,
            transactionalRemaining: 0,
            resetsAt: '2026-10-01T00:00:00.000Z',
          },
          contacts: { subscribed: 90, cap: 0, remaining: 0 },
          domains: { used: 1, cap: 0, remaining: 0 },
          workspaces: { used: 2, cap: 0, remaining: 0 },
          teamMembers: { used: 4, cap: 0, remaining: 0 },
          sending: sendingPosition,
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    // Never paid: the transactional grace is gone too, so the ceiling is 0
    // rather than the smallest plan's pool.
    expect(data!.plan.lapsedReason).toBe('TRIAL_EXPIRED');
    expect(data!.monthlySends.transactionalCeiling).toBe(0);
    expect(data!.contacts.cap).toBe(0);
    // Every cap drops to 0 and remaining never goes negative, so what the
    // organization already holds sits above its cap.
    expect(data!.teamMembers).toEqual({ used: 4, cap: 0, remaining: 0 });
  });

  it('reads the sender review of an organization still in the sandbox', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'ACTIVE',
            name: 'Starter',
            trialEndsAt: '2026-10-16T12:00:00.000Z',
            lapsedReason: null,
            sendingReview: 'SANDBOX',
          },
          monthlySends: {
            used: 3,
            pool: 500,
            marketingRemaining: 497,
            transactionalCeiling: 550,
            transactionalRemaining: 547,
            resetsAt: '2026-11-01T00:00:00.000Z',
          },
          contacts: { subscribed: 2, cap: 500, remaining: 498 },
          domains: { used: 1, cap: 2, remaining: 1 },
          workspaces: { used: 1, cap: 3, remaining: 2 },
          teamMembers: { used: 1, cap: 4, remaining: 3 },
          sending: sendingPosition,
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    // Pool to spare, yet a send to a stranger is still suppressed with
    // SENDER_UNDER_REVIEW: this field is what says so before a send does.
    expect(data!.plan.status).toBe('ACTIVE');
    expect(data!.plan.sendingReview).toBe('SANDBOX');
  });

  it('reads the domain, workspace and team-member caps on a paid plan', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'ACTIVE',
            name: 'Growth',
            trialEndsAt: null,
            lapsedReason: null,
            sendingReview: 'APPROVED',
          },
          monthlySends: {
            used: 1200,
            pool: 20000,
            marketingRemaining: 18800,
            transactionalCeiling: 22000,
            transactionalRemaining: 20800,
            resetsAt: '2026-11-01T00:00:00.000Z',
          },
          contacts: { subscribed: 5400, cap: 8000, remaining: 2600 },
          domains: { used: 3, cap: 4, remaining: 1 },
          workspaces: { used: 12, cap: 20, remaining: 8 },
          teamMembers: { used: 7, cap: 12, remaining: 5 },
          sending: sendingPosition,
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    const caps: CountUsageResponse[] = [
      data!.domains,
      data!.workspaces,
      data!.teamMembers,
    ];
    expect(caps.map((count) => count.remaining)).toEqual([1, 8, 5]);
    expect(data!.teamMembers).toEqual({ used: 7, cap: 12, remaining: 5 });
  });

  it('reads the daily sending position while the platform holds marketing', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'ACTIVE',
            name: 'Growth',
            trialEndsAt: null,
            lapsedReason: null,
            sendingReview: 'APPROVED',
          },
          monthlySends: {
            used: 9200,
            pool: 20000,
            marketingRemaining: 10800,
            transactionalCeiling: 22000,
            transactionalRemaining: 12800,
            resetsAt: '2026-11-01T00:00:00.000Z',
          },
          contacts: { subscribed: 5400, cap: 8000, remaining: 2600 },
          domains: { used: 3, cap: 4, remaining: 1 },
          workspaces: { used: 12, cap: 20, remaining: 8 },
          teamMembers: { used: 7, cap: 12, remaining: 5 },
          sending: {
            last24Hours: 3100,
            transactionalLast24Hours: 600,
            share: 20_000,
            earnedVolume: 6_400,
            marketingRemaining: 0,
            platformMarketingHeld: true,
            held: 37,
            warmup: {
              status: 'COMPLETE',
              completedAt: '2026-10-16T10:28:00.000Z',
              sampleSize: 640,
              heldStreams: [],
            },
          },
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    const sending: SendingCapacityUsageResponse = data!.sending!;
    // Under its own lines, yet nothing more fits today: the platform's
    // marketing line holds everyone's marketing until the window moves.
    expect(sending.platformMarketingHeld).toBe(true);
    expect(sending.marketingRemaining).toBe(0);
    expect(sending.held).toBe(37);
    const warmup: WarmupUsageResponse = sending.warmup;
    expect(warmup.status).toBe('COMPLETE');
    expect(warmup.completedAt).toBe('2026-10-16T10:28:00.000Z');
  });

  it('reads a held warm-up slice, and daily counts it cannot read as null', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'ACTIVE',
            name: 'Starter',
            trialEndsAt: null,
            lapsedReason: null,
            sendingReview: 'APPROVED',
          },
          monthlySends: {
            used: 310,
            pool: 5000,
            marketingRemaining: 4690,
            transactionalCeiling: 5500,
            transactionalRemaining: 5190,
            resetsAt: '2026-11-01T00:00:00.000Z',
          },
          contacts: { subscribed: 900, cap: 2000, remaining: 1100 },
          domains: { used: 1, cap: 2, remaining: 1 },
          workspaces: { used: 1, cap: 3, remaining: 2 },
          teamMembers: { used: 2, cap: 4, remaining: 2 },
          sending: {
            last24Hours: null,
            transactionalLast24Hours: null,
            share: 20_000,
            earnedVolume: 1_000,
            marketingRemaining: null,
            platformMarketingHeld: false,
            held: 214,
            warmup: {
              status: 'HELD',
              completedAt: null,
              sampleSize: 100,
              heldStreams: ['MARKETING'],
            },
          },
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    const sending = data!.sending!;
    // The slice crossed the bounce or complaint line: new-address marketing
    // waits for a person, while transactional keeps going.
    const status: WarmupStatus = sending.warmup.status;
    expect(status).toBe('HELD');
    expect(sending.warmup.heldStreams).toEqual(['MARKETING']);
    expect(sending.held).toBe(214);
    expect(sending.last24Hours).toBeNull();
    expect(sending.transactionalLast24Hours).toBeNull();
    expect(sending.marketingRemaining).toBeNull();
  });

  it("reads the signup forms of the key's workspace, capped on every plan", async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          plan: {
            status: 'UNLIMITED',
            name: null,
            trialEndsAt: null,
            lapsedReason: null,
            sendingReview: 'APPROVED',
          },
          monthlySends: {
            used: 766,
            pool: null,
            marketingRemaining: null,
            transactionalCeiling: null,
            transactionalRemaining: null,
            resetsAt: '2026-12-01T00:00:00.000Z',
          },
          contacts: { subscribed: 4120, cap: null, remaining: null },
          domains: { used: 3, cap: null, remaining: null },
          workspaces: { used: 4, cap: null, remaining: null },
          teamMembers: { used: 6, cap: null, remaining: null },
          sending: sendingPosition,
          signupForms: {
            forms: { used: 12, cap: 100, remaining: 88 },
            pendingSignups: 41,
            confirmedLast30Days: 380,
            underAttack: 1,
          },
          rateLimits: {
            perKeyPerMinute: 100,
            organizationPerMinute: { READ: 1200, WRITE: 400, SEND: 200 },
          },
        },
      },
    ]);

    const { data } = await build().usage.get();

    // The plan caps are null on an unlimited plan; the forms cap is not one.
    expect(data!.domains.cap).toBeNull();
    const signupForms: SignupFormsUsageResponse = data!.signupForms;
    expect(signupForms.forms).toEqual({ used: 12, cap: 100, remaining: 88 });
    expect(signupForms.pendingSignups).toBe(41);
    expect(signupForms.confirmedLast30Days).toBe(380);
    expect(signupForms.underAttack).toBe(1);
  });
});

describe('templates', () => {
  it('creates a template with preview text and reads it back', async () => {
    server = await startMockServer([{ status: 201, body: savedTemplate }]);

    const { data, error } = await build().templates.create({
      name: 'Welcome',
      subject: 'Welcome, {{contact.firstName}}',
      previewText: 'Your first steps, and where to find help',
      bodyHtml: '<p>Hi {{contact.firstName}}</p>',
      emailType: 'TRANSACTIONAL',
    });

    expect(error).toBeNull();
    expect(JSON.parse(server.requests[0]!.body).previewText).toBe(
      'Your first steps, and where to find help',
    );
    const previewText: string | null = data!.previewText;
    expect(previewText).toBe('Your first steps, and where to find help');
  });

  it('lists templates with their preview text, null on one without', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          data: [
            savedTemplate,
            { ...savedTemplate, id: 't-2', previewText: null },
          ],
          totalCount: 2,
          page: 0,
          limit: 50,
          hasNextPage: false,
        },
      },
    ]);

    const { data } = await build().templates.list();

    expect(data!.data.map((template) => template.previewText)).toEqual([
      'Your first steps, and where to find help',
      null,
    ]);
    // One envelope on every list: the zero-based page that was asked for.
    expect(data).toMatchObject({
      totalCount: 2,
      page: 0,
      limit: 50,
      hasNextPage: false,
    });
  });

  it('removes preview text with an explicit null, and keeps it when left out', async () => {
    server = await startMockServer([
      { status: 200, body: { ...savedTemplate, previewText: null } },
    ]);
    const sdk = build();

    const { data } = await sdk.templates.update('t-1', { previewText: null });
    await sdk.templates.update('t-1', { name: 'Welcome v2' });

    // The null is sent: it is the instruction to remove the text.
    expect(JSON.parse(server.requests[0]!.body)).toEqual({ previewText: null });
    expect(data!.previewText).toBeNull();
    // Left out, no key goes at all, so the API keeps what it has.
    expect(JSON.parse(server.requests[1]!.body)).not.toHaveProperty(
      'previewText',
    );
  });

  it('surfaces an over-long preview text as a typed 400, never retried', async () => {
    server = await startMockServer([
      {
        status: 400,
        body: {
          statusCode: 400,
          message: 'templates.previewTextTooLong',
          error: 'Bad Request',
        },
      },
    ]);

    const { data, error } = await build().templates.create({
      name: 'Welcome',
      subject: 's',
      previewText: 'x'.repeat(201),
      bodyHtml: '<p>x</p>',
      emailType: 'TRANSACTIONAL',
    });

    // Refused, never truncated.
    expect(data).toBeNull();
    expect(error!.statusCode).toBe(400);
    expect(error!.code).toBe('templates.previewTextTooLong');
    expect(error!.retryable).toBe(false);
    expect(server.requests).toHaveLength(1);
  });

  it('previews a subject and preview text as the inbox shows them', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          renderedHtml:
            '<div style="display:none;">Your first steps, Ada</div><p>Hi Ada</p>',
          renderedSubject: 'Welcome, Ada',
          renderedPreviewText: 'Your first steps, Ada',
          injectedUnsubscribeFooter: false,
          hasUnrecognizedUnsubscribeLink: false,
          appendedPromoBadge: false,
          unsubscribeVariableIgnored: false,
        },
      },
    ]);

    const { data, error } = await build().templates.preview({
      bodyHtml: '<p>Hi {{contact.firstName}}</p>',
      emailType: 'TRANSACTIONAL',
      variables: { contact: { firstName: 'Ada' } },
      subject: 'Welcome, {{contact.firstName}}',
      previewText: 'Your first steps, {{contact.firstName}}',
    });

    expect(error).toBeNull();
    expect(JSON.parse(server.requests[0]!.body)).toMatchObject({
      variables: { contact: { firstName: 'Ada' } },
      subject: 'Welcome, {{contact.firstName}}',
      previewText: 'Your first steps, {{contact.firstName}}',
    });
    const subject: string | null = data!.renderedSubject;
    expect(subject).toBe('Welcome, Ada');
    const previewText: string | null = data!.renderedPreviewText;
    expect(previewText).toBe('Your first steps, Ada');
  });

  it('reads a preview without a subject or preview text as null', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          renderedHtml: '<p>Hi Ada</p>',
          renderedSubject: null,
          renderedPreviewText: null,
          injectedUnsubscribeFooter: false,
          hasUnrecognizedUnsubscribeLink: false,
          appendedPromoBadge: false,
          unsubscribeVariableIgnored: false,
        },
      },
    ]);

    const { data } = await build().templates.preview({
      bodyHtml: '<p>Hi {{contact.firstName}}</p>',
      variables: { contact: { firstName: 'Ada' } },
    });

    expect(data!.renderedSubject).toBeNull();
    expect(data!.renderedPreviewText).toBeNull();
  });

  it('validates a document with the preview text it will carry', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          valid: false,
          issues: ['previewText must be at most 200 characters'],
        },
      },
    ]);

    const { data } = await build().templates.validate(
      blockDocument,
      'x'.repeat(201),
    );

    expect(JSON.parse(server.requests[0]!.body)).toEqual({
      document: blockDocument,
      previewText: 'x'.repeat(201),
    });
    // A check, not a save: the over-long text is one more issue, not a 400.
    expect(data).toEqual({
      valid: false,
      issues: ['previewText must be at most 200 characters'],
    });
  });

  it('validate still reads an object second as the request options', async () => {
    server = await startMockServer([{ status: 429, body: tooManyRequests }]);
    const sdk = build();

    const { error } = await sdk.templates.validate(blockDocument, {
      maxRetries: 0,
    });
    await sdk.templates.validate(blockDocument, undefined, { maxRetries: 0 });
    await sdk.templates.validate(blockDocument, null, { maxRetries: 0 });

    // maxRetries: 0 reached the client in every form: one attempt each,
    // where the 429 would otherwise retry twice.
    expect(error!.code).toBe('tooManyRequests');
    expect(server.requests).toHaveLength(3);
    for (const request of server.requests) {
      expect(JSON.parse(request.body)).toEqual({ document: blockDocument });
    }
  });
});

describe('forms', () => {
  const FORM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const signup = {
    email: 'jane@example.com',
    ipAddress: '203.0.113.7',
    firstName: 'Jane',
    userAgent: 'Mozilla/5.0',
  };

  it('signs up through a form: 202 accepted, the body as given', async () => {
    server = await startMockServer([
      { status: 202, body: { status: 'ACCEPTED' } },
    ]);

    const { data, error } = await build().forms.signup(FORM_ID, signup);

    expect(error).toBeNull();
    const accepted: FormSignupAcceptedResponse = data!;
    expect(accepted).toEqual({ status: 'ACCEPTED' });
    const request = server.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`/api/v1/forms/${FORM_ID}/signups`);
    expect(JSON.parse(request.body)).toEqual(signup);
    // Not an email route: no idempotency key is minted.
    expect(request.headers['idempotency-key']).toBeUndefined();
  });

  it('encodes the form id into the path', async () => {
    server = await startMockServer([
      {
        status: 404,
        body: { statusCode: 404, message: 'signupForms.notFound' },
      },
    ]);

    const { error } = await build().forms.signup('a/b?c', signup);

    expect(server.requests[0]!.url).toBe('/api/v1/forms/a%2Fb%3Fc/signups');
    expect(error!.code).toBe('signupForms.notFound');
  });

  it('surfaces a form that takes no signups as a typed 409, with the reason', async () => {
    server = await startMockServer([
      {
        status: 409,
        body: {
          statusCode: 409,
          message: 'signupForms.unavailable',
          error: 'CONFLICT',
          description: 'This form is not taking signups (SWITCHED_OFF).',
        },
      },
    ]);

    const { data, error } = await build().forms.signup(FORM_ID, signup);

    expect(data).toBeNull();
    expect(error!.statusCode).toBe(409);
    expect(error!.code).toBe('signupForms.unavailable');
    expect(error!.description).toContain('SWITCHED_OFF');
    expect(error!.retryable).toBe(false);
    expect(server.requests).toHaveLength(1);
  });

  it('never retries a 5xx: a signup is not replay-safe', async () => {
    server = await startMockServer([
      { status: 503, body: { statusCode: 503, message: 'oops' } },
      { status: 202, body: { status: 'ACCEPTED' } },
    ]);

    const { error } = await build().forms.signup(FORM_ID, signup);

    expect(error!.statusCode).toBe(503);
    expect(server.requests).toHaveLength(1);
  });

  it('surfaces a per-visitor limit past the wait cap at once', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '3600' },
        body: tooManyRequests,
      },
      { status: 202, body: { status: 'ACCEPTED' } },
    ]);

    const { error } = await build().forms.signup(FORM_ID, signup);

    expect(error!.code).toBe('tooManyRequests');
    expect(error!.retryAfterSeconds).toBe(3600);
    expect(server.requests).toHaveLength(1);
  });
});
