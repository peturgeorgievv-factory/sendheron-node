# CLAUDE.md

Agent instructions for this repository: the official TypeScript SDK for the
SendHeron email API, published to npm as `sendheron`. It is PUBLIC and open
source (MIT). Everything committed here is world-readable, and the shipped
`dist/` output includes the doc comments you write.

## Hard rules

- **No secrets, ever.** No API keys in tests, examples, fixtures, or docs,
  not even revoked ones. Unit tests run against a local mock server
  (`test/mock-server.ts`); the e2e script reads its key from env. Real keys
  look like `ema_live_...`; if one appears in a diff, stop.
- **The bot cannot push `.github/workflows/`.** Pushes touching that path
  are rejected. Deliver workflow changes as file contents for Petar to paste
  via the GitHub web editor.
- **Releases are Petar-only by construction.** A tag ruleset restricts `v*`
  tags to admins (verified by a rejection test). Never push a tag from this
  box. Publishing happens exclusively through `release.yml` via npm Trusted
  Publishing (OIDC): no npm token exists anywhere.
- **No em or en dashes in published copy** (README, doc comments, package
  description). House rule; use colons, commas, or hyphens.
- Zero runtime dependencies is a feature. Adding one needs an explicit
  decision from Petar.

## The SDK's contract with its consumers (do not regress)

- `{ data, error }` results; API failures are NEVER thrown. The only throw
  is constructing without an API key.
- A 201 is an outcome: `status: 'sent' | 'suppressed'`. Suppressed is data,
  never an error, never retried.
- Retry policy: 429 retries on every method honoring Retry-After (30s wait
  cap; beyond it the error surfaces instead of burning attempts); 5xx,
  timeouts and network failures retry only replay-safe requests (reads, and
  email sends carrying an idempotency key); 409 requestInProgress retries
  until the server replays; the other 409 never retries.
- Auto-idempotency: email sends mint a key BEFORE the retry loop and reuse
  it across attempts; `error.idempotencyKey` exposes it for caller resume.
- `error.retryable` and the block-reason groupings
  (`SENDER_SIDE_BLOCK_REASONS`, `RECIPIENT_BLOCK_REASONS`,
  `isSenderSideBlock`) are consumed by integrators. The partition test in
  `test/groupings.test.ts` forces every new backend reason to be classified
  before this repo builds.
- Semver: minors are additive only. A breaking change is a major and is
  coordinated with the backend (we own both sides).

## Contract drift

`spec/openapi.json` snapshots the live public
`https://api.sendheron.com/api/docs-json` (the backend commits the same
document as `docs/openapi.json`). `pnpm spec:check` fails when the live
contract differs; CI runs it on every PR and weekly. When it fires: read the
diff, update `src/types.ts` and any touched resource, extend tests, then
`pnpm spec:update` in the same PR. `test/contract.test.ts` must list every
path the SDK calls.

## Gates

- `pnpm verify` = typecheck + build + test. Run before every push.
- Unit tests use a REAL local HTTP server per test, never fetch stubs: the
  behavior under test (retries, idempotency headers, truncation) lives at
  the socket.
- `pnpm e2e` exercises the BUILT output against a real backend:
  `SENDHERON_E2E_API_KEY=... pnpm e2e` (base URL defaults to
  http://localhost:5400; requires `pnpm build` first). It refuses
  api.sendheron.com unless `SENDHERON_E2E_ALLOW_LIVE=1`. It creates and
  deletes a template and a manual suppression and sends only to the SES
  mailbox simulator, so nothing real is mailed. Deliberately not in CI.
- The toolchain needs Node >= 22.13 (pnpm 11); the SHIPPED package supports
  Node >= 20. `engines` describes consumers, not the toolchain.

## Releasing

1. Bump `version` in `package.json` AND `src/version.ts` (a test enforces
   the sync), add a CHANGELOG entry, PR, merge.
2. Petar, on his machine: `git tag vX.Y.Z && git push --tags`.
3. `release.yml` verifies the tag matches package.json, runs the full gate,
   and publishes with provenance.
