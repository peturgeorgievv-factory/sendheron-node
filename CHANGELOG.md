# Changelog

## 0.7.0

Additive: every field that existed keeps its shape.

From 2026-10-16 the API protects its shared 24-hour sending quota and warms
up new senders, so a send can wait instead of going out at once:

- A send route's `201` can be `status: 'queued'` with a `holdReason`: a
  held send. It is waiting, not failed, and goes out by itself on the same
  record, which `emails.get(id)` reads back. Never retry it: a new
  idempotency key would send it twice, and the same key replays the held
  response. `isHeld(record)` tests for it, status `queued` with any
  `holdReason`, including one this version does not know yet.
- `EmailSendRecord` gains `holdReason`, `heldUntil` and
  `warmupFirstContact`. `holdReason` is one of `SEND_HOLD_REASONS`
  (exported with the `SendHoldReason` type): `PLATFORM_DAILY_LIMIT`,
  `ORGANIZATION_DAILY_SHARE`, `EARNED_VOLUME`, `WARMUP_SAMPLE` or
  `WARMUP_SAMPLE_FAILED`. `heldUntil` is when it is next tried, ISO-8601,
  and it can be held again then. Both are null or absent on a send that is
  not waiting. `warmupFirstContact` is always present: true when the send
  counted in a new sender's warm-up slice, an address the organization had
  never mailed.
- A send with attachments cannot wait, because attachments are never
  stored: where it would, it answers `503` with `error.code`
  `emailSending.sendHeld`. It is retryable like a provider `503`: the SDK
  retries it with the same idempotency key, and after that so can you, with
  `error.idempotencyKey`.
- `usage.get()` gains `sending`, the rolling 24-hour position on the shared
  quota (`last24Hours`, `transactionalLast24Hours`, `share`,
  `earnedVolume`, `marketingRemaining`, `platformMarketingHeld`, `held`)
  and the warm-up (`warmup.status` `WARMING`, `HELD` or `COMPLETE`,
  `completedAt`, `sampleSize`, `heldStreams`), exported as the
  `SendingCapacityUsage`, `WarmupUsage` and `WarmupStatus` types. It can be
  null.

Earlier versions receive the same held record with the new fields untyped:
code that treats every `201` other than `sent` as a failure would retry a
held send and, with a new key, send it twice. Branch on
`status === 'queued'`, or upgrade and use `isHeld`.

Doc comments now also say that a templated send that was suppressed, or is
still held, records its subject unrendered, and that a `failed` record's
`errorMessage` carries the hold reason of a send with attachments that
could not wait.

## 0.6.0

Additive: every field that existed keeps its shape.

- `EmailSendRecord` gains `machineOpenCount`, `machineClickCount` and
  `unconfirmedOpenCount`, on every send response and on `emails.get()`.
  Like `openCount`, they are always present and start at 0. Security
  scanners, link checkers and HEAD or prefetch requests count in the two
  machine counters, and Apple Mail Privacy Protection pixel fetches, opens
  nobody can confirm, in `unconfirmedOpenCount`.
- From 2026-10-15, when the API began separating machines from people,
  `openCount`, `clickCount`, the first and last opened and clicked
  timestamps, and the `opened` and `clicked` statuses count people only.
  Engagement recorded before then was not reclassified and still includes
  machines, so open and click figures step down from that date, most for
  recipients behind corporate security gateways. Counts land 5 to 15 s
  after the open or click.
- A send that only machines touched, a privacy proxy included, now reads
  `delivered`, not `opened` or `clicked`: their events still prove
  delivery, but only a person opens or clicks.

The API also changed underneath the SDK on 2026-10-14, with no code or type
change here, in ways an integration can observe:

- `suppressions.check()` validates the address: a malformed or empty one
  now resolves to a 400 error instead of a verdict. It is the rule
  `emails.send()` and `emails.sendTemplate()` already apply to `to`, so no
  address a send would accept is refused.
- A record that belongs to another workspace of your organization answers
  404, never 403, as the API reference always documented, so the API no
  longer confirms that it exists. In this SDK, `templates.update()` and
  `templates.remove()` answered 403 before.
- A paused sequence now stops advancing its enrolled contacts, keeping
  each where it stands until it is resumed. It refuses new enrollments
  (400 `sequences.sequenceNotActive`), as it always has.
- `PUT /api/v1/contacts/{id}` merges `properties` into the stored ones,
  like the upsert, instead of replacing them, as the API reference always
  said: setting one key no longer wipes the others.
- Idempotency keys are scoped to the API key's workspace and the endpoint.
  That is not new, but the API reference used to say organization: the
  same key sent from two workspaces is two separate requests.

Doc comments now match the API: what `suppressions.check()` evaluates
(sender configuration, list opt-outs and an archived workspace only on a
real send), who a sandboxed organization reaches (verified members, not
every team member), and what `from`, `contactId`, `sampleData` and
`sendToAll` do.

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
