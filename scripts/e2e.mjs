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
 * manual suppression is added and removed, a send scheduled an hour ahead
 * is cancelled at once, and the only send goes to the
 * SES mailbox simulator (or is refused by the compliance gate when the
 * workspace has no sender configured, or while the organization is still
 * under sender review, or is held for daily capacity or warm-up and goes
 * out by itself later, each of which is itself a probed outcome). A second
 * send to the simulator carries a header SES would refuse, and the API
 * refuses it before anything is recorded. The signup probe names a form
 * that does not exist, so nothing is mailed.
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

// usage: shape parses whatever the plan state; the sender review is never
// null, every plan cap is reported, and so are the daily sending position
// and the workspace's signup forms
{
  const { data, error } = await sdk.usage.get();
  record(
    'usage.get',
    !error &&
      typeof data.monthlySends.used === 'number' &&
      ['SANDBOX', 'REQUESTED', 'APPROVED'].includes(data.plan.sendingReview) &&
      ['domains', 'workspaces', 'teamMembers'].every(
        (cap) => typeof data[cap]?.used === 'number',
      ) &&
      (data.sending === null ||
        (typeof data.sending.held === 'number' &&
          ['WARMING', 'HELD', 'COMPLETE'].includes(
            data.sending.warmup?.status,
          ))) &&
      typeof data.signupForms?.forms?.cap === 'number' &&
      ['pendingSignups', 'confirmedLast30Days', 'underAttack'].every(
        (count) => typeof data.signupForms[count] === 'number',
      ),
    error?.code ??
      `plan=${data?.plan.status} review=${data?.plan.sendingReview} warmup=${data?.sending?.warmup?.status ?? 'none'}`,
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

// preview text past its limit is refused, never truncated
{
  const { data, error } = await sdk.templates.create({
    name: 'sdk-e2e-long-preview',
    subject: 's',
    previewText: 'x'.repeat(201),
    bodyHtml: '<p>x</p>',
    emailType: 'TRANSACTIONAL',
  });
  if (data?.id) {
    // Saved after all: still leave nothing behind.
    await sdk.templates.remove(data.id);
  }
  record(
    'previewText over 200 is 400',
    error?.code === 'templates.previewTextTooLong',
    error?.code,
  );
}

// create a TRANSACTIONAL template; its preview text collapses to one line
let templateId;
{
  const { data, error } = await sdk.templates.create({
    name: 'sdk-e2e',
    subject: 'Hello {{ name }}',
    previewText: '  Your receipt,\n  {{ name }}  ',
    bodyHtml:
      '<p>Hi {{ name }}</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
    emailType: 'TRANSACTIONAL',
  });
  templateId = data?.id;
  record(
    'templates.create',
    !error && !!templateId && data.previewText === 'Your receipt, {{ name }}',
    error?.code ?? `previewText=${JSON.stringify(data?.previewText)}`,
  );
}

// preview flags the ignored unsubscribe variable on transactional policy,
// and reads null for the subject and preview text it was not given
{
  const { data, error } = await sdk.templates.preview({
    bodyHtml: '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
    emailType: 'TRANSACTIONAL',
  });
  record(
    'preview.unsubscribeVariableIgnored',
    !error &&
      data.unsubscribeVariableIgnored === true &&
      data.renderedSubject === null &&
      data.renderedPreviewText === null,
    error?.code,
  );
}

// preview renders the subject and preview text with variables, and puts
// the preview text in the body as the hidden preheader
{
  const { data, error } = await sdk.templates.preview({
    bodyHtml: '<p>Hi {{ name }}</p>',
    emailType: 'TRANSACTIONAL',
    variables: { name: 'Ada' },
    subject: 'Hello {{ name }}',
    previewText: 'Your receipt, {{ name }}',
  });
  record(
    'preview renders subject and previewText',
    !error &&
      data.renderedSubject === 'Hello Ada' &&
      data.renderedPreviewText === 'Your receipt, Ada' &&
      data.renderedHtml.includes('Your receipt, Ada'),
    error?.code ??
      `subject=${data?.renderedSubject} previewText=${data?.renderedPreviewText}`,
  );
}

// validate reports an over-long preview text as an issue, not a 400
{
  const { data, error } = await sdk.templates.validate(
    {
      version: 1,
      settings: { contentWidth: 600, backgroundColor: '#f4f4f5' },
      blocks: [{ id: 'b1', type: 'heading', text: 'Hello', level: 1 }],
    },
    'x'.repeat(201),
  );
  record(
    'validate previewText issue',
    !error &&
      data.valid === false &&
      data.issues.some((issue) => issue.startsWith('previewText')),
    error?.code ?? data?.issues.join('; '),
  );
}

// an explicit null removes the preview text
{
  const { data, error } = await sdk.templates.update(templateId, {
    previewText: null,
  });
  record(
    'update previewText null',
    !error && data.previewText === null,
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

// a raw send resolves to an OUTCOME either way: SENT (simulator sink) when
// the workspace has a configured sender, SUPPRESSED when it does not, and
// SUPPRESSED with SENDER_UNDER_REVIEW while the organization is unreviewed
// (the simulator is not one of its own domains), or QUEUED with a
// holdReason when it waits for daily capacity or warm-up
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
    (data.status === 'SENT'
      ? !!data.providerMessageId
      : data.status === 'SUPPRESSED'
        ? !!data.errorMessage
        : data.status === 'QUEUED' && !!data.holdReason && !!data.heldUntil);
  record(
    'send outcome',
    ok,
    error?.code ??
      `${data?.status}/${data?.errorMessage ?? data?.holdReason ?? ''}`,
  );
}

// read the send back by id: every field is present, null when empty, the
// engagement counters people and machines apart, and nothing internal
{
  const { data, error } = await sdk.emails.get(sendId);
  record(
    'emails.get',
    !error &&
      data.id === sendId &&
      [
        'openCount',
        'clickCount',
        'machineOpenCount',
        'machineClickCount',
        'unconfirmedOpenCount',
      ].every((count) => typeof data[count] === 'number') &&
      data.channel === 'TRANSACTIONAL_API' &&
      data.scheduledAt === null &&
      data.droppedRecipients === null &&
      !('organizationId' in data),
    error?.code ??
      `channel=${data?.channel} droppedRecipients=${JSON.stringify(data?.droppedRecipients)}`,
  );
}

// a scheduled send is the same record, SCHEDULED; get() reads it, and
// cancelling it answers { deleted: true } and leaves it CANCELLED
{
  const sendAt = new Date(Date.now() + 60 * 60 * 1000);
  const { data, error } = await sdk.emails.send({
    to: SIMULATOR_SUCCESS,
    subject: 'sdk e2e scheduled',
    html: '<p>e2e probe, cancelled before it fires</p>',
    sendAt,
  });
  const cancelled = data?.id
    ? await sdk.emails.cancelScheduled(data.id)
    : { data: null, error: null };
  const after = data?.id ? await sdk.emails.get(data.id) : { data: null };
  record(
    'scheduled send round trip',
    !error &&
      data.status === 'SCHEDULED' &&
      Date.parse(data.scheduledAt) === sendAt.getTime() &&
      cancelled.data?.deleted === true &&
      after.data?.status === 'CANCELLED',
    error?.code ??
      cancelled.error?.code ??
      `${data?.status} -> ${after.data?.status}`,
  );
}

// a header SES would refuse is a 400 before anything is recorded, never a
// provider refusal after the attempt
{
  const { error } = await sdk.emails.send(
    {
      to: SIMULATOR_SUCCESS,
      subject: 'sdk e2e',
      html: '<p>e2e probe</p>',
      headers: { 'X-Sdk-E2e': 'café' },
    },
    { maxRetries: 0 },
  );
  record(
    'non-ASCII header value is 400',
    error?.statusCode === 400 &&
      error.code === 'emailSending.invalidHeaderValue' &&
      error.retryable === false,
    error?.code ?? 'accepted',
  );
}

// per-stream deliverability verdict, with the platform-wide hard-bounce
// list and the address screening
{
  const { data, error } = await sdk.suppressions.check(SIMULATOR_SUCCESS);
  record(
    'suppressions.check',
    !error &&
      typeof data.transactional.allowed === 'boolean' &&
      typeof data.knownHardBounce === 'boolean' &&
      (data.screeningVerdict === null ||
        ['VALID', 'RISKY', 'UNDELIVERABLE', 'UNCHECKED'].includes(
          data.screeningVerdict,
        )) &&
      Array.isArray(data.screeningReasons) &&
      (data.suggestedEmail === null || typeof data.suggestedEmail === 'string'),
    error?.code ??
      `knownHardBounce=${data?.knownHardBounce} screening=${data?.screeningVerdict ?? 'none'}`,
  );
}

// manual suppression round trip (an opt-out of this workspace, which any key lifts)
{
  const address = 'sdk-e2e-suppress@example.com';
  const { data: added, error: addError } = await sdk.suppressions.add({
    email: address,
    note: 'sdk e2e',
  });
  const { data: verdict } = await sdk.suppressions.check(address);
  const { data: removed, error: removeError } =
    await sdk.suppressions.remove(address);
  record(
    'suppression round trip',
    !addError &&
      added.reason === 'MANUAL' &&
      added.tier === 'CONSENT' &&
      verdict?.suppressed === true &&
      !removeError &&
      removed.deleted === true,
    addError?.code ?? removeError?.code,
  );
}

// every list answers one envelope, with the zero-based page asked for
{
  const { data, error } = await sdk.suppressions.list({ page: 0, limit: 5 });
  record(
    'list envelope',
    !error &&
      Array.isArray(data.data) &&
      typeof data.totalCount === 'number' &&
      data.page === 0 &&
      data.limit === 5 &&
      typeof data.hasNextPage === 'boolean',
    error?.code ?? `page=${data?.page} limit=${data?.limit}`,
  );
}

// a signup to a form that does not exist is a typed 404 value, or a 403
// when the key lacks signups:create; either way nothing is mailed
{
  const { error } = await sdk.forms.signup(
    '00000000-0000-4000-8000-000000000000',
    { email: SIMULATOR_SUCCESS, ipAddress: '203.0.113.7' },
    { maxRetries: 0 },
  );
  record(
    'forms.signup unknown form',
    (error?.statusCode === 404 && error.code === 'signupForms.notFound') ||
      (error?.statusCode === 403 &&
        error.code === 'apiKeys.insufficientScopes'),
    error?.code ?? 'accepted',
  );
}

// cleanup
{
  const { data, error } = await sdk.templates.remove(templateId);
  record('templates.remove', !error && data.deleted === true, error?.code);
}

// a wrong key is a typed 401 value, not a throw
{
  const bad = new SendHeron('ema_live_wrong', {
    baseUrl: BASE_URL,
    maxRetries: 0,
  });
  const { error } = await bad.usage.get();
  record(
    '401 typed error',
    error?.statusCode === 401 && error.kind === 'api',
    error?.code,
  );
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
exit(passed === results.length ? 0 : 1);
