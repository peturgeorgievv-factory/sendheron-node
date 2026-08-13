/**
 * Ask "would this address receive mail?" and watch the send pool.
 *
 *   SENDHERON_API_KEY=ema_live_... npx tsx examples/check-before-send.ts
 */
import { SendHeron } from '../src/index.js';

const sendheron = new SendHeron();

const { data: verdict } = await sendheron.suppressions.check(
  'user@example.com',
);
if (verdict) {
  console.log(
    `transactional: ${verdict.transactional.allowed ? 'would send' : verdict.transactional.blockReason}`,
  );
  console.log(
    `marketing:     ${verdict.marketing.allowed ? 'would send' : verdict.marketing.blockReason}`,
  );
}

const { data: usage } = await sendheron.usage.get();
if (usage) {
  const { used, transactionalRemaining, resetsAt } = usage.monthlySends;
  console.log(
    `pool: ${used} used, transactional remaining: ${transactionalRemaining ?? 'uncapped'}, resets ${resetsAt}`,
  );
}
