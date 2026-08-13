#!/usr/bin/env node
/**
 * The contract-drift gate.
 *
 * `--update` fetches the live OpenAPI document (public, no auth) and commits
 * it as spec/openapi.json. `--check` fetches it again and fails when the live
 * contract differs from the snapshot — which is how a backend API change
 * becomes a failing build in THIS repo instead of a bug in a consumer.
 *
 * Zero secrets by design: the spec endpoint is public, so CI needs no token.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { argv, exit } from 'node:process';

const SPEC_URL = 'https://api.sendheron.com/api/docs-json';
const SNAPSHOT = 'spec/openapi.json';

const normalize = (spec) => `${JSON.stringify(spec, null, 2)}\n`;

const fetchLive = async () => {
  const response = await fetch(SPEC_URL, {
    headers: { 'user-agent': 'sendheron-node-spec-check' },
  });
  if (!response.ok) {
    throw new Error(`Fetching ${SPEC_URL} failed: HTTP ${response.status}`);
  }
  return normalize(await response.json());
};

const main = async () => {
  const live = await fetchLive();

  if (argv.includes('--update')) {
    mkdirSync('spec', { recursive: true });
    writeFileSync(SNAPSHOT, live);
    console.log(`Wrote ${SNAPSHOT}`);
    return;
  }

  if (argv.includes('--check')) {
    const snapshot = readFileSync(SNAPSHOT, 'utf8');
    if (snapshot !== live) {
      console.error(
        `${SNAPSHOT} no longer matches the live API contract.\n` +
          'The backend changed. Review the diff, update the SDK types if the ' +
          'change touches a surface this SDK wraps, then run: pnpm spec:update',
      );
      exit(1);
    }
    console.log(`${SNAPSHOT} matches the live API contract.`);
    return;
  }

  console.error('Usage: node scripts/spec.mjs --update | --check');
  exit(1);
};

main().catch((error) => {
  console.error(error.message);
  exit(1);
});
