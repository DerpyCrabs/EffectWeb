// @vitest-environment happy-dom
import { Cause, Effect } from 'effect';
import { expect, it } from 'vitest';
import { markup, mountViewWithSettlement, view } from './dom.js';
import { createModelOwner, modelOwner } from './owner.js';
import { Settlement } from './settlement.js';
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

const button = markup('button');
/** A mounted button with `attrs`; its scope stands for the lifetime of the listener. */
function mountedButton<Attrs extends object>(initial: Attrs) {
  const errors: unknown[] = [];
  const host = document.createElement('div');
  const owner = createModelOwner<{ attrs: Attrs }, never>({ attrs: initial });
  const settlement = new Settlement();
  const mounted = mountViewWithSettlement(
    host,
    view<{ attrs: Attrs }>((model) => button(model.attrs as Record<string, unknown>)),
    owner.source,
    { send: () => {}, onError: (error) => errors.push(error) },
    settlement,
  );
  let disposed = false;
  const target = host.querySelector('button')!;
  return {
    owner,
    scope: {
      settlement,
      dispose() {
        disposed = true;
        mounted.dispose();
      },
      get disposed() {
        return disposed;
      },
    },
    errors,
    target,
    click: () => target.dispatchEvent(new Event('click')),
  };
}
function listener(handler: (event: Event) => JSX.EventResult) {
  return mountedButton({ onClick: handler });
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

it.each(['failure', 'defect', 'throw'] as const)(
  'reports %s and allows another attempt',
  async (kind) => {
    const problem = new Error(kind);
    let attempts = 0;
    const mounted = listener(() => {
      attempts++;
      if (kind === 'throw') throw problem;
      return kind === 'failure' ? Effect.fail(problem) : Effect.die(problem);
    });
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

it('does not start work when the handler disposes its own listener', async () => {
  let ran = false;
  const mounted = listener(() => {
    mounted.scope.dispose();
    return Effect.sync(() => {
      ran = true;
    });
  });
  mounted.click();
  await new Promise((done) => setTimeout(done, 0));
  expect(ran).toBe(false);
});

it('interrupts a fiber even when it disposes the scope during its synchronous startup', async () => {
  let finalized = false;
  const mounted = listener(() =>
    Effect.sync(() => mounted.scope.dispose()).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          finalized = true;
        }),
      ),
    ),
  );
  mounted.click();
  await expect.poll(() => finalized).toBe(true);
  expect(mounted.errors).toEqual([]);
});

it('spread handlers retain work across callback changes and interrupt it on removal', async () => {
  const first = pending();
  const second = pending();
  const handler = () => first.effect;
  const nextHandler = () => second.effect;
  const mounted = mountedButton<{ onClick?: typeof handler; title?: string }>({ onClick: handler });
  const scope = {
    set: (attrs: { onClick?: typeof handler; title?: string }) => mounted.owner.patch({ attrs }),
    dispose: () => mounted.scope.dispose(),
  };
  const click = mounted.click;
  click();
  await expect.poll(first.started).toBe(true);
  scope.set({ onClick: handler });
  expect(first.canceled()).toBe(false);
  scope.set({ onClick: nextHandler });
  expect(first.canceled()).toBe(false);
  click();
  await expect.poll(second.started).toBe(true);
  expect(first.canceled()).toBe(false);
  scope.set({});
  await expect.poll(first.canceled).toBe(true);
  await expect.poll(second.canceled).toBe(true);
  click();
  scope.dispose();
});

it('joins every active event finalizer when the owning scope closes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed: number[] = [];
  let request = 0;
  const mounted = listener(() => {
    const id = ++request;
    return Effect.never.pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          await gate;
          closed.push(id);
        }),
      ),
    );
  });
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
  const mounted = listener(() => Effect.sync(() => mounted.scope.dispose()));
  mounted.click();
  await Effect.runPromise(mounted.scope.settlement.wait());
  expect(mounted.scope.disposed).toBe(true);
  expect(mounted.errors).toEqual([]);
});

it('reports finalizer defects from removed event work before settlement', async () => {
  const problem = new Error('event cleanup failed');
  const mounted = listener(() => Effect.never.pipe(Effect.ensuring(Effect.die(problem))));
  mounted.click();
  mounted.click();
  mounted.scope.dispose();
  await Effect.runPromise(mounted.scope.settlement.wait());
  expect(mounted.errors.map((cause) => Cause.squash(cause as Cause.Cause<unknown>))).toEqual([
    problem,
    problem,
  ]);
});

it('a handler may return the handle of work an owner started; the listener runs nothing for it', async () => {
  const work = modelOwner({});
  let runs = 0;
  const mounted = listener(() =>
    work.run(
      'save',
      Effect.sync(() => {
        runs++;
      }),
      'drop',
    ),
  );
  mounted.click();
  expect(runs).toBe(1);
  // No listener-owned fiber was started, so nothing is pending on the listener.
  mounted.scope.dispose();
  await Effect.runPromise(mounted.scope.settlement.wait());
  expect(mounted.errors).toEqual([]);
  work.dispose();
});
