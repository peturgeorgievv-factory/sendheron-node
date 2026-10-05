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
  // already retried per its policy before handing you this.
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
outside its own verified domains and team members is suppressed with this
reason, on every endpoint, transactional included. The address is fine, so
do not drop it, and retrying does nothing until approval. Check
`plan.sendingReview` on `usage.get()` (`SANDBOX`, `REQUESTED` or
`APPROVED`), and have the organization owner request approval from the
dashboard. Sends refused before approval are not replayed afterwards: send
them again, with a new idempotency key if you pass your own, since a reused
key can replay the recorded refusal.

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
  cleanly.
- API failures are **returned, never thrown**: every call resolves to
  `{ data, error }`.

## Resources

```ts
// Send
sendheron.emails.send(payload)              // raw HTML
sendheron.emails.sendTemplate(payload)      // templated; sendAt schedules it
sendheron.emails.sendBulk(payload)          // marketing blast to contacts
sendheron.emails.get(id)                    // read one send back: delivery
                                            // lifecycle, opens/clicks
sendheron.emails.cancelScheduled(id)

// Templates
sendheron.templates.list({ emailType: 'TRANSACTIONAL' })
sendheron.templates.create({ ..., emailType: 'TRANSACTIONAL' }) // type is required
sendheron.templates.update(id, { emailType: 'MARKETING', confirmEmailTypeChange: true })
sendheron.templates.preview({ bodyHtml, emailType, sampleData })
sendheron.templates.validate(document)

// Suppressions
sendheron.suppressions.check('user@example.com') // per-stream verdict, same
                                                 // gate the send paths run
sendheron.suppressions.list({ tier: 'HARD' })
sendheron.suppressions.add({ email, note })
sendheron.suppressions.remove(email, { confirmHardTier: true })

// Usage
sendheron.usage.get() // pool position, plan caps + rate ceilings: monitor
                      // monthlySends.transactionalRemaining,
                      // plan.trialEndsAt / plan.lapsedReason, and
                      // plan.sendingReview
```

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

v0 wraps the transactional surface: `emails`, `templates`, `suppressions`,
`usage`. The remaining API resources (contacts, tags, sequences, sending
domains, analytics) arrive as minor releases; until then they are one
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
