import * as Cause from 'effect/Cause';
import * as Option from 'effect/Option';
import * as AsyncResult from 'effect/reactivity/AsyncResult';

/** The latest success, including one retained while refreshing or after a failed refresh. */
export const available = <A>(result: AsyncResult.AsyncResult<A, unknown>) =>
  Option.getOrUndefined(AsyncResult.value(result));

/** The display message of a failed result; `undefined` when it has not failed. */
export const resourceError = (
  result: AsyncResult.AsyncResult<unknown, unknown>,
): string | undefined => {
  if (!AsyncResult.isFailure(result)) return undefined;
  const error = Cause.squash(result.cause);
  return error instanceof Error ? error.message : String(error);
};
