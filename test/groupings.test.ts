import { describe, expect, it } from 'vitest';
import {
  type EmailSendRecord,
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
    // The backend's ScreeningReason enum (email-automation-service #144).
    // A contact's screeningReasons come sorted in this order.
    expect([...SCREENING_REASONS]).toEqual([
      'INVALID_SYNTAX',
      'KNOWN_HARD_BOUNCE',
      'DOMAIN_NOT_FOUND',
      'NO_MAIL_SERVER',
      'DISPOSABLE_DOMAIN',
      'LIKELY_TYPO',
      'ROLE_ADDRESS',
      'SYSTEM_ADDRESS',
      'DNS_UNCHECKED',
    ]);
  });
});

describe('held sends', () => {
  type HoldFields = Pick<EmailSendRecord, 'status' | 'holdReason'>;

  it('SEND_HOLD_REASONS lists exactly the API hold reasons', () => {
    // The backend's SendHoldReason enum (email-automation-service #143,
    // and #144 for the import slices).
    expect([...SEND_HOLD_REASONS]).toEqual([
      'PLATFORM_DAILY_LIMIT',
      'ORGANIZATION_DAILY_SHARE',
      'EARNED_VOLUME',
      'WARMUP_SAMPLE',
      'WARMUP_SAMPLE_FAILED',
      'IMPORT_SAMPLE',
      'IMPORT_SAMPLE_FAILED',
    ]);
  });

  it('isHeld is true for a queued send with any known hold reason', () => {
    for (const holdReason of SEND_HOLD_REASONS) {
      expect(isHeld({ status: 'queued', holdReason })).toBe(true);
    }
  });

  it('isHeld counts a reason this SDK does not know yet: it is waiting all the same', () => {
    expect(isHeld({ status: 'queued', holdReason: 'SOME_FUTURE_HOLD' })).toBe(
      true,
    );
  });

  it('isHeld is false without a hold reason, and for every other status', () => {
    expect(isHeld({ status: 'queued' })).toBe(false);
    expect(isHeld({ status: 'queued', holdReason: null })).toBe(false);

    // Even with a reason still on it, kept from the 201 say: the send has
    // moved on, so nothing is waiting.
    const movedOn: EmailSendStatus[] = [
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'failed',
      'suppressed',
    ];
    for (const status of movedOn) {
      expect(isHeld({ status, holdReason: 'PLATFORM_DAILY_LIMIT' })).toBe(
        false,
      );
    }
  });

  it('isHeld narrows holdReason, so no null is left to handle', () => {
    const record: HoldFields = {
      status: 'queued',
      holdReason: 'WARMUP_SAMPLE',
    };
    if (!isHeld(record)) {
      throw new Error('expected a held send');
    }
    // Compile-time half of the test: this assignment type-checks only
    // because isHeld removed null and undefined.
    const reason: SendHoldReason = record.holdReason;
    expect(reason).toBe('WARMUP_SAMPLE');
  });
});

describe('error.retryable', () => {
  const error = (statusCode: number | null, code = 'x') =>
    new SendHeronError({ statusCode, code });

  it('is true for rate limits, 5xx, and transport failures', () => {
    expect(error(429).retryable).toBe(true);
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
