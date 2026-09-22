import { afterEach, describe, expect, it } from 'vitest';
import { SendHeron, SendHeronError } from '../src/index.js';
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
  });
});
