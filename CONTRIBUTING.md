# Contributing

## Setup

Node >= 22.13 (the toolchain; the shipped package supports Node >= 20) and
pnpm 11 via corepack:

```bash
corepack enable
pnpm install
```

## The gate

```bash
pnpm verify   # lint (biome) + typecheck + build + tests
```

Run it before every push; CI runs the same steps. Tests execute against a
real local HTTP server per test (`test/mock-server.ts`), never fetch stubs,
and never a live API. Optionally, `pnpm e2e` exercises the built output
against a real backend (see the script header for env and safety rails).

## Rules that will fail review

- No secrets anywhere, including examples and fixtures. API keys are
  runtime input only.
- No new runtime dependencies without a maintainer decision; the package
  ships with zero.
- Public behavior lives in the README's contract (results never throw,
  retry policy, auto-idempotency); changes to it need tests and a
  CHANGELOG entry, and breaking changes need a major.
- `spec/openapi.json` must match the live contract: `pnpm spec:check`.
- No em or en dashes in published copy (README, doc comments, package
  description).

## Releases

Maintainer-only: version bump in `package.json` + `src/version.ts` (a test
enforces the sync) + CHANGELOG entry via PR, then a `v*` tag (restricted by
a repository ruleset) triggers the OIDC publish. There are no npm tokens.
