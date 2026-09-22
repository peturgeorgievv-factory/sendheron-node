# Changelog

## 0.3.0

Additive: every field that existed keeps its shape.

- `usage.get()` now reports the plan's trial and lapse position:
  `plan.trialEndsAt` (ISO-8601 while a trial is running, null once the plan
  is paid or when there is no trial) and `plan.lapsedReason`
  (`NEVER_SUBSCRIBED`, `TRIAL_EXPIRED`, `PAYMENT_FAILED` or `CANCELED`, null
  for every other status), exported as the `LapsedReason` type. Read these
  instead of learning that a trial ended, or that a card failed, from a send
  being refused. This matters more than it did: the API no longer extends the
  transactional grace to an organization that never paid, so a lapsed trial
  reports a pool of 0 and refuses transactional sends outright rather than
  capping them.
- `usage.get()` now reports `contacts { subscribed, cap, remaining }`: the
  plan's contact cap, which counts SUBSCRIBED contacts only. `cap` and
  `remaining` are null without an active subscription cap, and `cap` is 0
  when the plan is LAPSED.

## 0.2.0

- `error.retryable`: whether retrying the same request (same idempotency
  key) later is sensible. Job runners should fail-permanently when false.
- `SENDER_SIDE_BLOCK_REASONS`, `RECIPIENT_BLOCK_REASONS` and
  `isSenderSideBlock(reason)`: the sender-vs-recipient split of suppression
  reasons, exported so consumers stop hand-rolling the set. Sender-side
  reasons are your configuration to fix and alert on; recipient-side
  reasons are facts, never retried. A partition test forces every future
  reason to be classified deliberately.

## 0.1.0

Initial release. The migration surface of the SendHeron API:

- `emails`: send, sendTemplate, sendBulk, get, cancelScheduled
- `templates`: list, get, create, update, remove, preview, validate
- `suppressions`: list, check, add, remove
- `usage`: get

Defaults that differ from most email SDKs, on purpose:

- automatic retries (429 honoring Retry-After; 5xx/network with backoff)
- auto-generated idempotency keys on email sends, stable across retries
- typed send outcomes: `status: 'sent' | 'suppressed'` with the exported
  block-reason list, because a 201 is an outcome, not proof of dispatch
- `{ data, error }` results; API failures are never thrown
