# sendheron

TypeScript SDK for the [SendHeron](https://sendheron.com) email API — typed
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
    // The compliance gate refused — data.errorMessage is a stable reason
    // (e.g. 'HARD_SUPPRESSED'). NEVER retry these; surface them.
    break;
}
```

`SEND_BLOCK_REASONS` exports every suppression reason as a typed list.

## Retries and idempotency — on by default

- **429** waits for `Retry-After`, then retries. **5xx and network failures**
  back off exponentially. Two retries by default; `maxRetries: 0` disables.
- Every email send gets an **idempotency key automatically** and reuses it
  across the SDK's internal retries — a timeout can never double-send, even
  if you have never heard of the header. Pass your own for business-level
  dedup across *your* retries:

  ```ts
  await sendheron.emails.sendTemplate(payload, { idempotencyKey: `receipt-${orderId}` });
  ```

  Attachment *bytes* are excluded from the server's idempotency fingerprint,
  so a retried job that regenerated the same PDF replays cleanly.
- Only retry-safe requests are retried: reads, and writes carrying an
  idempotency key. Everything else fails fast.
- API failures are **returned, never thrown**: every call resolves to
  `{ data, error }`.

## Resources

```ts
// Send
sendheron.emails.send(payload)              // raw HTML
sendheron.emails.sendTemplate(payload)      // templated; sendAt schedules it
sendheron.emails.sendBulk(payload)          // marketing blast to contacts
sendheron.emails.get(id)                    // read one send back — delivery
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
sendheron.usage.get() // pool position + rate ceilings — monitor
                      // monthlySends.transactionalRemaining
```

## Configuration

```ts
new SendHeron(apiKey, {
  baseUrl: 'https://api.sendheron.com', // default
  maxRetries: 2,                        // default; 0 disables retries
});
```

The key falls back to the `SENDHERON_API_KEY` environment variable.
Constructing without any key throws; nothing else ever does.

## Requirements

Node.js ≥ 18.17 (native `fetch`). Zero runtime dependencies. Ships ESM and
CJS with full type declarations.

## Contract drift protection

`spec/openapi.json` is a snapshot of the live API contract. CI re-fetches the
(public) live document and fails when they differ, so an API change becomes a
failing build here — never a surprise in your integration.

## License

MIT
