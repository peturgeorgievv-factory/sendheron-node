import { describe, expect, it } from 'vitest';
import { SendHeronError } from '../src/index.js';

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
    // A bounce or complaint reaches every workspace: only a key the owner
    // created lifts one.
    [403, 'compliance.organizationWideSuppressionOwnerOnly', false],
    // Still running when the client gave up: its outcome is unknown.
    [409, 'idempotency.requestInProgress', true],
    [409, 'idempotency.keyReusedWithDifferentPayload', false],
    [409, 'signupForms.unavailable', false],
    // A body over the route's limit is just as big the next time.
    [413, 'requestTooLarge', false],
    // Refused by the provider for good: it fails the same way every time.
    [422, 'emailSending.providerRejected', false],
    [429, 'rate_limited', true],
    [503, 'emailSending.sendFailed', true],
    [503, 'emailSending.sendHeld', true],
  ] as const)('%s %s: %s', (statusCode, code, expected) => {
    expect(new SendHeronError({ statusCode, code }).retryable).toBe(expected);
  });
});
