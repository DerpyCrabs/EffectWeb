import * as Effect from 'effect/Effect';
import type * as Schema from 'effect/Schema';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import type * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

/** Decode successful JSON through a schema, retaining transport, decoding and service types. */
export function httpJson<S extends Schema.Constraint>(
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
) {
  return HttpClient.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
  );
}
