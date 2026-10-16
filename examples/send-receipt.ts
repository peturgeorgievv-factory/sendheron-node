/**
 * Send a templated receipt with a PDF attachment, handle every outcome.
 *
 *   SENDHERON_API_KEY=ema_live_... npx tsx examples/send-receipt.ts
 */
import { readFileSync } from 'node:fs';
// In your app: import { SendHeron } from 'sendheron';
import { SendHeron } from '../src/index.js';

const sendheron = new SendHeron();

const pdf = readFileSync('receipt-42.pdf').toString('base64');

const { data, error } = await sendheron.emails.sendTemplate(
  {
    to: 'customer@example.com',
    templateId: '550e8400-e29b-41d4-a716-446655440000',
    variables: { orderId: '42', total: '19.00 EUR' },
    attachments: [
      { content: pdf, filename: 'receipt-42.pdf', type: 'application/pdf' },
    ],
  },
  // Your own key makes the send idempotent across YOUR retries too.
  { idempotencyKey: 'receipt-42' },
);

if (error) {
  // A 503 emailSending.sendHeld means the send would have had to wait for
  // daily capacity or a new sender's warm-up, and attachments are never
  // stored: error.retryable is true, so send it again later with the same
  // key.
  console.error(`Send failed (${error.statusCode}): ${error.code}`);
  process.exit(1);
}

// With attachments a 201 is never held (`queued`): it is sent or suppressed.
if (data.status === 'suppressed') {
  console.warn(`Refused by the compliance gate: ${data.errorMessage}`);
} else {
  console.log(`Sent: ${data.id} (provider ${data.providerMessageId})`);
}
