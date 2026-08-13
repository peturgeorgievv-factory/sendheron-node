# Changelog

## 0.1.0

Initial release. The migration surface of the SendHeron API:

- `emails` — send, sendTemplate, sendBulk, get, cancelScheduled
- `templates` — list, get, create, update, remove, preview, validate
- `suppressions` — list, check, add, remove
- `usage` — get

Defaults that differ from most email SDKs, on purpose:

- automatic retries (429 honoring Retry-After; 5xx/network with backoff)
- auto-generated idempotency keys on email sends, stable across retries
- typed send outcomes — `status: 'sent' | 'suppressed'` with the exported
  block-reason list, because a 201 is an outcome, not proof of dispatch
- `{ data, error }` results; API failures are never thrown
