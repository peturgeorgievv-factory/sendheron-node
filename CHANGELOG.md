# Changelog

## 0.5.0

Additive: every field that existed keeps its shape.

- `usage.get()` now reports every plan cap, not only contacts: `domains`,
  `workspaces` and `teamMembers`, each `{ used, cap, remaining }`, exported
  as the `CountUsage` type. `cap` and `remaining` are null without an active
  subscription cap and 0 when the plan is LAPSED; `remaining` never goes
  below 0, so `used` can sit above `cap`. `domains` counts each sending
  domain once across the organization, in any verification state, and a
  running trial can lower its cap. `workspaces` counts live workspaces only,
  and its `cap` can be a per-organization override rather than the plan's.
  `teamMembers` counts pending invitations, since an invitation holds a
  seat. Read them to show the headroom before an add is refused.

## 0.4.0

Additive: every field that existed keeps its shape.

- `SENDER_UNDER_REVIEW` joins `SEND_BLOCK_REASONS`, classified sender-side
  (`SENDER_SIDE_BLOCK_REASONS`, `isSenderSideBlock`). The API now holds every
  new organization in a review sandbox until it is approved as a sender:
  until then, a send to any address outside its own verified domains and
  team members is suppressed with this reason, on every endpoint,
  transactional included. Earlier versions do not know the reason, so
  `isSenderSideBlock` returns false for it and code following the groupings
  treats a good address as a recipient-side fact. The reaction is to request
  approval, never to drop the address. A `switch` that exhaustively handles
  `SendBlockReason` needs a case for it.
- `usage.get()` now reports `plan.sendingReview`: `SANDBOX` (no review
  requested yet), `REQUESTED` (asked for, not approved yet) or `APPROVED`
  (the sandbox is lifted), never null, exported as the `SendingReviewStatus`
  type. Read it to learn the account is still sandboxed instead of
  discovering it from a refused send. Organizations that existed before the
  sandbox report `APPROVED`.
- `suppressions.check()` can now answer with a sender-side `blockReason`:
  the API's address check runs the organization gate too, so
  `SENDER_UNDER_REVIEW` or `ORG_SENDING_PAUSED` can come back for an address
  that is itself fine.

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
