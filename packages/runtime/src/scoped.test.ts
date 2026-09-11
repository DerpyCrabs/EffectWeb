import { Context, Effect, Scope } from 'effect';
import { expect, it } from 'vitest';
import { commandSlot, makeProgram } from './program.js';
import { makeModelOwner } from './owner.js';
import { domMount, startMount } from './mount.js';
import { effectEvent, eventEffects } from './effectEvent.js';
import { Settlement } from './settlement.js';
import { makeUiRuntime, uiRuntime } from './runtime.js';

it('captures application services and closes program work with the application scope', async () => {
  const label = Context.Reference<string>('scoped-test/label', { defaultValue: () => 'default' });
  const slot = commandSlot('read');
  let released = false;
  let current = '';
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* makeProgram({
          initial: '',
          update: (model: string, _message: 'start') => ({
            model,
            commands: [
              {
                slot,
                policy: 'replace' as const,
                action: Effect.gen(function* () {
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
        });
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
        const owner = yield* makeModelOwner({ count: 0 });
        owner.run(
          commandSlot('work'),
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
        const runtime = uiRuntime(yield* Effect.context<Scope.Scope>());
        const binding = domMount(
          (_element: HTMLElement) =>
            Effect.acquireRelease(Effect.succeed('resource'), () =>
              Effect.sync(() => {
                released = true;
              }),
            ),
          runtime,
        );
        const mount = startMount({} as HTMLElement, binding);
        expect(released).toBe(false);
        yield* mount.close();
        expect(released).toBe(true);
      }),
    ),
  );
});

it('inherits ambient services for event policies and DOM bindings without an explicit runtime', async () => {
  const label = Context.Reference('scoped-test/ambient', { defaultValue: () => 'default' });
  const values: string[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeUiRuntime();
        const events = eventEffects(() => {}, new Settlement(runtime));
        const click = effectEvent('drop', (_event: Event) =>
          Effect.flatMap(label, (value) =>
            Effect.sync(() => {
              values.push(value);
            }),
          ),
        );
        events.accept(click({} as Event));
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
