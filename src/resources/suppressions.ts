import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type {
  EmailDeliverability,
  ListSuppressionsParams,
  PaginatedResult,
  SuppressionEntry,
} from '../types.js';

export class Suppressions {
  constructor(private readonly client: HttpClient) {}

  list(
    params?: ListSuppressionsParams,
    options?: RequestOptions,
  ): Promise<Result<PaginatedResult<SuppressionEntry>>> {
    return this.client.get('/api/v1/suppressions', { ...params }, options);
  }

  /**
   * "Would we send to this address, and if not, why": answered per stream
   * by the same gate function the send paths run. A consent-suppressed
   * address still legitimately receives transactional mail. A sender-side
   * `blockReason` (`isSenderSideBlock`), such as `SENDER_UNDER_REVIEW` or
   * `ORG_SENDING_PAUSED`, is about your organization, not the address: do
   * not drop the address over it.
   */
  check(
    email: string,
    options?: RequestOptions,
  ): Promise<Result<EmailDeliverability>> {
    return this.client.get('/api/v1/suppressions/check', { email }, options);
  }

  /** Manually suppress. Only manual reasons: bounce/complaint are recorded by the platform. */
  add(
    payload: { email: string; reason?: 'manual' | 'admin'; note?: string },
    options?: RequestOptions,
  ): Promise<Result<SuppressionEntry>> {
    return this.client.post('/api/v1/suppressions', payload, options);
  }

  /**
   * Lift one address. Lifting a bounce/complaint (hard tier) requires
   * `confirmHardTier: true`: it also clears the provider-side lists.
   */
  remove(
    email: string,
    body?: { confirmHardTier?: boolean; note?: string },
    options?: RequestOptions,
  ): Promise<Result<unknown>> {
    return this.client.delete(
      `/api/v1/suppressions/${encodeURIComponent(email)}`,
      body,
      options,
    );
  }
}
