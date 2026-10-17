/**
 * Ask "would this address receive mail?" and watch the send pool.
 *
 *   SENDHERON_API_KEY=ema_live_... npx tsx examples/check-before-send.ts
 */
// In your app: import { SendHeron } from 'sendheron';
import { SendHeron } from '../src/index.js';

const sendheron = new SendHeron();

const { data: verdict, error } =
  await sendheron.suppressions.check('user@example.com');
if (error) {
  console.error(`check failed (${error.statusCode}): ${error.code}`);
  process.exit(1);
}
if (verdict) {
  console.log(
    `transactional: ${verdict.transactional.allowed ? 'would send' : verdict.transactional.blockReason}`,
  );
  console.log(
    `marketing:     ${verdict.marketing.allowed ? 'would send' : verdict.marketing.blockReason}`,
  );
  // The matching contact's screening. Only UNDELIVERABLE stops mail.
  const reasons = verdict.screeningReasons.join(', ');
  console.log(
    `screening:     ${verdict.screeningVerdict ?? 'no screened contact'}${reasons ? ` (${reasons})` : ''}`,
  );
  if (verdict.suggestedEmail) {
    console.log(`did you mean:  ${verdict.suggestedEmail}`);
  }
}

const { data: usage } = await sendheron.usage.get();
if (usage) {
  const { used, transactionalRemaining, resetsAt } = usage.monthlySends;
  console.log(
    `pool: ${used} used, transactional remaining: ${transactionalRemaining ?? 'uncapped'}, resets ${resetsAt}`,
  );
  if (usage.sending) {
    const { held, marketingRemaining, warmup } = usage.sending;
    console.log(
      `today: ${held} held, marketing that fits now: ${marketingRemaining ?? 'unknown'}, warm-up ${warmup.status}`,
    );
  }
}
