import { describe, expect, it } from 'vitest';
import { SendHeronError, TRANSPORT_ERROR_CODES } from '../src/index.js';

/**
 * `retryable` is what job runners branch on: true means "the same request,
 * same idempotency key, can still succeed later", false means "fail the job".
 * Getting it wrong either dead-letters a send whose outcome is unknown or
 * retries a refusal forever.
 */
describe('error.retryable', () => {
  it.each([
    [null, 'timeout', true],
    [null, 'network_error', true],
    [null, 'aborted', false],
    [400, 'emailSending.tooManyRecipients', false],
    // A bounce or complaint blocks every workspace: no key lifts one, the
    // account owner does, in the dashboard.
    [403, 'compliance.organizationWideSuppressionOwnerOnly', false],
    // Still running when the client gave up: its outcome is unknown.
    [409, 'idempotency.requestInProgress', true],
    [409, 'idempotency.keyReusedWithDifferentPayload', false],
    [409, 'signupForms.unavailable', false],
    // A body over the route's limit is just as big the next time.
    [413, 'requestTooLarge', false],
    // Refused by the provider for good: it fails the same way every time.
    [422, 'emailSending.providerRejected', false],
    [429, 'tooManyRequests', true],
    [503, 'emailSending.sendFailed', true],
    [503, 'emailSending.sendHeld', true],
  ] as const)('%s %s: %s', (statusCode, code, expected) => {
    expect(new SendHeronError({ statusCode, code }).retryable).toBe(expected);
  });
});

/**
 * `kind` keeps the API's keys and the SDK's own transport codes apart, so a
 * caller never has to know which `code` values the SDK made up.
 */
describe('error.kind', () => {
  it.each(TRANSPORT_ERROR_CODES)('%s is a transport failure', (code) => {
    expect(new SendHeronError({ statusCode: null, code }).kind).toBe(
      'transport',
    );
  });

  it('an API key is an API refusal, whatever the status', () => {
    for (const [statusCode, code] of [
      [400, 'emailSending.tooManyRecipients'],
      [429, 'tooManyRequests'],
      [503, 'emailSending.sendFailed'],
    ] as const) {
      expect(new SendHeronError({ statusCode, code }).kind).toBe('api');
    }
  });

  it('the client says which it is, even for a code shaped like the other', () => {
    expect(
      new SendHeronError({ kind: 'api', statusCode: 400, code: 'timeout' })
        .kind,
    ).toBe('api');
  });
});
