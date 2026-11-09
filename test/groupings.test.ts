import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type EmailSendStatus,
  isHeld,
  isSenderSideBlock,
  RECIPIENT_BLOCK_REASONS,
  SCREENING_REASONS,
  SEND_BLOCK_REASONS,
  SEND_HOLD_REASONS,
  SENDER_SIDE_BLOCK_REASONS,
  SendHeronError,
  type SendHoldReason,
  type SendRecordResponse,
} from '../src/index.js';

/** An enum as the committed API document declares it, in its order. */
const specEnum = (schema: string, property: string): string[] => {
  const spec = JSON.parse(readFileSync('spec/openapi.json', 'utf8')) as {
    components: {
      schemas: Record<
        string,
        {
          properties: Record<
            string,
            { enum?: string[]; items?: { enum?: string[] } }
          >;
        }
      >;
    };
  };
  const value = spec.components.schemas[schema]?.properties[property];
  const values = value?.enum ?? value?.items?.enum;
  if (!values) throw new Error(`${schema}.${property} has no enum`);
  return values;
};

describe('block reason groupings', () => {
  it('lists exactly the block reasons the API answers', () => {
    // After a spec refresh, a reason the backend added fails this until it
    // is listed, and the partition below until it is classified.
    expect([...SEND_BLOCK_REASONS]).toEqual(
      specEnum('DroppedRecipientResponse', 'reason'),
    );
    expect([...SEND_BLOCK_REASONS]).toEqual(
      specEnum('ChannelDeliverabilityResponse', 'blockReason'),
    );
  });

  it('sender-side and recipient partitions cover the full reason list exactly', () => {
    // Grouping stays a deliberate decision: every reason is in exactly one.
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

  it('classifies ADDRESS_UNDELIVERABLE as recipient-side: drop the address', () => {
    // The address cannot receive email (a platform-wide hard bounce, or
    // the contact's screening). Nothing the sender fixes changes that.
    expect(RECIPIENT_BLOCK_REASONS).toContain('ADDRESS_UNDELIVERABLE');
    expect(SENDER_SIDE_BLOCK_REASONS).not.toContain('ADDRESS_UNDELIVERABLE');
    expect(isSenderSideBlock('ADDRESS_UNDELIVERABLE')).toBe(false);
  });
});

describe('address screening', () => {
  it('SCREENING_REASONS lists exactly the API screening reasons, most serious first', () => {
    // A contact's screeningReasons come sorted in this order.
    expect([...SCREENING_REASONS]).toEqual(
      specEnum('SuppressionCheckResponse', 'screeningReasons'),
    );
  });
});

describe('held sends', () => {
  type HoldFields = Pick<SendRecordResponse, 'status' | 'holdReason'>;

  it('SEND_HOLD_REASONS lists exactly the API hold reasons', () => {
    expect([...SEND_HOLD_REASONS]).toEqual(
      specEnum('SendRecordResponse', 'holdReason'),
    );
  });

  it('isHeld is true for a queued send with any known hold reason', () => {
    for (const holdReason of SEND_HOLD_REASONS) {
      expect(isHeld({ status: 'QUEUED', holdReason })).toBe(true);
    }
  });

  it('isHeld counts a reason this SDK does not know yet: it is waiting all the same', () => {
    expect(isHeld({ status: 'QUEUED', holdReason: 'SOME_FUTURE_HOLD' })).toBe(
      true,
    );
  });

  it('isHeld is false without a hold reason, and for every other status', () => {
    expect(isHeld({ status: 'QUEUED' })).toBe(false);
    expect(isHeld({ status: 'QUEUED', holdReason: null })).toBe(false);
    // Even with a reason still on it, kept from the 201 say: the send has
    // moved on, so nothing is waiting.
    const movedOn: EmailSendStatus[] = [
      'SENT',
      'DELIVERED',
      'OPENED',
      'CLICKED',
      'BOUNCED',
      'FAILED',
      'SUPPRESSED',
      'SCHEDULED',
      'CANCELLED',
    ];
    for (const status of movedOn) {
      expect(isHeld({ status, holdReason: 'PLATFORM_DAILY_LIMIT' })).toBe(
        false,
      );
    }
  });

  it('isHeld narrows holdReason, so no null is left to handle', () => {
    const record: HoldFields = {
      status: 'QUEUED',
      holdReason: 'WARMUP_SAMPLE',
    };
    if (!isHeld(record)) {
      throw new Error('expected a held send');
    }
    // Compile-time half of the test: this assignment type-checks only
    // because isHeld removed null.
    const reason: SendHoldReason = record.holdReason;
    expect(reason).toBe('WARMUP_SAMPLE');
  });
});

describe('error.retryable', () => {
  const error = (statusCode: number | null, code = 'x') =>
    new SendHeronError({ statusCode, code });

  it('is true for rate limits, 5xx, and transport failures', () => {
    expect(error(429, 'tooManyRequests').retryable).toBe(true);
    expect(error(500).retryable).toBe(true);
    expect(error(503).retryable).toBe(true);
    // Attachments could not wait for capacity: retry later with the same key.
    expect(error(503, 'emailSending.sendHeld').retryable).toBe(true);
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
