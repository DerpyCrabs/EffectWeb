import { Context, Effect } from 'effect';
import { expect, it } from 'vitest';
import { program } from './program.js';
import { modelOwner } from './owner.js';
import { domMount, startMount } from './mount.js';
import { eventEffects } from './event-effects.js';
import { Settlement } from './settlement.js';
import { makeUiRuntime } from './runtime.js';

it('runs program commands with the given context and closes them with the application scope', async () => {
  const label = Context.Reference<string>('scoped-test/label', { defaultValue: () => 'default' });
  const key = 'read';
  let released = false;
  let current = '';
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const source = yield* Effect.acquireRelease(
          Effect.sync(() =>
            program({
              context,
              initial: '',
              update: (model: string, _message: 'start') => ({
                model,
                commands: [
                  {
                    key,
                    policy: 'replace' as const,
                    effect: Effect.gen(function* () {
                      current = yield* label;
                      yield* Effect.acquireRelease(Effect.void, () =>
                        Effect.sync(() => {
                          released = true;
                        }),
                      );
                      return yield* Effect.never;
                    }),
                  },
                ],
              }),
            }),
          ),
          (running) => running.close(),
        );
        source.send('start');
        expect(current).toBe('application');
        expect(released).toBe(false);
      }),
    ).pipe(Effect.provideService(label, 'application')),
  );
  expect(released).toBe(true);
});

it('closes a scoped model owner before its acquired dependencies', async () => {
  const order: string[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            order.push('dependency');
          }),
        );
        const owner = yield* Effect.acquireRelease(
          Effect.sync(() => modelOwner({ count: 0 })),
          (owner) => owner.close(),
        );
        owner.run(
          'work',
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.void, () =>
              Effect.sync(() => {
                order.push('work');
              }),
            );
            return yield* Effect.never;
          }),
          'replace',
        );
      }),
    ),
  );
  expect(order).toEqual(['work', 'dependency']);
});

it('keeps a finite DOM acquisition alive until unmount and uses a DOM resource scope', async () => {
  let released = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const binding = domMount((_element: HTMLElement) =>
          Effect.acquireRelease(Effect.succeed('resource'), () =>
            Effect.sync(() => {
              released = true;
            }),
          ),
        );
        const mount = startMount({} as HTMLElement, binding);
        expect(released).toBe(false);
        yield* mount.close();
        expect(released).toBe(true);
      }),
    ),
  );
});

it('runs handler Effects and DOM bindings with the services captured by the mount', async () => {
  const label = Context.Reference('scoped-test/ambient', { defaultValue: () => 'default' });
  const values: string[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeUiRuntime();
        const events = eventEffects(() => {}, new Settlement(runtime));
        events.accept(
          Effect.flatMap(label, (value) =>
            Effect.sync(() => {
              values.push(value);
            }),
          ),
        );
        const mounted = startMount(
          {} as HTMLElement,
          domMount((_element: HTMLElement) =>
            Effect.flatMap(label, (value) =>
              Effect.sync(() => {
                values.push(value);
              }),
            ),
          ),
          undefined,
          runtime,
        );
        yield* mounted.close();
        events.dispose();
      }),
    ).pipe(Effect.provideService(label, 'application')),
  );
  expect(values).toEqual(['application', 'application']);
});
