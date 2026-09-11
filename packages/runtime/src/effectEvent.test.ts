import { Cause, Effect } from 'effect';
import { expect, it } from 'vitest';
import { event, Scope } from './dom.js';
import { effectEvent } from './effectEvent.js';
import type { JSX } from './jsx.js';

it('owns every directly returned Effect and releases acquired resources on listener removal', async () => {
  let started = 0;
  let released = 0;
  const mounted = listener(() =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          started++;
        }),
        () =>
          Effect.sync(() => {
            released++;
          }),
      );
      return yield* Effect.never;
    }),
  );
  mounted.click();
  mounted.click();
  expect(started).toBe(2);
  mounted.scope.dispose();
  await Effect.runPromise(mounted.scope.settlement.wait());
  expect(released).toBe(2);
  expect(mounted.errors).toEqual([]);
});

function listener(handler: (event: Event) => JSX.EventResult) {
  const errors: unknown[] = [];
  const scope = new Scope(
    {},
    () => {},
    (error) => errors.push(error),
  );
  const target = new EventTarget();
  event(scope, target as Element, 'onClick', handler);
  return { scope, errors, target, click: () => target.dispatchEvent(new Event('click')) };
}

function pending() {
  let finish!: () => void;
  let canceled = false;
  const effect = Effect.callback<void>((resume) => {
    finish = () => resume(Effect.void);
    return Effect.sync(() => {
      canceled = true;
    });
  });
  return {
    effect,
    finish: () => finish(),
    started: () => Boolean(finish),
    canceled: () => canceled,
  };
}

it('captures native events on every call while dropping concurrent Effect execution', async () => {
  const work = pending();
  let factories = 0;
  let captured: EventTarget | null = null;
  let started = 0;
  const mounted = listener(
    effectEvent('drop', (event) => {
      factories++;
      captured = event.currentTarget;
      event.preventDefault();
      return Effect.sync(() => {
        started++;
      }).pipe(Effect.andThen(work.effect));
    }),
  );
  const first = new Event('click', { cancelable: true });
  const second = new Event('click', { cancelable: true });
  mounted.target.dispatchEvent(first);
  mounted.target.dispatchEvent(second);
  expect(first.defaultPrevented).toBe(true);
  expect(second.defaultPrevented).toBe(true);
  expect(captured).toBe(mounted.target);
  expect(factories).toBe(2);
  await expect.poll(work.started).toBe(true);
  expect(started).toBe(1);
  work.finish();
  await new Promise((done) => setTimeout(done, 0));
  mounted.click();
  expect(factories).toBe(3);
  mounted.scope.dispose();
});

it('replaces pending work, ignores stale completions, and interrupts on removal', async () => {
  const first = pending();
  const second = pending();
  let calls = 0;
  let completed = 0;
  const mounted = listener(
    effectEvent('replace', () =>
      (++calls === 1 ? first : second).effect.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            completed++;
          }),
        ),
      ),
    ),
  );
  mounted.click();
  await expect.poll(first.started).toBe(true);
  mounted.click();
  await expect.poll(first.canceled).toBe(true);
  await expect.poll(second.started).toBe(true);
  first.finish();
  mounted.scope.dispose();
  await expect.poll(second.canceled).toBe(true);
  second.finish();
  mounted.click();
  await new Promise((done) => setTimeout(done, 0));
  expect(calls).toBe(2);
  expect(completed).toBe(0);
  expect(mounted.errors).toEqual([]);
});

it.each(['failure', 'defect', 'throw'] as const)(
  'reports %s and allows another attempt',
  async (kind) => {
    const problem = new Error(kind);
    let attempts = 0;
    const mounted = listener(
      effectEvent('drop', () => {
        attempts++;
        if (kind === 'throw') throw problem;
        return kind === 'failure' ? Effect.fail(problem) : Effect.die(problem);
      }),
    );
    mounted.click();
    await expect.poll(() => mounted.errors.length).toBe(1);
    expect(
      kind === 'throw'
        ? mounted.errors[0]
        : Cause.squash(mounted.errors[0] as Cause.Cause<unknown>),
    ).toBe(problem);
    mounted.click();
    await expect.poll(() => mounted.errors.length).toBe(2);
    expect(attempts).toBe(2);
    mounted.scope.dispose();
  },
);

it('does not start work when the factory disposes its own listener', async () => {
  let ran = false;
  const mounted = listener(
    effectEvent('drop', () => {
      mounted.scope.dispose();
      return Effect.sync(() => {
        ran = true;
      });
    }),
  );
  mounted.click();
  await new Promise((done) => setTimeout(done, 0));
  expect(ran).toBe(false);
});

it('interrupts a fiber even when it disposes the scope during its synchronous startup', async () => {
  let finalized = false;
  const mounted = listener(
    effectEvent('drop', () =>
      Effect.sync(() => mounted.scope.dispose()).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      ),
    ),
  );
  mounted.click();
  await expect.poll(() => finalized).toBe(true);
  expect(mounted.errors).toEqual([]);
});

it('spread handlers retain work across callback changes and interrupt it on a replacement request or removal', async () => {
  const { bindAttributes } = await import('./dom.js');
  const first = pending();
  const second = pending();
  const handler = effectEvent('replace', () => first.effect);
  const nextHandler = effectEvent('replace', () => second.effect);
  const scope = new Scope<{ onClick?: typeof handler }, never>({ onClick: handler }, () => {});
  const target = new EventTarget();
  bindAttributes(
    scope,
    target as Element,
    () => [scope.value],
    () => scope.value,
  );
  const click = () => target.dispatchEvent(new Event('click'));
  click();
  await expect.poll(first.started).toBe(true);
  scope.set({ onClick: handler });
  expect(first.canceled()).toBe(false);
  scope.set({ onClick: nextHandler });
  expect(first.canceled()).toBe(false);
  click();
  await expect.poll(first.canceled).toBe(true);
  await expect.poll(second.started).toBe(true);
  scope.set({});
  await expect.poll(second.canceled).toBe(true);
  click();
  scope.dispose();
});

it('joins replaced and active event finalizers when the owning scope closes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed: number[] = [];
  let request = 0;
  const mounted = listener(
    effectEvent('replace', () => {
      const id = ++request;
      return Effect.never.pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            await gate;
            closed.push(id);
          }),
        ),
      );
    }),
  );
  mounted.click();
  mounted.click();
  mounted.scope.dispose();
  let settled = false;
  const closing = Effect.runPromise(mounted.scope.settlement.wait()).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await closing;
  expect(closed.sort((a, b) => a - b)).toEqual([1, 2]);
});

it('accounts for event disposal during synchronous acquisition', async () => {
  const mounted = listener(
    effectEvent('replace', () => Effect.sync(() => mounted.scope.dispose())),
  );
  mounted.click();
  await Effect.runPromise(mounted.scope.settlement.wait());
  expect(mounted.scope.disposed).toBe(true);
  expect(mounted.errors).toEqual([]);
});

it('reports finalizer defects from replaced and removed event work before settlement', async () => {
  const problem = new Error('event cleanup failed');
  const mounted = listener(
    effectEvent('replace', () => Effect.never.pipe(Effect.ensuring(Effect.die(problem)))),
  );
  mounted.click();
  mounted.click();
  mounted.scope.dispose();
  await Effect.runPromise(mounted.scope.settlement.wait());
  expect(mounted.errors.map((cause) => Cause.squash(cause as Cause.Cause<unknown>))).toEqual([
    problem,
    problem,
  ]);
});
