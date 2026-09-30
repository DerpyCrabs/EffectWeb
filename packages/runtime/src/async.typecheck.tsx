import type { Cause } from 'effect';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import { AsyncContent } from './AsyncContent.js';
import type { Slot } from './dom.js';

export function asyncContentTypes(
  result: AsyncResult.AsyncResult<number, 'offline'>,
  content: Slot<number>,
  wrongContent: Slot<string>,
  failure: Slot<Cause.Cause<'offline'>>,
  wrongFailure: Slot<Cause.Cause<'unauthorized'>>,
) {
  const valid = <AsyncContent result={result} content={content} failure={failure} />;
  // @ts-expect-error Available data keeps its type across the generic JSX component boundary.
  const badContent = <AsyncContent result={result} content={wrongContent} />;
  // @ts-expect-error Expected error channels are not widened to unknown by presentation.
  const badFailure = <AsyncContent result={result} content={content} failure={wrongFailure} />;
  void [valid, badContent, badFailure];
}
