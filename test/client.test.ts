import { afterEach, describe, expect, it } from 'vitest';
import { SendHeron, SendHeronError } from '../src/index.js';
import { startMockServer, type MockServer } from './mock-server.js';

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
    expect(data).toMatchObject({ status: 'sent', providerMessageId: 'ses-123' });
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
    // One request — a suppression is an outcome and must never be retried.
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
          plan: { status: 'UNLIMITED', name: null },
          monthlySends: {
            used: 766,
            pool: null,
            marketingRemaining: null,
            transactionalCeiling: null,
            transactionalRemaining: null,
            resetsAt: '2026-09-01T00:00:00.000Z',
          },
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
    expect(data!.rateLimits.organizationPerMinute.SEND).toBe(200);
  });
});
