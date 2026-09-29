import * as Cause from 'effect/Cause';
import * as Option from 'effect/Option';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';

/** The latest success, including one retained while refreshing or after a failed refresh. */
export const available = <A>(result: AsyncResult.AsyncResult<A, unknown>) =>
  Option.getOrUndefined(AsyncResult.value(result));

/** A display message for a failed result, or an empty string. */
export const resourceError = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
  if (!AsyncResult.isFailure(result)) return '';
  const error = Cause.squash(result.cause);
  return error instanceof Error ? error.message : String(error);
};
