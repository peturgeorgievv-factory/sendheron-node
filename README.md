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
console.log(data.id, data.status, data.providerMessageId);
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
  // 4xx: a request bug (error.code is a stable key). 429/5xx: the SDK
  // already retried per its policy before handing you this. A 503
  // 'emailSending.sendHeld' means the send would have had to wait (daily
  // capacity or warm-up), which a send with attachments cannot do: retry
  // it later with error.idempotencyKey.
  throw error;
}

switch (data.status) {
  case 'sent':
    // Accepted by the provider. Persist data.id (readable back via
    // emails.get) and data.providerMessageId.
    break;
  case 'suppressed':
    // The compliance gate refused: data.errorMessage is a stable reason
    // (e.g. 'HARD_SUPPRESSED'). NEVER retry these; surface them.
    break;
}
```

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
`status: 'queued'` with the reason in `holdReason` (`SEND_HOLD_REASONS`) and
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
(`IMPORT_SAMPLE_FAILED`). Those sends carry the import's id in
`contactImportId`, and they are held sends like any other: `isHeld` is
true, and they go out by themselves.

Attachments are never stored, so a send carrying them cannot wait: where it
would, it answers `503` with `error.code` `emailSending.sendHeld` instead.
That error is retryable like any provider `503`: send again later with the
same idempotency key (`error.idempotencyKey`). `usage.get()` reports the
daily position and the warm-up under `sending`; the lines themselves are in
the API reference under Daily sending.

## Retries and idempotency: on by default

- **429** retries on every method (a rate-limited request was never
  processed), waiting per `Retry-After`. **5xx, timeouts and network
  failures** retry with exponential backoff, but only on replay-safe
  requests: reads, and email sends carrying an idempotency key. Two retries
  by default; `maxRetries: 0` disables (per call too, via options).
- Every email send gets an **idempotency key automatically** and reuses it
  across the SDK's internal retries: a timeout can never double-send, even
  if you have never heard of the header. A concurrent-duplicate `409
  requestInProgress` is also retried until the server replays the original
  response. Pass your own key for business-level dedup across *your*
  retries:

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

## Resources

```ts
// Send
sendheron.emails.send(payload)              // raw HTML
sendheron.emails.sendTemplate(payload)      // templated; sendAt schedules it
sendheron.emails.sendBulk(payload)          // marketing blast to contacts
sendheron.emails.get(id)                    // read one send back: delivery
                                            // lifecycle, opens/clicks by people,
                                            // a held send's outcome
sendheron.emails.cancelScheduled(id)

// Templates
sendheron.templates.list({ emailType: 'TRANSACTIONAL' })
sendheron.templates.create({ ..., previewText, emailType: 'TRANSACTIONAL' }) // type is required
sendheron.templates.update(id, { emailType: 'MARKETING', confirmEmailTypeChange: true })
sendheron.templates.update(id, { previewText: null })  // null removes it
sendheron.templates.preview({ bodyHtml, subject, previewText, emailType, sampleData })
sendheron.templates.validate(document, previewText)    // previewText is optional

// Suppressions
sendheron.suppressions.check('user@example.com') // per-stream recipient and
                                                 // organization verdict, with
                                                 // the address screening
sendheron.suppressions.list({ tier: 'HARD' })
sendheron.suppressions.add({ email, note })
sendheron.suppressions.remove(email, { confirmHardTier: true })

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
it with your `sampleData` into `renderedPreviewText`, beside
`renderedSubject`, and `validate(document, previewText)` counts its
preheader toward the size limit, so a builder document at the edge of that
limit can be refused once preview text is added.

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

The answer is the same `{ status: 'accepted' }` for every address (new,
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

v0 wraps the transactional surface (`emails`, `templates`, `suppressions`,
`usage`) and signups through `forms`. The remaining API resources
(contacts, tags, sequences, sending domains, analytics) arrive as minor
releases; until then they are one
[documented HTTP call](https://sendheron.com/docs) away.

## Requirements

Node.js >= 20 (native `fetch`, ES2022 output). CI exercises Node 22 and 24,
the maintained lines. Zero runtime dependencies. Ships ESM and CJS with full
type declarations.

## Contract drift protection

`spec/openapi.json` is a snapshot of the live API contract. CI re-fetches the
(public) live document and fails when they differ, so an API change becomes a
failing build here: never a surprise in your integration.

## License

MIT
