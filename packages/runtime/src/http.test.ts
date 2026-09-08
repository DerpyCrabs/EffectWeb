import { Effect, Schema } from 'effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { expect, it } from 'vitest';
import { httpJson } from './http.js';

const Person = Schema.Struct({ id: Schema.String, count: Schema.Number });
const request = HttpClientRequest.get('https://example.test/person');
const fetchJson = (body: unknown, status = 200) =>
  httpJson(request, Person).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, async () => Response.json(body, { status })),
  );
it('infers successful HTTP values from the decoder', async () => {
  expect(await Effect.runPromise(fetchJson({ id: 'a', count: 3 }))).toEqual({ id: 'a', count: 3 });
});
it('rejects malformed JSON data and unsuccessful HTTP status before publication', async () => {
  expect(await Effect.runPromiseExit(fetchJson({ id: 'a', count: 'wrong' }))).toMatchObject({
    _tag: 'Failure',
  });
  expect(await Effect.runPromiseExit(fetchJson({ id: 'a', count: 3 }, 500))).toMatchObject({
    _tag: 'Failure',
  });
});
it('retains HTTP service requirements and decoder result types', () => {
  const effect = httpJson(request, Person);
  const typingOnly = () => {
    // @ts-expect-error The application must supply its HTTP transport service.
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- Negative type probe deliberately omits HTTP transport and is never executed.
    const invalid = Effect.runPromise(effect);
    invalid.catch(() => {});
    // @ts-expect-error Consumers cannot choose a response type independently of the decoder.
    const wrong: Effect.Effect<string, unknown, unknown> = effect;
    void wrong;
  };
  void typingOnly;
});
