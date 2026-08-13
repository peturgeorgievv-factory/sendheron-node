import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type { OrganizationUsage } from '../types.js';

export class Usage {
  constructor(private readonly client: HttpClient) {}

  /**
   * The organization's monthly send-pool position — the same math the plan
   * gates run — plus the API rate ceilings. Monitor
   * `monthlySends.transactionalRemaining` instead of discovering
   * `subscription.transactionalGraceExhausted` on a password reset. Numeric
   * fields are null for organizations without an active subscription cap.
   */
  get(options?: RequestOptions): Promise<Result<OrganizationUsage>> {
    return this.client.get('/api/v1/usage', undefined, options);
  }
}
