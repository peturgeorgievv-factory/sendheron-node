import type { HttpClient, RequestOptions } from '../client.js';
import type { Result } from '../errors.js';
import type {
  CreateTemplatePayload,
  ListTemplatesParams,
  PaginatedResult,
  PreviewTemplatePayload,
  Template,
  TemplatePreview,
  UpdateTemplatePayload,
} from '../types.js';

export class Templates {
  constructor(private readonly client: HttpClient) {}

  list(
    params?: ListTemplatesParams,
    options?: RequestOptions,
  ): Promise<Result<PaginatedResult<Template>>> {
    return this.client.get('/api/v1/templates', { ...params }, options);
  }

  get(id: string, options?: RequestOptions): Promise<Result<Template>> {
    return this.client.get(
      `/api/v1/templates/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }

  /** `emailType` is required: the type decides suppression behavior. */
  create(
    payload: CreateTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<Template>> {
    return this.client.post('/api/v1/templates', payload, options);
  }

  /**
   * Partial update. Changing `emailType` requires
   * `confirmEmailTypeChange: true`: reclassifying decides which suppression
   * tiers apply to every future send.
   */
  update(
    id: string,
    payload: UpdateTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<Template>> {
    return this.client.patch(
      `/api/v1/templates/${encodeURIComponent(id)}`,
      payload,
      options,
    );
  }

  /** Resolves to the API's literal `true` on success. */
  remove(id: string, options?: RequestOptions): Promise<Result<boolean>> {
    return this.client.delete(
      `/api/v1/templates/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }

  /**
   * Render unsaved content exactly as a send would: including the flags
   * that catch authoring hazards (`unsubscribeVariableIgnored`,
   * `hasUnrecognizedUnsubscribeLink`, `injectedUnsubscribeFooter`).
   */
  preview(
    payload: PreviewTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<TemplatePreview>> {
    return this.client.post('/api/v1/templates/preview', payload, options);
  }

  validate(
    document: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<Result<{ valid: boolean; issues: string[] }>> {
    return this.client.post('/api/v1/templates/validate', { document }, options);
  }
}
