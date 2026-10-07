import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { modelOwner, type RunPolicy } from './owner.js';
import { controlledEffect } from './testing.js';

it('tuple keys avoid collisions introduced by a string-only key convenience', async () => {
  const owner = modelOwner({});
  const request = controlledEffect<void>();
  const a = ['a:b', 'c'] as const;
  const b = ['a', 'b:c'] as const;
  expect(a.join(':')).toBe(b.join(':'));
  owner.run(a.join(':'), request.effect, 'drop');
  owner.run(b.join(':'), request.effect, 'drop');
  expect(request.pending()).toBe(1);
  owner.cancel(a.join(':'));
  await Effect.runPromise(owner.awaitIdle());
  owner.run(a, request.effect, 'drop');
  owner.run(b, request.effect, 'drop');
  expect(request.pending()).toBe(2);
  // Fresh arrays identify the same slot, so callers need no memoized key object.
  owner.run(['a:b', 'c'], request.effect, 'drop');
  expect(request.pending()).toBe(2);
  await Effect.runPromise(owner.close());
});

const expectations = {
  replace: { starts: ['first', 'middle', 'last'], completes: ['last'], canceled: 2 },
  drop: { starts: ['first'], completes: ['first'], canceled: 0 },
  queue: {
    starts: ['first', 'middle', 'last'],
    completes: ['first', 'middle', 'last'],
    canceled: 0,
  },
  'latest-queued': { starts: ['first', 'last'], completes: ['first', 'last'], canceled: 0 },
  parallel: {
    starts: ['first', 'middle', 'last'],
    completes: ['last', 'middle', 'first'],
    canceled: 0,
  },
} satisfies Record<RunPolicy, { starts: string[]; completes: string[]; canceled: number }>;

// Same application trigger, three edits while the first request is unfinished.
// Observe externally visible work, not private queue representation.
it.each(Object.keys(expectations) as RunPolicy[])(
  '%s has a distinct outcome for three edits while a request is active',
  async (policy) => {
    const owner = modelOwner({});
    const starts: string[] = [];
    const completes: string[] = [];
    const requests = {
      first: controlledEffect<void>(),
      middle: controlledEffect<void>(),
      last: controlledEffect<void>(),
    };
    const run = (name: keyof typeof requests) =>
      owner.run(
        'save',
        Effect.suspend(() => {
          starts.push(name);
          return requests[name].effect.pipe(
            Effect.tap(() => Effect.sync(() => completes.push(name))),
          );
        }),
        policy,
      );
    try {
      run('first');
      run('middle');
      run('last');
      if (policy === 'replace') {
        await vi.waitFor(() => expect(requests.last.pending()).toBe(1));
        requests.last.succeed(undefined);
      } else if (policy === 'parallel') {
        // Independent work can complete out of admission order.
        requests.last.succeed(undefined);
        requests.middle.succeed(undefined);
        requests.first.succeed(undefined);
      } else {
        requests.first.succeed(undefined);
        if (policy === 'queue') {
          await vi.waitFor(() => expect(requests.middle.pending()).toBe(1));
          requests.middle.succeed(undefined);
        }
        if (policy === 'queue' || policy === 'latest-queued') {
          await vi.waitFor(() => expect(requests.last.pending()).toBe(1));
          requests.last.succeed(undefined);
        }
      }
      await Effect.runPromise(owner.awaitIdle());
      expect(starts).toEqual(expectations[policy].starts);
      expect(completes).toEqual(expectations[policy].completes);
      expect(
        Object.values(requests).reduce((total, request) => total + request.canceled(), 0),
      ).toBe(expectations[policy].canceled);
    } finally {
      await Effect.runPromise(owner.close());
    }
  },
);
