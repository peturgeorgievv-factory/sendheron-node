import { afterEach, describe, expect, it } from 'vitest';
import {
  type CountUsage,
  isHeld,
  isSenderSideBlock,
  type ScreeningReason,
  type ScreeningVerdict,
  SendHeron,
  SendHeronError,
  type SendHoldReason,
  type SendingCapacityUsage,
  type WarmupStatus,
  type WarmupUsage,
} from '../src/index.js';
import { type MockServer, startMockServer } from './mock-server.js';

const KEY = 'ema_live_test_key';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sentRecord = {
  id: 'log-1',
  to: 'user@example.com',
  from: 'billing@customer.com',
  subject: 'Receipt',
  status: 'sent',
  providerMessageId: 'ses-123',
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  openCount: 0,
  clickCount: 0,
  machineOpenCount: 0,
  machineClickCount: 0,
  unconfirmedOpenCount: 0,
  warmupFirstContact: false,
};

/** The suppressions.check() answer for an address nothing refuses. */
const deliverable = {
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
const sendingPosition = {
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
const savedTemplate = {
  id: 't-1',
  name: 'Welcome',
  subject: 'Welcome, {{contact.firstName}}',
  previewText: 'Your first steps, and where to find help',
  bodyHtml: '<p>Hi {{contact.firstName}}</p>',
  document: null,
  bodyMjml: null,
  emailType: 'TRANSACTIONAL',
  variables: ['contact.firstName'],
  organizationId: 'org-1',
  workspaceId: 'ws-1',
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
      status: 'sent',
      providerMessageId: 'ses-123',
    });
  });

  it('passes a suppressed 201 through as DATA, not an error', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: {
          ...sentRecord,
          status: 'suppressed',
          errorMessage: 'HARD_SUPPRESSED',
          providerMessageId: undefined,
        },
      },
    ]);

    const { data, error } = await build().emails.send({
      to: 'bounced@example.com',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: 'suppressed',
      errorMessage: 'HARD_SUPPRESSED',
    });
    // One request: a suppression is an outcome and must never be retried.
    expect(server.requests).toHaveLength(1);
  });

  it('passes a held 201 through as DATA, never retried', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: {
          ...sentRecord,
          status: 'queued',
          providerMessageId: undefined,
          holdReason: 'PLATFORM_DAILY_LIMIT',
          heldUntil: '2026-10-16T11:10:00.000Z',
        },
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
      status: 'queued',
      holdReason: 'PLATFORM_DAILY_LIMIT',
      heldUntil: '2026-10-16T11:10:00.000Z',
      warmupFirstContact: false,
    });
    // One request: a held send goes out by itself. Retrying with a new key
    // would send it twice.
    expect(server.requests).toHaveLength(1);
  });

  it('reads a held send back on the same record until it goes out', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          ...sentRecord,
          status: 'queued',
          providerMessageId: null,
          holdReason: 'WARMUP_SAMPLE',
          heldUntil: '2026-10-16T11:40:00.000Z',
        },
      },
      {
        status: 200,
        body: {
          ...sentRecord,
          holdReason: null,
          heldUntil: null,
          warmupFirstContact: true,
        },
      },
    ]);
    const sdk = build();

    const waiting = await sdk.emails.get('log-1');
    expect(isHeld(waiting.data!)).toBe(true);
    // Counted in a warm-up slice only once it is admitted.
    expect(waiting.data!.warmupFirstContact).toBe(false);

    const gone = await sdk.emails.get('log-1');
    expect(isHeld(gone.data!)).toBe(false);
    expect(gone.data).toMatchObject({
      id: 'log-1',
      status: 'sent',
      holdReason: null,
      heldUntil: null,
      warmupFirstContact: true,
    });
  });

  it('passes an ADDRESS_UNDELIVERABLE refusal through as DATA, recipient-side', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: {
          ...sentRecord,
          to: 'gone@example.com',
          status: 'suppressed',
          errorMessage: 'ADDRESS_UNDELIVERABLE',
          providerMessageId: undefined,
        },
      },
    ]);

    const { data, error } = await build().emails.send({
      to: 'gone@example.com',
      subject: 'Receipt',
      html: '<p>x</p>',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: 'suppressed',
      errorMessage: 'ADDRESS_UNDELIVERABLE',
    });
    // The address cannot receive email, transactional included: drop it.
    expect(isSenderSideBlock(data!.errorMessage)).toBe(false);
    expect(server.requests).toHaveLength(1);
  });

  it('passes an import slice hold through as DATA, with its import', async () => {
    server = await startMockServer([
      {
        status: 201,
        body: {
          ...sentRecord,
          status: 'queued',
          providerMessageId: undefined,
          holdReason: 'IMPORT_SAMPLE',
          heldUntil: '2026-10-19T09:40:00.000Z',
          contactImportId: 'import-1',
        },
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
      status: 'queued',
      holdReason: 'IMPORT_SAMPLE',
      contactImportId: 'import-1',
      // The import's own slice, not a new sender's warm-up.
      warmupFirstContact: false,
    });
    // One request: it goes out by itself with the import's next slice.
    expect(server.requests).toHaveLength(1);
  });

  it('reads an import held past its line back as held', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          ...sentRecord,
          status: 'queued',
          providerMessageId: null,
          holdReason: 'IMPORT_SAMPLE_FAILED',
          heldUntil: '2026-10-19T10:10:00.000Z',
          contactImportId: 'import-1',
        },
      },
    ]);

    const { data } = await build().emails.get('log-1');

    // A slice of the import bounced or drew complaints past the line: the
    // rest of it waits for a person at SendHeron, still never retried.
    expect(isHeld(data!)).toBe(true);
    const reason: SendHoldReason | null | undefined = data!.holdReason;
    expect(reason).toBe('IMPORT_SAMPLE_FAILED');
    expect(data!.contactImportId).toBe('import-1');
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
    server = await startMockServer([{ status: 201, body: { id: 't-1' } }]);

    await build().templates.create({
      name: 'n',
      subject: 's',
      bodyHtml: '<p>x</p>',
      emailType: 'TRANSACTIONAL',
    });

    expect(server.requests[0]!.headers['idempotency-key']).toBeUndefined();
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
    expect(data!.status).toBe('sent');
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
        body: { statusCode: 429, message: 'Rate limit exceeded.' },
      },
      { status: 201, body: sentRecord },
    ]);

    const { data } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(data!.status).toBe('sent');
    expect(server.requests).toHaveLength(2);
  });

  it('exposes retryAfterSeconds once retries are exhausted', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '17' },
        body: { statusCode: 429, message: 'Rate limit exceeded.' },
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
    expect(data!.status).toBe('sent');
  });

  it('never retries a write without an idempotency key', async () => {
    server = await startMockServer([
      { status: 503, body: { statusCode: 503, message: 'oops' } },
      { status: 201, body: { id: 't-1' } },
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
    expect(server.requests).toHaveLength(1);
  });

  it('uses PATCH for template updates and DELETE with a body for unsuppress', async () => {
    server = await startMockServer([{ status: 200, body: { id: 't-1' } }]);
    const sdk = build();

    await sdk.templates.update('t-1', {
      emailType: 'MARKETING',
      confirmEmailTypeChange: true,
    });

    expect(server.requests[0]!.method).toBe('PATCH');
    expect(server.requests[0]!.url).toBe('/api/v1/templates/t-1');
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
    });

    expect(server.requests[0]!.url).toBe('/api/v1/emails/send-bulk');
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
    expect(data!.status).toBe('sent');
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
    expect(data!.status).toBe('sent');
    expect(server.requests).toHaveLength(2);
  });

  it('429 retries even on a non-keyed write: it was never processed', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '0' },
        body: { statusCode: 429, message: 'Rate limit exceeded.' },
      },
      { status: 201, body: { id: 't-1' } },
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

  it('normalizes the 429 code to rate_limited', async () => {
    server = await startMockServer([
      {
        status: 429,
        body: {
          statusCode: 429,
          message: 'Rate limit exceeded. Try again later.',
        },
      },
    ]);

    const { error } = await build(0).usage.get();

    expect(error!.code).toBe('rate_limited');
  });

  it('does not burn an attempt when Retry-After exceeds the wait cap', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '3600' },
        body: { statusCode: 429, message: 'Rate limit exceeded.' },
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
        body: { statusCode: 429, message: 'Rate limit exceeded.' },
      },
      { status: 201, body: sentRecord },
    ]);

    const { data } = await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
    });

    expect(data!.status).toBe('sent');
    expect(server.requests).toHaveLength(2);
  });

  it('aborting during the backoff sleep returns promptly', async () => {
    server = await startMockServer([
      {
        status: 429,
        headers: { 'retry-after': '20' },
        body: { statusCode: 429, message: 'Rate limit exceeded.' },
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
    // The server only implements idempotency under /api/v1/emails/; a key it
    // ignores must not make a 503 retry create a duplicate template.
    server = await startMockServer([
      { status: 503, body: { statusCode: 503, message: 'oops' } },
      { status: 201, body: { id: 't-1' } },
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

  it('an empty body resolves to null data', async () => {
    server = await startMockServer([{ status: 200 }]);

    const { data, error } = await build().usage.get();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe('request shaping', () => {
  it('serializes a Date sendAt to ISO-8601', async () => {
    const sendAt = new Date('2026-09-01T09:00:00.000Z');
    server = await startMockServer([
      { status: 201, body: { id: 'sched-1', status: 'SCHEDULED' } },
    ]);

    await build().emails.send({
      to: 'a@b.co',
      subject: 's',
      html: '<p>x</p>',
      sendAt,
    });

    expect(JSON.parse(server.requests[0]!.body).sendAt).toBe(
      '2026-09-01T09:00:00.000Z',
    );
  });

  it('builds query strings and encodes path params', async () => {
    server = await startMockServer([
      { status: 200, body: { email: 'a+b@c.co', suppressed: false } },
    ]);
    const sdk = build();

    await sdk.suppressions.check('a+b@c.co');
    expect(server.requests[0]!.url).toBe(
      '/api/v1/suppressions/check?email=a%2Bb%40c.co',
    );

    await sdk.suppressions.remove('a+b@c.co', { confirmHardTier: true });
    expect(server.requests[1]!.url).toBe('/api/v1/suppressions/a%2Bb%40c.co');
    expect(JSON.parse(server.requests[1]!.body)).toEqual({
      confirmHardTier: true,
    });
  });

  it('reads machine and privacy-proxy engagement beside the people counts', async () => {
    server = await startMockServer([
      {
        status: 200,
        body: {
          ...sentRecord,
          status: 'delivered',
          deliveredAt: '2026-10-15T17:00:00.000Z',
          machineOpenCount: 2,
          machineClickCount: 3,
          unconfirmedOpenCount: 1,
        },
      },
    ]);

    const { data, error } = await build().emails.get('log-1');

    expect(error).toBeNull();
    // Only machines and a privacy proxy touched it: delivered, never opened.
    expect(data!.status).toBe('delivered');
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

    const caps: CountUsage[] = [
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

    const sending: SendingCapacityUsage = data!.sending!;
    // Under its own lines, yet nothing more fits today: the platform's
    // marketing line holds everyone's marketing until the window moves.
    expect(sending.platformMarketingHeld).toBe(true);
    expect(sending.marketingRemaining).toBe(0);
    expect(sending.held).toBe(37);
    const warmup: WarmupUsage = sending.warmup;
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
        },
      },
    ]);

    const { data } = await build().templates.list();

    expect(data!.data.map((template) => template.previewText)).toEqual([
      'Your first steps, and where to find help',
      null,
    ]);
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
        status: 201,
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
      sampleData: { contact: { firstName: 'Ada' } },
      subject: 'Welcome, {{contact.firstName}}',
      previewText: 'Your first steps, {{contact.firstName}}',
    });

    expect(error).toBeNull();
    expect(JSON.parse(server.requests[0]!.body)).toMatchObject({
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
        status: 201,
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
      sampleData: { contact: { firstName: 'Ada' } },
    });

    expect(data!.renderedSubject).toBeNull();
    expect(data!.renderedPreviewText).toBeNull();
  });

  it('validates a document with the preview text it will carry', async () => {
    server = await startMockServer([
      {
        status: 201,
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
    server = await startMockServer([
      { status: 429, body: { statusCode: 429, message: 'Too many requests' } },
    ]);
    const sdk = build();

    const { error } = await sdk.templates.validate(blockDocument, {
      maxRetries: 0,
    });
    await sdk.templates.validate(blockDocument, undefined, { maxRetries: 0 });
    await sdk.templates.validate(blockDocument, null, { maxRetries: 0 });

    // maxRetries: 0 reached the client in every form: one attempt each,
    // where the 429 would otherwise retry twice.
    expect(error!.code).toBe('rate_limited');
    expect(server.requests).toHaveLength(3);
    for (const request of server.requests) {
      expect(JSON.parse(request.body)).toEqual({ document: blockDocument });
    }
  });
});
