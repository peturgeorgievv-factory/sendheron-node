import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type {
  CreateFormSignupRequest,
  FormSignupAcceptedResponse,
} from '../generated.js';

export class Forms {
  constructor(private readonly client: HttpClient) {}

  /**
   * Sign someone up through a signup form, for a form you build yourself.
   * Server side only (a Next.js Server Action or route handler), never in
   * the browser: the API key is a secret. Use a key that holds
   * `signups:create` alone; it can do nothing else.
   *
   * Always double opt-in, whatever the form's own setting: the person gets
   * the form's confirmation email and joins the form's list only once they
   * confirm.
   *
   * The answer is the same `{ status: 'ACCEPTED' }` for every address, so it
   * tells nobody whether an address is subscribed: show "check your inbox"
   * and nothing more.
   *
   * `ipAddress` must be the visitor's real address: behind Cloudflare the
   * `CF-Connecting-IP` header, never an `X-Forwarded-For` value the visitor
   * can write.
   *
   * Limits: 30 a minute per key, hourly and daily ceilings per key, and a
   * per-visitor limit on the IP address you report. Each is a 429 with
   * Retry-After, which the client waits out when it is 30 seconds or less;
   * pass `maxRetries: 0` to answer the visitor at once. Run your own bot
   * check and per-visitor limit first: your Server Action is public.
   *
   * Errors: 400 `signupForms.invalidEmail`, `signupForms.undeliverableEmail`,
   * `signupForms.fieldRequired`, or `validationFailed` for a malformed body;
   * 404 `signupForms.notFound`; 409 `signupForms.unavailable`, the form takes
   * no signups (`error.description` says why).
   */
  signup(
    formId: string,
    payload: CreateFormSignupRequest,
    options?: RequestOptions,
  ): Promise<Result<FormSignupAcceptedResponse>> {
    return this.client.post(
      `/api/v1/forms/${encodeURIComponent(formId)}/signups`,
      payload,
      options,
    );
  }
}
