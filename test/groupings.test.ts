import { describe, expect, it } from 'vitest';
import {
  isSenderSideBlock,
  RECIPIENT_BLOCK_REASONS,
  SEND_BLOCK_REASONS,
  SENDER_SIDE_BLOCK_REASONS,
  SendHeronError,
} from '../src/index.js';

describe('block reason groupings', () => {
  it('sender-side and recipient partitions cover the full reason list exactly', () => {
    // If the backend grows another reason, this fails until the new reason
    // is classified: grouping stays a deliberate decision.
    const union = [...SENDER_SIDE_BLOCK_REASONS, ...RECIPIENT_BLOCK_REASONS];
    expect([...union].sort()).toEqual([...SEND_BLOCK_REASONS].sort());
    expect(new Set(union).size).toBe(SEND_BLOCK_REASONS.length);
  });

  it('isSenderSideBlock classifies, and defaults unknowns to recipient-side', () => {
    expect(isSenderSideBlock('SENDER_NOT_CONFIGURED')).toBe(true);
    expect(isSenderSideBlock('HARD_SUPPRESSED')).toBe(false);
    expect(isSenderSideBlock('SOME_FUTURE_REASON')).toBe(false);
    expect(isSenderSideBlock(null)).toBe(false);
    expect(isSenderSideBlock(undefined)).toBe(false);
  });

  it('classifies SENDER_UNDER_REVIEW as sender-side: the address is fine', () => {
    // Before 0.4.0 the SDK did not know it, so it defaulted to recipient-side:
    // an integrator following the groupings would drop a good address
    // because the account was not approved yet.
    expect(isSenderSideBlock('SENDER_UNDER_REVIEW')).toBe(true);
  });
});

describe('error.retryable', () => {
  const error = (statusCode: number | null, code = 'x') =>
    new SendHeronError({ statusCode, code });

  it('is true for rate limits, 5xx, and transport failures', () => {
    expect(error(429).retryable).toBe(true);
    expect(error(500).retryable).toBe(true);
    expect(error(503).retryable).toBe(true);
    expect(error(null, 'network_error').retryable).toBe(true);
    expect(error(null, 'timeout').retryable).toBe(true);
  });

  it('is false for request bugs and caller aborts', () => {
    expect(error(400).retryable).toBe(false);
    expect(error(403).retryable).toBe(false);
    expect(error(409).retryable).toBe(false);
    expect(error(null, 'aborted').retryable).toBe(false);
  });
});
