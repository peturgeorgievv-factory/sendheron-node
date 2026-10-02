#!/usr/bin/env node
/**
 * End-to-end probes of the BUILT SDK against a real backend over real HTTP.
 *
 *   SENDHERON_E2E_API_KEY=ema_live_... pnpm e2e
 *
 * Env:
 *   SENDHERON_E2E_API_KEY    required
 *   SENDHERON_E2E_BASE_URL   default http://localhost:5400
 *   SENDHERON_E2E_ALLOW_LIVE set to 1 to allow api.sendheron.com
 *
 * Side effects are contained: one template is created and deleted, one
 * manual suppression is added and removed, and the only send goes to the
 * SES mailbox simulator (or is refused by the compliance gate when the
 * workspace has no sender configured, or while the organization is still
 * under sender review, which is itself a probed outcome).
 * Run `pnpm build` first; this imports dist/.
 */
import { exit } from 'node:process';

const BASE_URL = process.env.SENDHERON_E2E_BASE_URL ?? 'http://localhost:5400';
const API_KEY = process.env.SENDHERON_E2E_API_KEY;
const SIMULATOR_SUCCESS = 'success@simulator.amazonses.com';

if (!API_KEY) {
  console.error('SENDHERON_E2E_API_KEY is required.');
  exit(1);
}
if (
  BASE_URL.includes('api.sendheron.com') &&
  process.env.SENDHERON_E2E_ALLOW_LIVE !== '1'
) {
  console.error(
    'Refusing to run against production. Set SENDHERON_E2E_ALLOW_LIVE=1 if you really mean it.',
  );
  exit(1);
}

let SendHeron;
try {
  ({ SendHeron } = await import('../dist/index.js'));
} catch {
  console.error('dist/ not found. Run: pnpm build');
  exit(1);
}

const sdk = new SendHeron(API_KEY, { baseUrl: BASE_URL });
const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

// usage: shape parses whatever the plan state; the sender review is never null
{
  const { data, error } = await sdk.usage.get();
  record(
    'usage.get',
    !error &&
      typeof data.monthlySends.used === 'number' &&
      ['SANDBOX', 'REQUESTED', 'APPROVED'].includes(data.plan.sendingReview),
    error?.code ??
      `plan=${data?.plan.status} review=${data?.plan.sendingReview}`,
  );
}

// template creation demands an explicit emailType
{
  const { error } = await sdk.templates.create({
    name: 'sdk-e2e-missing-type',
    subject: 's',
    bodyHtml: '<p>x</p>',
  });
  record(
    'create without emailType is 400',
    error?.statusCode === 400,
    error?.code,
  );
}

// create a TRANSACTIONAL template
let templateId;
{
  const { data, error } = await sdk.templates.create({
    name: 'sdk-e2e',
    subject: 'Hello {{ name }}',
    bodyHtml:
      '<p>Hi {{ name }}</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
    emailType: 'TRANSACTIONAL',
  });
  templateId = data?.id;
  record('templates.create', !error && !!templateId, error?.code);
}

// preview flags the ignored unsubscribe variable on transactional policy
{
  const { data, error } = await sdk.templates.preview({
    bodyHtml: '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
    emailType: 'TRANSACTIONAL',
  });
  record(
    'preview.unsubscribeVariableIgnored',
    !error && data.unsubscribeVariableIgnored === true,
    error?.code,
  );
}

// the emailType flip guard
{
  const { error } = await sdk.templates.update(templateId, {
    emailType: 'MARKETING',
  });
  record(
    'flip guard 400',
    error?.code === 'templates.emailTypeChangeNeedsConfirmation',
    error?.code,
  );
}

// a raw send resolves to an OUTCOME either way: sent (simulator sink) when
// the workspace has a configured sender, suppressed when it does not, and
// suppressed with SENDER_UNDER_REVIEW while the organization is unreviewed
// (the simulator is not one of its own domains)
let sendId;
{
  const { data, error } = await sdk.emails.send({
    to: SIMULATOR_SUCCESS,
    subject: 'sdk e2e',
    html: '<p>e2e probe</p>',
  });
  sendId = data?.id;
  const ok =
    !error &&
    (data.status === 'sent'
      ? !!data.providerMessageId
      : data.status === 'suppressed' && !!data.errorMessage);
  record(
    'send outcome',
    ok,
    error?.code ?? `${data?.status}/${data?.errorMessage ?? ''}`,
  );
}

// read the send back by id
{
  const { data, error } = await sdk.emails.get(sendId);
  record('emails.get', !error && data.id === sendId, error?.code);
}

// per-stream deliverability verdict
{
  const { data, error } = await sdk.suppressions.check(SIMULATOR_SUCCESS);
  record(
    'suppressions.check',
    !error && typeof data.transactional.allowed === 'boolean',
    error?.code,
  );
}

// manual suppression round trip (consent tier: no confirmHardTier needed)
{
  const address = 'sdk-e2e-suppress@example.com';
  const { error: addError } = await sdk.suppressions.add({
    email: address,
    note: 'sdk e2e',
  });
  const { data: verdict } = await sdk.suppressions.check(address);
  const { error: removeError } = await sdk.suppressions.remove(address);
  record(
    'suppression round trip',
    !addError && verdict?.suppressed === true && !removeError,
    addError?.code ?? removeError?.code,
  );
}

// cleanup
{
  const { error } = await sdk.templates.remove(templateId);
  record('templates.remove', !error, error?.code);
}

// a wrong key is a typed 401 value, not a throw
{
  const bad = new SendHeron('ema_live_wrong', {
    baseUrl: BASE_URL,
    maxRetries: 0,
  });
  const { error } = await bad.usage.get();
  record('401 typed error', error?.statusCode === 401, error?.code);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
exit(passed === results.length ? 0 : 1);
