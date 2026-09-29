import * as Effect from 'effect/Effect';

/** Adapt Promise libraries at the integration boundary. Pass the signal to APIs that support it. */
export const fromPromise = <A>(
  load: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, unknown> => Effect.tryPromise({ try: load, catch: (error) => error });

export interface UiPage<A, Cursor> {
  readonly items: readonly A[];
  readonly totalCount?: number;
  readonly next: Cursor | undefined;
}
