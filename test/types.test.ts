import { describe, expectTypeOf, it } from 'vitest';
import type {
  ListSuppressionsParams,
  ListTemplatesParams,
  Result,
  Routes,
  SendHeron,
} from '../src/index.js';

/**
 * Compile-time pins: every method takes the body and query its route
 * declares and answers what the route answers, as generated from the API
 * document. `pnpm typecheck` fails when a method drifts from its route;
 * at run time these tests do nothing.
 */
type Answer<Route extends keyof Routes> = Promise<
  Result<Routes[Route]['response']>
>;
type Body<Route extends keyof Routes> = Routes[Route] extends {
  body: infer Payload;
}
  ? Payload
  : never;
type Query<Route extends keyof Routes> = Routes[Route] extends {
  query: infer Params;
}
  ? Params
  : never;

type Emails = SendHeron['emails'];
type Templates = SendHeron['templates'];
type Suppressions = SendHeron['suppressions'];

describe('every method is typed as its route', () => {
  it('emails', () => {
    expectTypeOf<ReturnType<Emails['send']>>().toEqualTypeOf<
      Answer<'POST /api/v1/emails/send'>
    >();
    expectTypeOf<ReturnType<Emails['sendTemplate']>>().toEqualTypeOf<
      Answer<'POST /api/v1/emails/send-template'>
    >();
    expectTypeOf<ReturnType<Emails['sendBulk']>>().toEqualTypeOf<
      Answer<'POST /api/v1/emails/send-bulk'>
    >();
    expectTypeOf<ReturnType<Emails['get']>>().toEqualTypeOf<
      Answer<'GET /api/v1/emails/{id}'>
    >();
    expectTypeOf<ReturnType<Emails['cancelScheduled']>>().toEqualTypeOf<
      Answer<'DELETE /api/v1/emails/scheduled/{id}'>
    >();

    // The payloads are the API's, with `sendAt` also taking a Date.
    expectTypeOf<Omit<Parameters<Emails['send']>[0], 'sendAt'>>().toEqualTypeOf<
      Omit<Body<'POST /api/v1/emails/send'>, 'sendAt'>
    >();
    expectTypeOf<
      Omit<Parameters<Emails['sendTemplate']>[0], 'sendAt'>
    >().toEqualTypeOf<
      Omit<Body<'POST /api/v1/emails/send-template'>, 'sendAt'>
    >();
    expectTypeOf<Parameters<Emails['sendBulk']>[0]>().toEqualTypeOf<
      Body<'POST /api/v1/emails/send-bulk'>
    >();
  });

  it('templates', () => {
    expectTypeOf<ReturnType<Templates['list']>>().toEqualTypeOf<
      Answer<'GET /api/v1/templates'>
    >();
    expectTypeOf<ListTemplatesParams>().toEqualTypeOf<
      Query<'GET /api/v1/templates'>
    >();
    expectTypeOf<ReturnType<Templates['get']>>().toEqualTypeOf<
      Answer<'GET /api/v1/templates/{id}'>
    >();
    expectTypeOf<ReturnType<Templates['create']>>().toEqualTypeOf<
      Answer<'POST /api/v1/templates'>
    >();
    expectTypeOf<Parameters<Templates['create']>[0]>().toEqualTypeOf<
      Body<'POST /api/v1/templates'>
    >();
    expectTypeOf<ReturnType<Templates['update']>>().toEqualTypeOf<
      Answer<'PATCH /api/v1/templates/{id}'>
    >();
    expectTypeOf<Parameters<Templates['update']>[1]>().toEqualTypeOf<
      Body<'PATCH /api/v1/templates/{id}'>
    >();
    expectTypeOf<ReturnType<Templates['remove']>>().toEqualTypeOf<
      Answer<'DELETE /api/v1/templates/{id}'>
    >();
    expectTypeOf<ReturnType<Templates['preview']>>().toEqualTypeOf<
      Answer<'POST /api/v1/templates/preview'>
    >();
    expectTypeOf<Parameters<Templates['preview']>[0]>().toEqualTypeOf<
      Body<'POST /api/v1/templates/preview'>
    >();
    expectTypeOf<ReturnType<Templates['validate']>>().toEqualTypeOf<
      Answer<'POST /api/v1/templates/validate'>
    >();
  });

  it('suppressions', () => {
    expectTypeOf<ReturnType<Suppressions['list']>>().toEqualTypeOf<
      Answer<'GET /api/v1/suppressions'>
    >();
    expectTypeOf<ListSuppressionsParams>().toEqualTypeOf<
      Query<'GET /api/v1/suppressions'>
    >();
    expectTypeOf<ReturnType<Suppressions['check']>>().toEqualTypeOf<
      Answer<'GET /api/v1/suppressions/check'>
    >();
    expectTypeOf<ReturnType<Suppressions['add']>>().toEqualTypeOf<
      Answer<'POST /api/v1/suppressions'>
    >();
    expectTypeOf<Parameters<Suppressions['add']>[0]>().toEqualTypeOf<
      Body<'POST /api/v1/suppressions'>
    >();
    expectTypeOf<ReturnType<Suppressions['remove']>>().toEqualTypeOf<
      Answer<'DELETE /api/v1/suppressions/{email}'>
    >();
  });

  it('usage and forms', () => {
    expectTypeOf<ReturnType<SendHeron['usage']['get']>>().toEqualTypeOf<
      Answer<'GET /api/v1/usage'>
    >();
    expectTypeOf<ReturnType<SendHeron['forms']['signup']>>().toEqualTypeOf<
      Answer<'POST /api/v1/forms/{formId}/signups'>
    >();
    expectTypeOf<Parameters<SendHeron['forms']['signup']>[1]>().toEqualTypeOf<
      Body<'POST /api/v1/forms/{formId}/signups'>
    >();
  });
});
