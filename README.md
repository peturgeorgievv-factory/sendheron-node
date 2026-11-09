# sendheron

TypeScript SDK for the [SendHeron](https://sendheron.com) email API: typed
send outcomes, automatic retries, and idempotency by default.

```bash
npm install sendheron
```

## Quickstart

```ts
import { SendHeron } from 'sendheron';

const sendheron = new SendHeron(process.env.SENDHERON_API_KEY);

const { data, error } = await sendheron.emails.sendTemplate({
  to: 'user@example.com',
  templateId: '550e8400-e29b-41d4-a716-446655440000',
  variables: { orderId: '42' },
});

if (error) throw error;

if (data.status === 'SUPPRESSED') {
  // Refused by the compliance gate: data.errorMessage says why. Never retry.
} else if (data.status === 'QUEUED') {
  // Waiting for daily capacity or warm-up (data.holdReason): it goes out by
  // itself on this record. Never retry.
} else {
  console.log(data.id, data.status, data.providerMessageId); // SENT
}
```

## The one thing to know: a 201 is an outcome, not proof of dispatch

SendHeron records *why* mail did not go out instead of pretending it did. The
SDK types that contract so you cannot misread it:

```ts
const { data, error } = await sendheron.emails.send({
  to: 'user@example.com',
  subject: 'Your receipt',
  html: '<p>…</p>',
  attachments: [
    { content: base64Pdf, filename: 'receipt-42.pdf', type: 'application/pdf' },
  ],
});

if (error) {
  // The SDK already retried per its policy before handing you this.
  // error.retryable: send it again later with error.idempotencyKey, after
  // error.retryAfterSeconds when set. A 503 'emailSending.sendHeld' is
  // one: the send would have had to wait (daily capacity or warm-up),
  // which a send with attachments cannot do. Otherwise it is final: a 4xx
  // request bug (error.code is a stable key), or a 422
  // 'emailSending.providerRejected', a message the provider refused for
  // good. See Errors below.
  throw error;
}

switch (data.status) {
  case 'SENT':
    // Accepted by the provider. Persist data.id (readable back via
    // emails.get) and data.providerMessageId. data.droppedRecipients
    // lists any cc or bcc the compliance gate refused: it went without them.
    break;
  case 'SUPPRESSED':
    // The compliance gate refused: data.errorMessage is a stable reason
    // (e.g. 'HARD_SUPPRESSED'). NEVER retry these; surface them.
    break;
}
```

Statuses are UPPER_SNAKE, like the API's other states and reasons:
`QUEUED`, `SENT`, `DELIVERED`, `OPENED`, `CLICKED`, `BOUNCED`, `FAILED` and
`SUPPRESSED`, plus `SCHEDULED` and `CANCELLED` for a send with `sendAt`.

`SEND_BLOCK_REASONS` exports every suppression reason as a typed list, and
`isSenderSideBlock(reason)` splits them: sender-side reasons
(`SENDER_SIDE_BLOCK_REASONS`) are your own setup or account state, to fix and
alert on; recipient-side ones (`RECIPIENT_BLOCK_REASONS`) are facts about the
address.

`SENDER_UNDER_REVIEW` is sender-side. A new organization stays in a review
sandbox until it is approved as a sender: until then, a send to any address
outside its own verified domains and its verified members (members who
confirmed their email address) is suppressed with this reason, on every
endpoint, transactional included. The address is fine, so do not drop it,
and retrying does nothing until approval. Check
`plan.sendingReview` on `usage.get()` (`SANDBOX`, `REQUESTED` or
`APPROVED`), and have the organization owner request approval from the
dashboard. Sends refused before approval are not replayed afterwards: send
them again, with a new idempotency key if you pass your own, since a reused
key can replay the recorded refusal.

`ADDRESS_UNDELIVERABLE` is recipient-side: the address cannot receive
email. Either it is on the platform-wide list of addresses that
hard-bounced as nonexistent, so a bounce in one organization stops every
organization's next send to it, or the contact's screening found it
undeliverable (not an address, no such domain, or a domain that takes no
mail). It blocks every stream, transactional included. Drop the address
and never retry it.

`suppressions.check()` shows this before you send. `knownHardBounce` is
true for an address on that list, and `screeningVerdict` (`VALID`,
`RISKY`, `UNDELIVERABLE` or `UNCHECKED`), `screeningReasons`
(`SCREENING_REASONS`, most serious first) and `suggestedEmail` (a likely
typo, fixed) repeat the screening of the matching contact. Without a
screened contact they read null, an empty list and null. Only
`UNDELIVERABLE` stops mail. `RISKY` (a throwaway domain, a likely typo, a
role or system mailbox) and `UNCHECKED` (DNS did not answer in time) stay
mailable.

A send can also wait. Mail leaves through one shared sending account with a
rolling 24-hour quota, and new senders warm up, so a send over a daily line,
or to an address a warming organization has never mailed, can answer
`status: 'QUEUED'` with the reason in `holdReason` (`SEND_HOLD_REASONS`) and
the next attempt in `heldUntil`. That is waiting, not failing: it goes out
by itself, on the same record, and `emails.get(id)` reads its outcome once
it has gone. `isHeld(record)` tells you which case you have:

```ts
import { isHeld } from 'sendheron';

if (isHeld(data)) {
  // NEVER retry it: a new idempotency key would send it twice, and the
  // same key only replays this held response.
  console.log(`held (${data.holdReason}) until ${data.heldUntil}`);
}
```

Old lists warm up too. For contacts imported from a list whose people were
last mailed over a year ago, the first email to each goes out in checked
slices of that import, even once the sender's own warm-up is over
(`IMPORT_SAMPLE`). When a slice bounces or draws complaints past the line,
the rest of that import waits until SendHeron has looked at it
(`IMPORT_SAMPLE_FAILED`). Those are held sends like any other: `isHeld` is
true, and they go out by themselves.

A send with `sendAt` (a `Date` or an ISO-8601 string) answers the same
record with `status: 'SCHEDULED'` and `scheduledAt`. `emails.get(id)`
reads it while it waits, and `emails.cancelScheduled(id)` cancels it until
it fires: that answers `{ deleted: true }`, and the record then reads
`CANCELLED`. Once it has fired, `emails.get(id)` answers the send record it
became, under that record's own id.

Attachments are never stored, so a send carrying them cannot wait: where it
would, it answers `503` with `error.code` `emailSending.sendHeld` instead.
That error is retryable like any provider `503`: send again later with the
same idempotency key (`error.idempotencyKey`), once the hold lifts:
`error.retryAfterSeconds` says when. That can be hours, so the SDK hands
it back at once instead of sleeping through it. `usage.get()` reports the
daily position and the warm-up under `sending`; the lines themselves are in
the API reference under Daily sending.

An attachment whose file name ends in an extension SES refuses (`.exe`,
`.bat`, `.js`, `.msi` and the rest of SES's list) is refused with a `400`
`emailSending.attachmentTypeNotAllowed`, and `retryable` is false.

## Retries and idempotency: on by default

- **429** retries on every method (a rate-limited request was never
  processed), waiting per `Retry-After`. **5xx, timeouts and network
  failures** retry with exponential backoff, but only on replay-safe
  requests: reads, and email sends carrying an idempotency key. A **503**
  waits per its `Retry-After` instead, which the API sends on every send
  `503`. A wait over 30 seconds is never slept: the error comes back at
  once with `retryAfterSeconds`, for your queue to reschedule. Two retries
  by default; `maxRetries: 0` disables them (per call too, via options),
  which suits code a person is waiting on.
- Every send (`emails.send`, `emails.sendTemplate`, `emails.sendBulk`) gets
  an **idempotency key automatically** and reuses it across the SDK's
  internal retries: a timeout can never double-send, even if you have never
  heard of the header. The API honors the key on those three routes only,
  so the SDK sends it nowhere else. A concurrent-duplicate `409
  requestInProgress` is also retried until the server replays the original
  response. If the original is still running when the retries run out, the
  `409` is `retryable`, since its outcome is not known yet: retry later
  with the same key. You get the original's response once it has finished,
  and a key still in progress 10 minutes after it was claimed is taken over
  by the next retry. Pass your own key for business-level dedup across
  *your* retries:

  ```ts
  await sendheron.emails.sendTemplate(payload, { idempotencyKey: `receipt-${orderId}` });
  ```

  If the SDK exhausts its retries, the key it used is on
  `error.idempotencyKey`: resume the SAME logical send with it instead of
  minting a new one. Attachment *bytes* are excluded from the server's
  fingerprint, so a retried job that regenerated the same PDF replays
  cleanly. Keys are scoped to the API key's workspace and the endpoint, and
  expire after 24 hours.
- API failures are **returned, never thrown**: every call resolves to
  `{ data, error }`.

## Errors

An error is a `SendHeronError` with the HTTP `statusCode` (null when no
answer arrived) and a stable `code`. `error.kind` says whose code it is:
`'api'` when the API refused, and `code` is its key; `'transport'` when no
usable answer arrived, and `code` is one of the SDK's own
(`TRANSPORT_ERROR_CODES`: `timeout`, `network_error`, `aborted`,
`invalid_response`). `error.description` is the API's sentence when it gave
one, and never the HTTP status name. Every refusal has the same body, a
`429` included: `{ statusCode, message, error, description }`, with
`message` as the `code`.

`error.retryable` says whether the same request can still succeed. When it
is true, send it again later with the same idempotency key
(`error.idempotencyKey`: a fresh one could send twice), after
`error.retryAfterSeconds` when that is set. When it is false, fail the job:
the same request fails the same way.

On the send routes:

| `statusCode` | `code` | What happened | `retryable` |
| --- | --- | --- | --- |
| 400 | such as `emailSending.tooManyRecipients`, `emailSending.invalidHeaderValue` | The request is wrong: over 50 recipients in total, `to` included, or a header SES would refuse. Nothing was recorded. | false |
| 409 | `idempotency.requestInProgress` | The request with this key is still running, so its outcome is not known yet. | true |
| 409 | `idempotency.keyReusedWithDifferentPayload` | The key was already used for a different request. | false |
| 413 | `requestTooLarge` | The request body is over 15 MB, the most the email routes take. Nothing was recorded. | false |
| 422 | `emailSending.providerRejected` | The provider refused the message itself. `error.description` says in SendHeron's words what was refused: the sender, a recipient address, a header, an attachment or the size. The failed attempt is recorded. | false |
| 429 | `tooManyRequests` | Rate limited. The request was never processed. | true |
| 503 | `emailSending.sendFailed` | The provider could not take the send now. The failed attempt is recorded. `retryAfterSeconds` is 30, or 300 when the sending account itself cannot send. | true |
| 503 | `emailSending.sendHeld` | A send with attachments would have had to wait. `retryAfterSeconds` is when the hold lifts. | true |
| null | `timeout`, `network_error` | No answer arrived, so the send may or may not have gone. | true |
| null | `aborted` | Your `signal` aborted the call. | false |
| any | `invalid_response` | An answer that was not the API's: an edge or proxy page, or an empty or cut-off body. | true for a 5xx |

Any other 4xx (a bad key, a missing scope, an unknown template, a
malformed id: `invalidUUID`) is a request bug, never retryable.

## Resources

```ts
// Send
sendheron.emails.send(payload)              // raw HTML
sendheron.emails.sendTemplate(payload)      // templated; sendAt schedules it
sendheron.emails.sendBulk(payload)          // marketing blast to contacts
sendheron.emails.get(id)                    // read one send back: delivery
                                            // lifecycle, opens/clicks by people,
                                            // a held or scheduled send's outcome
sendheron.emails.cancelScheduled(id)        // { deleted: true }; it reads CANCELLED

// Templates
sendheron.templates.list({ emailType: 'TRANSACTIONAL' })
sendheron.templates.create({ ..., previewText, emailType: 'TRANSACTIONAL' }) // type is required
sendheron.templates.update(id, { emailType: 'MARKETING', confirmEmailTypeChange: true })
sendheron.templates.update(id, { previewText: null })  // null removes it
sendheron.templates.preview({ bodyHtml, subject, previewText, emailType, variables })
sendheron.templates.validate(document, previewText)    // previewText is optional

// Suppressions
sendheron.suppressions.check('user@example.com') // per-stream recipient and
                                                 // organization verdict, with
                                                 // the address screening
sendheron.suppressions.list({ tier: 'HARD' })    // this workspace's opt-outs, and
                                                 // the organization's bounces and
                                                 // complaints for its contacts and
                                                 // past recipients
sendheron.suppressions.add({ email, note })
sendheron.suppressions.remove(email)             // Lifts this workspace's own
                                                 // opt-outs. A bounce or complaint
                                                 // is lifted by the account owner
                                                 // in the dashboard, not through
                                                 // the API.

// Usage
sendheron.usage.get() // pool position, plan caps, daily sending, signup
                      // forms + rate ceilings: monitor
                      // monthlySends.transactionalRemaining,
                      // plan.trialEndsAt / plan.lapsedReason,
                      // plan.sendingReview, sending.held / sending.warmup,
                      // and signupForms

// Forms
sendheron.forms.signup(formId, { email, ipAddress }) // double opt-in, from
                                                     // your server only
```

A template's `previewText` is the line inboxes show after the subject.
Every send of the template carries it as a hidden preheader at the top of
the body; it is never stored in `bodyHtml`, and template responses read it
as a string or null. It takes merge tags, whitespace collapses to one line,
and it is at most 200 characters, merge tags counted as written: longer is
a 400 `templates.previewTextTooLong`, never truncated. `preview()` renders
it with your `variables` into `renderedPreviewText`, beside
`renderedSubject`, and `validate(document, previewText)` counts its
preheader toward the size limit, so a builder document at the edge of that
limit can be refused once preview text is added.

## Lists, deletes and types

Every list answers one envelope, `{ data, totalCount, page, limit,
hasNextPage }` (`PaginatedResponse<T>`): `page` is the zero-based page you
asked for, counts are never null, and `limit` defaults to 50 and stops at
100. Every delete answers `{ deleted: true }` and takes no body.

Every request and response type is generated from the API document
(`SendRecordResponse`, `TemplateResponse`, `SuppressionEntryResponse`,
`SuppressionCheckResponse`, `UsageResponse` and the rest), so the SDK types
exactly what the API declares: every response field is present, `null`
when empty, never absent.

## Signup forms

`forms.signup()` signs someone up through a signup form you build
yourself. Call it from your server, never the browser: the API key is a
secret. Give that server its own key holding only the `signups:create`
scope: such a key can do nothing else. The signup is always double opt-in,
whatever the form's own setting: the person gets the form's confirmation
email and joins the form's list only once they confirm. The form decides
the consent sentence kept on the record, so show your visitor that exact
sentence next to your form.

A Next.js Server Action:

```ts
'use server';

import { headers } from 'next/headers';
import { SendHeron } from 'sendheron';

// For useActionState(subscribe, '') in a client component.
export async function subscribe(_previous: string, formData: FormData) {
  // This action is public: run your bot check (Cloudflare Turnstile,
  // verified here on the server) and your own per-visitor limit first.
  const h = await headers();
  // The visitor's real address: behind Cloudflare the CF-Connecting-IP
  // header, never an X-Forwarded-For value the visitor can write.
  const ipAddress = h.get('cf-connecting-ip');
  if (!ipAddress) return 'Something went wrong. Please try again later.';

  const sendheron = new SendHeron(process.env.SENDHERON_SIGNUP_KEY);
  const { error } = await sendheron.forms.signup(
    '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    {
      email: String(formData.get('email') ?? ''),
      ipAddress,
      userAgent: h.get('user-agent') ?? undefined,
    },
    // A visitor is waiting: answer a 429 at once instead of waiting it out.
    { maxRetries: 0 },
  );

  if (
    error?.code === 'signupForms.invalidEmail' ||
    error?.code === 'signupForms.undeliverableEmail'
  ) {
    return 'Please check your email address.';
  }
  if (error) return 'Something went wrong. Please try again later.';
  // The same answer for every address: say nothing more.
  return 'Check your inbox to confirm.';
}
```

The answer is the same `{ status: 'ACCEPTED' }` for every address (new,
already waiting for its confirmation, already subscribed, or one SendHeron
will not mail), so it cannot tell anyone whether an address is subscribed.
Limits: 30 a minute per key, hourly and daily ceilings per key, and a
per-visitor limit on the IP address you report, each a `429` with
`Retry-After`. A form that takes no signups answers `409`
`signupForms.unavailable`, with the reason in `error.description`.

`usage.get()` reports the forms of the key's workspace under
`signupForms`: `forms` against the per-workspace cap, `pendingSignups`
waiting for their confirmation click, `confirmedLast30Days` (signups that
became subscribed contacts) and `underAttack`, the forms held to a trickle
right now, every signup double opt-in.

## Configuration

```ts
new SendHeron(apiKey, {
  baseUrl: 'https://api.sendheron.com', // default
  maxRetries: 2,                        // default; 0 disables retries
  timeout: 60_000,                      // per-attempt, in ms
});
```

The key falls back to the `SENDHERON_API_KEY` environment variable.
Constructing without any key throws; nothing else ever does.

## Coverage

1.0 wraps the transactional surface (`emails`, `templates`, `suppressions`,
`usage`) and signups through `forms`. The remaining API resources
(contacts, lists, tags, sequences, sending domains and identities,
analytics) arrive as minor releases; until then they are one
[documented HTTP call](https://sendheron.com/docs) away. They follow the
same contract: the list envelope, `{ deleted: true }` deletes, and bulk
removals as `POST .../bulk-remove` answering `{ removedIds, notFoundIds }`.

## Requirements

Node.js >= 20 (native `fetch`, ES2022 output). CI exercises Node 22, 24 and
26, the maintained lines. Zero runtime dependencies. Ships ESM and CJS with full
type declarations.

## Contract drift protection

`spec/openapi.json` is a snapshot of the live API contract. CI re-fetches the
(public) live document and fails when they differ, so an API change becomes a
failing build here: never a surprise in your integration. The SDK's types
are generated from that snapshot, and a test fails when they no longer
match it.

## License

MIT
