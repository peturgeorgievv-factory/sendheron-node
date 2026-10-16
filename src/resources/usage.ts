import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type { OrganizationUsage } from '../types.js';

export class Usage {
  constructor(private readonly client: HttpClient) {}

  /**
   * The organization's monthly send-pool position: the same math the plan
   * gates run: plus every other plan cap (contacts, domains, workspaces,
   * team members) and the API rate ceilings. Monitor
   * `monthlySends.transactionalRemaining` instead of discovering
   * `subscription.transactionalGraceExhausted` on a password reset, and
   * `plan.trialEndsAt` / `plan.lapsedReason` / `plan.sendingReview` instead
   * of learning that the trial ended, that the card failed, or that the
   * account is still under sender review, from a send being refused.
   * `sending` is the rolling 24-hour position on the shared sending quota
   * and the new-sender warm-up: `sending.held` counts the sends waiting
   * now. Pool and plan-cap numbers are null for organizations without an
   * active subscription cap.
   */
  get(options?: RequestOptions): Promise<Result<OrganizationUsage>> {
    return this.client.get('/api/v1/usage', undefined, options);
  }
}
