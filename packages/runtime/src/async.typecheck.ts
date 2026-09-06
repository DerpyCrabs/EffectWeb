import type { Cause } from 'effect';
import type * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { AsyncContent } from './AsyncContent.js';
import type { Slot } from './dom.js';

export function asyncContentTypes(
  result: AsyncResult.AsyncResult<number, 'offline'>,
  content: Slot<number>,
  wrongContent: Slot<string>,
  failure: Slot<Cause.Cause<'offline'>>,
  wrongFailure: Slot<Cause.Cause<'unauthorized'>>,
) {
  AsyncContent({ result, content, failure });
  // @ts-expect-error Available data keeps its type across the generic JSX component boundary.
  AsyncContent({ result, content: wrongContent });
  // @ts-expect-error Expected error channels are not widened to unknown by presentation.
  AsyncContent({ result, content, failure: wrongFailure });
}
