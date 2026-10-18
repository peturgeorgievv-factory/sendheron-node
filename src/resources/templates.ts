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

  /**
   * `emailType` is required: the type decides suppression behavior.
   * `previewText` is the line inboxes show after the subject, and every
   * send of the template carries it as a hidden preheader. Over 200
   * characters it is a 400 `templates.previewTextTooLong`.
   */
  create(
    payload: CreateTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<Template>> {
    return this.client.post('/api/v1/templates', payload, options);
  }

  /**
   * Partial update. Changing `emailType` requires
   * `confirmEmailTypeChange: true`: reclassifying decides which suppression
   * tiers apply to every future send. `previewText: null`, or an empty
   * string, removes the preview text; leaving it out keeps it.
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
   * `hasUnrecognizedUnsubscribeLink`, `injectedUnsubscribeFooter`). Pass
   * `subject` and `previewText` to see them rendered (`renderedSubject`,
   * `renderedPreviewText`) and the preview text placed as the hidden
   * preheader.
   */
  preview(
    payload: PreviewTemplatePayload,
    options?: RequestOptions,
  ): Promise<Result<TemplatePreview>> {
    return this.client.post('/api/v1/templates/preview', payload, options);
  }

  /**
   * Check a block document without saving it: every issue that would
   * refuse it, and an empty list when it would save.
   */
  validate(
    document: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<Result<{ valid: boolean; issues: string[] }>>;
  /**
   * Check a block document with the preview text the template will carry.
   * Its hidden preheader is sent in the same body, so it counts toward the
   * size limit; past its own length limit (200 characters) it is reported
   * as an issue, not a 400. Null or undefined checks the document alone.
   */
  validate(
    document: Record<string, unknown>,
    previewText: string | null | undefined,
    options?: RequestOptions,
  ): Promise<Result<{ valid: boolean; issues: string[] }>>;
  validate(
    document: Record<string, unknown>,
    previewTextOrOptions?: string | null | RequestOptions,
    options?: RequestOptions,
  ): Promise<Result<{ valid: boolean; issues: string[] }>> {
    // The second argument was the request options before preview text
    // existed, and still is when it is an object.
    const isOptions =
      typeof previewTextOrOptions === 'object' && previewTextOrOptions !== null;
    return this.client.post(
      '/api/v1/templates/validate',
      {
        document,
        previewText:
          typeof previewTextOrOptions === 'string'
            ? previewTextOrOptions
            : undefined,
      },
      isOptions ? previewTextOrOptions : options,
    );
  }
}
