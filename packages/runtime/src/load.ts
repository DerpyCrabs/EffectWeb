import { Effect } from 'effect';

/** Loaders stay lazy and use one error/cancellation model, whether their work is sync or async. */
export type UiLoad<A, E = unknown, R = never> = Effect.Effect<A, E, R>;
export const loadEffect = <A, E, R>(load: () => UiLoad<A, E, R>): UiLoad<A, E, R> =>
  Effect.suspend(load);

/** Adapt Promise libraries at the integration boundary. Pass the signal to APIs that support it. */
export const fromPromise = <A>(load: (signal: AbortSignal) => PromiseLike<A>): UiLoad<A> =>
  Effect.tryPromise({ try: load, catch: (error) => error });

export interface UiPage<A, Cursor> {
  items: A[];
  totalCount?: number;
  next: Cursor | undefined;
}

/** Read a local cache when executed, then acquire missing data through the same Effect contract. */
export function cachedLoad<A, E, R>(
  read: () => A | undefined,
  load: () => UiLoad<A, E, R>,
): UiLoad<A, E, R> {
  return Effect.suspend(() => {
    const value = read();
    return value === undefined ? load() : Effect.succeed(value);
  });
}
