import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

describe('contract pins', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it('every route the SDK calls exists in the committed spec', () => {
    const spec = JSON.parse(readFileSync('spec/openapi.json', 'utf8')) as {
      paths: Record<string, unknown>;
    };

    const sdkRoutes = [
      '/api/v1/emails/send',
      '/api/v1/emails/send-template',
      '/api/v1/emails/send-bulk',
      '/api/v1/emails/{id}',
      '/api/v1/emails/scheduled/{id}',
      '/api/v1/templates',
      '/api/v1/templates/{id}',
      '/api/v1/templates/preview',
      '/api/v1/templates/validate',
      '/api/v1/suppressions',
      '/api/v1/suppressions/check',
      '/api/v1/suppressions/{email}',
      '/api/v1/usage',
      '/api/v1/forms/{formId}/signups',
    ];

    for (const route of sdkRoutes) {
      expect(spec.paths, `missing route: ${route}`).toHaveProperty([route]);
    }
  });

  it('src/generated.ts is what the committed spec generates', () => {
    // A spec refresh without `pnpm types:generate` fails here, so no build
    // ships types the committed document does not declare.
    const output = execFileSync(
      process.execPath,
      ['scripts/gen-types.mjs', '--check'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    expect(output).toContain('matches');
  });
});
