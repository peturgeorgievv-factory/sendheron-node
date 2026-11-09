import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type {
  DeletedResponse,
  PaginatedResponse,
  SuppressEmailRequest,
  SuppressionCheckResponse,
  SuppressionEntryResponse,
} from '../generated.js';
import type { ListSuppressionsParams } from '../types.js';

export class Suppressions {
  constructor(private readonly client: HttpClient) {}

  /**
   * The addresses SendHeron refuses to send to from this key's workspace,
   * with reason, tier, source and timestamp: the workspace's own opt-outs,
   * and the organization's bounces and complaints for addresses the
   * workspace has as contacts or has sent to. `tier: 'HARD'` (bounce,
   * complaint) blocks every stream, transactional included; `'CONSENT'`
   * blocks marketing only. `page` is zero-based, `limit` at most 100.
   */
  list(
    params?: ListSuppressionsParams,
    options?: RequestOptions,
  ): Promise<Result<PaginatedResponse<SuppressionEntryResponse>>> {
    return this.client.get('/api/v1/suppressions', { ...params }, options);
  }

  /**
   * "Would we send to this address, and if not, why": answered per stream,
   * because a consent-suppressed address still legitimately receives
   * transactional mail. This is the recipient and organization verdict
   * (suppression tiers, contact status, address screening, sending pause);
   * sender configuration, list opt-outs and an archived workspace are only
   * evaluated on a real send, so `allowed: true` is not a promise that a
   * send goes out. A sender-side `blockReason` (`isSenderSideBlock`), such
   * as `SENDER_UNDER_REVIEW` or `ORG_SENDING_PAUSED`, is about your
   * organization, not the address: do not drop the address over it.
   * `ADDRESS_UNDELIVERABLE` is about the address: it cannot receive email,
   * so drop it. `knownHardBounce` says it hard-bounced as nonexistent
   * somewhere on the platform, and `screeningVerdict`, `screeningReasons`
   * and `suggestedEmail` repeat the matching contact's screening. A
   * malformed address is a 400 error, not a verdict.
   */
  check(
    email: string,
    options?: RequestOptions,
  ): Promise<Result<SuppressionCheckResponse>> {
    return this.client.get('/api/v1/suppressions/check', { email }, options);
  }

  /**
   * Manually suppress, as `MANUAL` (the default) or `ADMIN`. Bounces and
   * complaints are recorded by the platform from provider events.
   */
  add(
    payload: SuppressEmailRequest,
    options?: RequestOptions,
  ): Promise<Result<SuppressionEntryResponse>> {
    return this.client.post('/api/v1/suppressions', payload, options);
  }

  /**
   * Lifts this workspace's own opt-outs of one address, and answers
   * `{ deleted: true }`. A bounce or complaint is lifted by the account
   * owner in the dashboard, not through the API: it blocks every workspace
   * of the account, so an address that bounced or complained gets a 403
   * `compliance.organizationWideSuppressionOwnerOnly` whatever the key, even
   * when it also has an opt-out of this workspace.
   */
  remove(
    email: string,
    options?: RequestOptions,
  ): Promise<Result<DeletedResponse>> {
    return this.client.delete(
      `/api/v1/suppressions/${encodeURIComponent(email)}`,
      options,
    );
  }
}
