import { Effect } from 'effect';
import type { Entry, Storage } from './app';
// A synchronous adapter needs no changes to the UI or its messages.
export const memoryStorage = (initial: readonly Entry[] = []): Storage => {
  let entries = initial;
  return {
    load: Effect.sync(() => entries),
    save: (next) =>
      Effect.sync(() => {
        entries = next;
      }),
  };
};
