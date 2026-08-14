# Security

## Reporting a vulnerability

Email **me@peturgeorgievv.com**. You will get a response within a few days.
Please do not open a public issue for security reports.

## Supply-chain posture

- Releases are published via npm Trusted Publishing (OIDC) from the
  `release.yml` workflow in this repository: no long-lived npm token exists.
  Every release carries an SLSA provenance attestation linking the package
  bytes to the exact commit and workflow run; verify with
  `npm audit signatures`.
- The package has zero runtime dependencies.
- This repository contains no secrets by design: the API key is supplied by
  the consumer at runtime, and the SDK never logs or serializes it.

## Supported versions

The latest published minor. Older versions receive no fixes; upgrading is
additive within a major.
