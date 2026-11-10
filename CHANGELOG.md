# Changelog

## 1.0.1

Nothing in the SDK changed: every type and every call is what 1.0.0
shipped, so upgrading needs no code change.

API changes from later on 2026-11-09 (backend #181):

- The API no longer reads the old lowercase spelling of an enum value: the
  grace 1.0.0 described ended the same day. A lowercase `reason` in
  `suppressions.add()` or `suppressions.list()` is now a `400`
  `validationFailed` naming the allowed values, where the API used to
  correct it. The SDK's types allow only the uppercase spelling, so typed
  code never sent a lowercase one.
- On routes the SDK does not wrap:
  `POST /api/v1/sequences/{id}/enrollments/bulk` names why it skipped a
  contact in `errors[].reason`, one of `CONTACT_NOT_FOUND`,
  `ALREADY_ENROLLED` and `CONTACT_SUPPRESSED`, in place of the sentence in
  `errors[].message`. A list rule or a sequence condition on a contact's
  `status`, `source` or `screeningVerdict` must carry one of that field's
  values, and a sequence trigger's `source` filter one of the `source`
  values: anything else is a `400`, `lists.invalidRuleValue` or
  `sequences.invalidStepConfig`.

`spec/openapi.json` is the live document.

## 1.0.0

The cleaned-up REST contract (backend #178), and the SDK's own breaks in
the same major. The API changed on 2026-11-09, and 0.13.x reads its
statuses, lists and errors wrongly, so upgrade.

To upgrade:

- Compare statuses and reasons in UPPER_SNAKE: `data.status === 'SENT'`,
  `'SUPPRESSED'` or `'QUEUED'`, `suppressions.add({ reason: 'MANUAL' })`,
  and a signup's `{ status: 'ACCEPTED' }`.
- Rename the types in the table below; TypeScript points at every use.
- Pass `variables`, not `sampleData`, to `emails.sendBulk()` and
  `templates.preview()`.
- Call `suppressions.remove(email)` without a body; every delete answers
  `{ deleted: true }`.
- Branch on `error.code === 'tooManyRequests'` where you had
  `'rate_limited'`, and on `error.kind` to tell the API's keys from the
  SDK's own codes.

API changes from 2026-11-09:

- Every state and reason is UPPER_SNAKE: the send `status` (`QUEUED`,
  `SENT`, `DELIVERED`, `OPENED`, `CLICKED`, `BOUNCED`, `FAILED`,
  `SUPPRESSED`, plus `SCHEDULED` and `CANCELLED`), a suppression's `reason`
  (`MANUAL`, `ONE_CLICK`, `COMPLAINT`, `BOUNCE`, `ADMIN`), a contact's
  status and the signup answer. The API still reads the old lowercase
  spelling on input for one release; the SDK sends uppercase. An
  attachment's `disposition` keeps `attachment`.
- Every response is a declared shape: every field present, `null` when
  empty, never absent. Gone from the wire: `organizationId` everywhere, and
  on the send record `provider`, `warmupFirstContact`, `contactImportId` and
  `signupFormId`. New on it: `channel`, `batchId` and `scheduledAt`.
  Suppression rows carry `tier`, and a template carries its `tags` as
  `{ id, name, color }`.
- Every list answers one envelope, `{ data, totalCount, page, limit,
  hasNextPage }`: `page` is the zero-based page asked for, counts are never
  null, and `limit` defaults to 50 and stops at 100.
- Every delete answers `{ deleted: true }` and takes no body:
  `DELETE /api/v1/suppressions/{email}` lost its `note`.
- A scheduled send answers the same send record, with `status: 'SCHEDULED'`
  and `scheduledAt`, and `emails.get()` reads it. `emails.cancelScheduled()`
  answers `{ deleted: true }`, and the record reads `CANCELLED`.
- `sampleData` is `variables` on `POST /api/v1/emails/send-bulk` and
  `POST /api/v1/templates/preview`. A bulk send naming more than one of
  `listId`, `contactIds` and `sendToAll` is a `400`
  `emailSending.oneAudienceSelector`.
- A `429` is a refusal like every other: `message` is `tooManyRequests`,
  the sentence is in `description`, and `Retry-After` is as before. A
  malformed id is a `400` `invalidUUID` on every route, and the
  idempotency key counts on the three send routes only.
- Routes the SDK does not wrap changed too: sending domains and identities
  answer the list envelope, and the bulk removals are
  `POST /api/v1/sequences/{id}/enrollments/bulk-remove` and
  `POST /api/v1/lists/{id}/contacts/bulk-remove`, answering
  `{ removedIds, notFoundIds }`.

SDK changes:

- Every request and response type is generated from the API document
  (`scripts/gen-types.mjs` writes `src/generated.ts`), named as the
  document names it, and the hand-written ones are gone. The enum types
  (`EmailSendStatus`, `SendBlockReason`, `SendHoldReason` and the rest)
  read their values from it.
- `error.kind` is `'api'` or `'transport'`, and `TRANSPORT_ERROR_CODES`
  lists the SDK's own codes: `network_error`, `timeout`, `aborted` and
  `invalid_response`.
- `error.description` is the API's sentence or nothing, never the HTTP
  status name.
- An empty 2xx body is an `invalid_response` error, never `data: null`, and
  so is an error body without the API's key, which read as
  `unknown_error`.
- A `429` carries the API's own `tooManyRequests`: `rate_limited` is gone.
- The idempotency key goes on the three send routes only, a key you pass
  included.
- `emails.send()` and `emails.sendTemplate()` lost their scheduled
  overloads: both answer `SendRecordResponse`.
- `templates.list()` takes `tagIds`, sent as the parameter repeated.

| 0.13 | 1.0 |
| --- | --- |
| `EmailSendRecord`, `ScheduledEmail` | `SendRecordResponse` |
| `ScheduledEmailStatus` | `EmailSendStatus` |
| `DroppedRecipient` | `DroppedRecipientResponse` |
| `Attachment` | `EmailAttachmentRequest` |
| `SendBulkPayload`, `SendBulkResult` | `SendBulkEmailRequest`, `BulkSendResponse` |
| `Template`, `TemplatePreview` | `TemplateResponse`, `TemplatePreviewResponse` |
| `CreateTemplatePayload`, `UpdateTemplatePayload`, `PreviewTemplatePayload` | `CreateTemplateRequest`, `UpdateTemplateRequest`, `PreviewTemplateRequest` |
| `SuppressionEntry` | `SuppressionEntryResponse` |
| `EmailDeliverability`, `ChannelDeliverability` | `SuppressionCheckResponse`, `ChannelDeliverabilityResponse` |
| `FormSignupPayload`, `FormSignupAccepted` | `CreateFormSignupRequest`, `FormSignupAcceptedResponse` |
| `OrganizationUsage` | `UsageResponse` |
| `CountUsage`, `SendingCapacityUsage`, `WarmupUsage`, `SignupFormsUsage` | the same names ending in `Response` |
| `PaginatedResult<T>` | `PaginatedResponse<T>` |

The README and the doc comments say so. The tests pin `kind`, the `429`
and the empty body, hold the block, hold and screening reason lists to the
document, and pin every method to its route at compile time.
`spec/openapi.json` is the live document.

## 0.13.1

Docs: the From address description matches the API (a key never takes
another workspace's domain).

## 0.13.0

Suppressions per workspace (backend #174). Breaking: `confirmHardTier`
removed from the unsuppress request; a bounce or complaint suppression is
lifted in the dashboard only, and a key never reaches beyond its workspace
(backend #176).

To upgrade, drop `confirmHardTier` from `suppressions.remove()` calls: the
type no longer has it, and the API ignores it. Nothing else in the SDK's
behavior or types changes. API changes from 2026-11-08:

- `suppressions.list()` returns the key's workspace's view: its own
  opt-outs, and the organization's bounces and complaints for addresses
  the workspace has as contacts or has sent to. It used to return every
  bounce and complaint in the organization. The CSV export
  (`GET /api/v1/suppressions/export`, which the SDK does not wrap) returns
  the same view.
- `suppressions.remove()` lifts this workspace's own opt-outs. A bounce or
  complaint blocks every workspace of the account and is lifted by the
  account owner in the dashboard, not through the API. It used to lift
  one with `confirmHardTier: true`. Now an address that bounced or
  complained gets a `403` `compliance.organizationWideSuppressionOwnerOnly`
  whatever the key, even when it also has an opt-out of this workspace,
  and `error.retryable` is false. The `400`
  `compliance.hardSuppressionRequiresConfirm` no longer happens.
- Adding a sending domain (`POST /api/v1/sending/domains`, which the SDK
  does not wrap) returns the ownership challenge record for every domain,
  even one another workspace of the account has verified. The response
  shape is unchanged.
- Sender identities (`/api/v1/sending/identities`, which the SDK does not
  wrap) report `sendability` as `SENDABLE`, `DOMAIN_PENDING` or
  `DOMAIN_UNVERIFIED`, never `DOMAIN_VERIFIED_ELSEWHERE`. A domain another
  workspace verified reads `DOMAIN_UNVERIFIED`, and creating an identity on
  it, or moving one to it, is refused with a `400`
  `emailConfig.domainNotInWorkspace` until the workspace adds the domain.

The README and the doc comments say so, the tests pin `retryable` for the
`403`, and `spec/openapi.json` carries the API's new descriptions, the
`403`, and the unsuppress body without `confirmHardTier`.

## 0.12.1

Nothing changes in the SDK's behavior or types. API changes from
2026-11-07:

- A `422` `emailSending.providerRejected` from `emails.send()` or
  `emails.sendTemplate()` says in SendHeron's words what was refused.
  `error.description` names the sender, a recipient address, a header, an
  attachment or the size, or says the message cannot be sent as it is,
  where it carried the provider's error name or wording. The failed send
  record keeps the same sentence in `errorMessage`. A `422` is still final:
  never retried, and `error.retryable` is false.
- An attachment whose file name ends in an extension SES refuses (`.exe`,
  `.bat`, `.js`, `.msi` and the rest of SES's list, in any case) is
  answered with a `400` `emailSending.attachmentTypeNotAllowed`, the error a
  disallowed content type gets, before anything is sent or recorded. It
  used to reach SES and come back as a `422`. `error.retryable` is false.
- A request body over a route's limit is a `413` `requestTooLarge`, and
  `error.retryable` is false. The email routes take up to 15 MB.
- Error text is always SendHeron's own: nothing the email provider, a
  receiving mail server, the database or the framework wrote reaches
  `error.code` or `error.description`, nor the `errorMessage` of a send
  record written from then on. A `failed` record holds SendHeron's sentence
  or a key such as `emailSending.sendFailed`, and a `bounced` one a
  sentence for the kind of bounce where it held the receiving server's
  diagnostic. A send SES refused from its own suppression list is
  `suppressed` with `HARD_SUPPRESSED`. An error SendHeron did not raise
  carries only its status and a key such as `badRequest` or
  `internalServerError`, and a NUL byte in a field is a `400` `badRequest`
  where it was a `500`.

The README and the doc comments say so, the tests use SendHeron's wording
and pin `retryable` for a `413`, and `spec/openapi.json` carries the API's
new descriptions.

## 0.12.0

Every field that existed keeps its shape. Two behaviors change, both to
follow the API: a `503` now waits as long as its `Retry-After` says, and
`error.retryable` is true for a `409` `idempotency.requestInProgress`.

From 2026-11-06 the send routes (`emails.send()` and
`emails.sendTemplate()`) tell a refusal that can never succeed apart from
one that may pass:

- A message the provider refused for good (SES `MessageRejected`, an
  unverified MAIL FROM domain, any other refusal of the message itself) is
  a `422` `emailSending.providerRejected`, with the provider's error name in
  `error.description`. It was a `503` `emailSending.sendFailed`, which the
  SDK retried and a job runner following `error.retryable` retried forever.
  `retryable` is false and the SDK never retries it: sending it again fails
  the same way. The failed attempt is still recorded.
- The API's send `503`s carry `Retry-After`: 30 seconds when the provider
  is throttling or failing, 300 when the sending account cannot send, and
  for `emailSending.sendHeld` the time until the hold lifts, which can be
  hours. The SDK now honors it as it does on a `429`. A wait of 30 seconds
  or less is slept, then retried with the same idempotency key. A longer
  one comes back at once with `error.retryAfterSeconds`, for a queue to
  reschedule. A `503` without the header still backs off exponentially.
  Before, every keyed `503` was retried within about a second, even a hold
  with hours to run.
- `error.retryable` is now true for a `409` `idempotency.requestInProgress`.
  The SDK already retried it, but when the request with that key was still
  running after the retries ran out (a client timeout during a slow send,
  for instance), it reported false. A job runner following it then
  dead-lettered a send whose outcome was unknown, often one that had gone
  out. Retry later with `error.idempotencyKey`: you get the original's
  response once it has finished. Since 2026-11-06 a key still in progress
  10 minutes after it was claimed is taken over by the next retry, instead
  of answering `409` until it expires.
- The send record gains `droppedRecipients`: the cc and bcc addresses the
  compliance gate refused, each `{ email, reason }` with a
  `SendBlockReason`. The message went to everyone else without them. It is
  null or absent when none was dropped; a held send's copies are checked
  when it goes out. New export: the `DroppedRecipient` type.
- New `400`s, refused before anything is recorded, where the provider used
  to refuse them as a `503` after the attempt was: more than 50 recipients
  in total, `to` included (`emailSending.tooManyRecipients`, also when
  scheduling), and custom headers SES would refuse: a value outside
  printable ASCII (`emailSending.invalidHeaderValue`), a name over 126
  characters (`emailSending.invalidHeaderName`), and a value over 995
  characters or a name and value over 996 together
  (`emailSending.headerValueTooLong`).
- A send with no display name, neither `fromName` nor one on the sender
  identity, now goes out from the bare address instead of under a
  SendHeron default name. A name in any script is encoded for the header.

The README gains an Errors table: each send error, what it means, and
whether it is `retryable`. `spec/openapi.json` now includes the `422`, the
`400` and the new descriptions. No suppression or hold reason was added.

## 0.11.0

Additive: every field that existed keeps its shape, and every call that
worked before works the same way.

From 2026-11-05 the API takes signups through a signup form from your own
server, under a new API key scope:

- `forms.signup(formId, payload)` calls
  `POST /api/v1/forms/{formId}/signups` with `{ email, ipAddress }`, plus
  `firstName`, `lastName` and `userAgent` when you have them, and resolves
  to `{ status: 'accepted' }` (a `202`). The answer is the same for every
  address, so it tells nobody whether an address is subscribed. Call it
  from your server, never the browser: the key is a secret. The signup is
  always double opt-in, whatever the form's own setting: the person joins
  the form's list only once they confirm.
- `ipAddress` must be the visitor's real address: behind Cloudflare the
  `CF-Connecting-IP` header, never an `X-Forwarded-For` value the visitor
  can write. It is kept on the consent record and counted toward the
  per-visitor limit.
- Limits: 30 a minute per key, hourly and daily ceilings per key, and a
  per-visitor limit on the IP address you report, each a `429` with
  `Retry-After`. Refusals: `400` `signupForms.invalidEmail`,
  `signupForms.undeliverableEmail` or `signupForms.fieldRequired`, `404`
  `signupForms.notFound`, and `409` `signupForms.unavailable` when the form
  takes no signups, with the reason in `error.description`.
- The route needs the new `signups:create` scope. A key that holds only
  that scope can do nothing else, so give your website's server code that
  key.
- New exports: the `FormSignupPayload` and `FormSignupAccepted` types.

From 2026-11-06 `usage.get()` gains `signupForms`, never null. It is the
one workspace-scoped block, since forms and their cap are per workspace:
`forms` (`used`, `cap`, `remaining`; the cap is the same on every plan, so
neither is null here), `pendingSignups` waiting for their confirmation
click, `confirmedLast30Days` (signups that became subscribed contacts) and
`underAttack` (forms held to a trickle right now, every signup double
opt-in). It is exported as the `SignupFormsUsage` type.

`spec/openapi.json` now includes the route, the scope and the new usage
description. No suppression or hold reason was added.

The package is now built with tsup 9 and TypeScript 6. Its JavaScript is
byte-identical to a build with the previous toolchain. The type declarations
end in an `export type { ... }` list instead of inline `type` markers: the
same names, meaning the same thing.

## 0.10.0

Nothing in the SDK changed: every type and every call is what 0.9.0
shipped, so upgrading needs no code change.

On 2026-10-27 the API gained 14 routes, all additive and all on resources
this SDK does not wrap yet, and `spec/openapi.json` now includes them:

- Lists, a new resource for static lists and dynamic segments: `GET` and
  `POST /api/v1/lists`, `GET`, `PATCH` and `DELETE /api/v1/lists/{id}`, and
  `GET`, `POST` and `DELETE /api/v1/lists/{id}/contacts`.
- Tags by id: `GET`, `PATCH` and `DELETE /api/v1/tags/{id}`.
- The sequence lifecycle: `POST /api/v1/sequences` creates a sequence in
  `DRAFT`, `PATCH /api/v1/sequences/{id}` renames a draft or paused one or
  changes its trigger, and `DELETE /api/v1/sequences/{id}` deletes one.

No existing operation changed, and no suppression or hold reason was added.
Until the SDK wraps these resources, each is one documented HTTP call away.

## 0.9.0

Additive: every field that existed keeps its shape, and every call that
worked before works the same way.

From 2026-10-18 templates can carry preview text, the line inboxes show
after the subject. Every send of the template carries it as a hidden
preheader at the top of the body; it is never stored in `bodyHtml`.

- `Template` gains `previewText` on every template response (`get`,
  `list`, `create`, `update`): a string, or null when the template has
  none.
- `templates.create()` and `templates.update()` take `previewText`. It
  supports merge tags, whitespace collapses to one line, and blank means
  none. On update, null or an empty string removes it and leaving it out
  keeps it. Over 200 characters, merge tags counted as written, it is a
  400 `templates.previewTextTooLong`: refused, never truncated.
- `templates.preview()` takes `subject` and `previewText` and returns
  `renderedSubject` and `renderedPreviewText`, rendered with `sampleData`
  and null when there is none. The preview text is also placed in
  `renderedHtml` as the hidden preheader. Over 200 characters it is the
  same 400.
- `templates.validate(document, previewText)` checks a block document with
  the preview text it will carry: the preheader counts toward the size
  limit, and past 200 characters the text comes back as an issue, not a
  400. `validate(document)` and `validate(document, options)` work as
  before.

A template without preview text sends exactly what it sent before. Adding
preview text can push a builder document at the edge of the size limit
over it: `create()` and `update()` then answer 400
`templates.invalidDocument`, and `validate(document, previewText)` reports
it first.

## 0.8.0

Additive: every field that existed keeps its shape.

From 2026-10-17 the API screens contact addresses and keeps a
platform-wide list of addresses that do not exist:

- A send can be suppressed with a new reason, `ADDRESS_UNDELIVERABLE`: the
  address cannot receive email. It is on the platform-wide list of
  addresses that hard-bounced as nonexistent, so a bounce in one
  organization stops every organization's next send to it, or the
  contact's screening found it undeliverable. It blocks every stream,
  transactional included. It joins `SEND_BLOCK_REASONS` and
  `RECIPIENT_BLOCK_REASONS`, and `isSenderSideBlock` returns false for it:
  drop the address, never retry.
- `suppressions.check()` gains `knownHardBounce`, always a boolean, and the
  matching contact's screening: `screeningVerdict` (`VALID`, `RISKY`,
  `UNDELIVERABLE` or `UNCHECKED`, null without a screened contact),
  `screeningReasons` (never null, empty without one) and `suggestedEmail`
  (the address with a likely typo fixed, or null). New exports:
  `SCREENING_REASONS` with the `ScreeningReason` type, most serious first,
  and the `ScreeningVerdict` type. Only `UNDELIVERABLE` stops mail, and
  one that rests on DNS alone only for a day after the check.
- The first email to each contact imported from a list whose people were
  last mailed over a year ago goes out in checked slices of that import,
  even once the sender's own warm-up is over. `SEND_HOLD_REASONS` gains
  `IMPORT_SAMPLE` (the send waits for the import's next slice) and
  `IMPORT_SAMPLE_FAILED` (a slice bounced or drew complaints past the line,
  so the rest of the import waits until a person at SendHeron has looked
  at it). `isHeld` already counted both, as it counts any hold reason.
- `EmailSendRecord` gains `contactImportId`: the import whose checked slice
  the send belongs to, or waits for. Null or absent on every other send.

Earlier versions receive the new values untyped and still take the safe
direction: `isSenderSideBlock('ADDRESS_UNDELIVERABLE')` was already false,
since unknown reasons count as recipient-side, and `isHeld` is true for the
import holds.

The API also screens every contact it creates or upserts, a surface this
SDK does not wrap yet: an address with valid syntax is never refused for
screening, and an `UNDELIVERABLE` contact is created, takes no seat on the
plan, and every send to it is suppressed with `ADDRESS_UNDELIVERABLE`.

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
