import { Cause, Effect } from 'effect';
import { expect, it } from 'vitest';
import { attach, Scope } from './dom.js';
import { domMount } from './mount.js';

it.each(['callback', 'object', 'effect'] as const)(
  'disposes a %s acquired while its owner removes itself',
  async (kind) => {
    const scope = new Scope({}, () => {});
    let released = 0;
    const release = () => {
      released++;
    };
    const host = domMount(() => {
      scope.dispose();
      return kind === 'callback'
        ? release
        : kind === 'object'
          ? { dispose: release }
          : Effect.never.pipe(Effect.ensuring(Effect.sync(release)));
    });
    attach(
      scope,
      new EventTarget() as Element,
      () => [],
      () => host,
    );
    await expect.poll(() => released).toBe(1);
    scope.dispose();
    expect(released).toBe(1);
  },
);

it('releases an acquisition superseded synchronously by another host', async () => {
  const scope = new Scope(0, () => {});
  const released: string[] = [];
  const second = domMount(() => () => {
    released.push('second');
  });
  const first = domMount(() => {
    scope.set(1);
    return () => {
      released.push('first');
    };
  });
  attach(
    scope,
    new EventTarget() as Element,
    () => [scope.value],
    () => (scope.value ? second : first),
  );
  await expect.poll(() => released).toEqual(['first']);
  scope.dispose();
  expect(released).toEqual(['first', 'second']);
});

it('accounts for close requested before reentrant DOM acquisition returns its fiber', async () => {
  const scope = new Scope({}, () => {});
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closing!: Promise<void>;
  const binding = domMount(() => {
    scope.dispose();
    closing = Effect.runPromise(scope.settlement.wait());
    return Effect.never.pipe(Effect.ensuring(Effect.promise(() => gate)));
  });
  attach(
    scope,
    new EventTarget() as Element,
    () => [],
    () => binding,
  );
  await Promise.resolve();
  let closed = false;
  closing.then(
    () => {
      closed = true;
    },
    () => {},
  );
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  await closing;
  expect(closed).toBe(true);
});

it('reports an interrupted DOM finalizer defect before its scope settles', async () => {
  const errors: unknown[] = [];
  const problem = new Error('DOM cleanup failed');
  const scope = new Scope(
    {},
    () => {},
    (cause) => {
      errors.push(Cause.squash(cause as Cause.Cause<unknown>));
    },
  );
  const binding = domMount(() => Effect.never.pipe(Effect.ensuring(Effect.die(problem))));
  attach(
    scope,
    new EventTarget() as Element,
    () => [],
    () => binding,
  );
  await Promise.resolve();
  scope.dispose();
  await Effect.runPromise(scope.settlement.wait());
  expect(errors).toEqual([problem]);
});
