import { commandSlot } from './program.js';
import { Context, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { effectCommand, program } from './program.js';
import { uiRuntime } from './runtime.js';
import { programDriver, controlledEffect } from './testing.js';
import { observePrograms } from './diagnostics.js';

const commandRead = commandSlot('read');
const commandDelay = commandSlot('delay');
const commandService = commandSlot('service');

describe('public program test driver', () => {
  it('awaits a named slot after its completion message has passed through the real queue', async () => {
    const controlled = controlledEffect<number>();
    const source = program({
      initial: 0,
      update: (model: number, message: number) =>
        message < 0
          ? {
              model,
              commands: [
                effectCommand(commandRead, () => controlled.effect, {
                  policy: 'replace',
                  onSuccess: (value) => value,
                  onFailure: () => 0,
                }),
              ],
            }
          : { model: message },
    });
    const driver = programDriver(source);
    driver.send(-1);
    let settled = false;
    const idle = driver.awaitSlot(commandRead).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    controlled.succeed(9);
    await idle;
    expect(driver.model()).toBe(9);
    expect(driver.activeSlots()).toEqual([]);
    driver.dispose();
  });

  it('shares an Effect test clock context with commands instead of using real timers', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Effect.context<TestClock.TestClock>();
        const runtime = uiRuntime(context);
        const source = runtime.program({
          initial: 0,
          update: (model: number, message: number) =>
            message < 0
              ? {
                  model,
                  commands: [
                    effectCommand(commandDelay, () => Effect.sleep('1 hour').pipe(Effect.as(7)), {
                      policy: 'replace',
                      onSuccess: (value) => value,
                      onFailure: () => 0,
                    }),
                  ],
                }
              : { model: message },
        });
        const driver = programDriver(source, runtime);
        driver.send(-1);
        expect(driver.model()).toBe(0);
        yield* Effect.promise(() => driver.run(TestClock.adjust('1 hour')));
        yield* Effect.promise(() => driver.awaitSlot(commandDelay));
        expect(driver.model()).toBe(7);
        driver.dispose();
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });

  it('rejects missing services at binding boundaries and resolves supplied service implementations', async () => {
    class NumberService extends Context.Service<NumberService, { value: number }>()(
      'Driver/Number',
    ) {}
    const runtime = uiRuntime(Context.make(NumberService, { value: 23 }));
    const source = runtime.program({
      initial: 0,
      update: (model: number, message: number) =>
        message < 0
          ? {
              model,
              commands: [
                effectCommand(
                  commandService,
                  () => Effect.map(NumberService, (service) => service.value),
                  { policy: 'replace', onSuccess: (value) => value, onFailure: () => 0 },
                ),
              ],
            }
          : { model: message },
    });
    source.send(-1);
    await source.awaitIdle();
    expect(source.model()).toBe(23);
    source.dispose();
  });
});

it('bounds metadata history and never stores message payloads or model values', async () => {
  const history = observePrograms(3);
  const source = program({
    name: 'test',
    initial: { secret: 'private' },
    update: (_model, message: { type: 'Change'; text: string }) => ({
      model: { secret: message.text },
    }),
  });
  for (let n = 0; n < 5; n++) source.send({ type: 'Change', text: 'sensitive-message' });
  expect(history.events()).toHaveLength(3);
  expect(history.events()[0]).toMatchObject({ name: 'test', kind: 'update', message: 'Change' });
  expect(JSON.stringify(history.events())).not.toContain('sensitive');
  history.dispose();
  source.dispose();
  expect(history.events()).toHaveLength(3);
});

it('keeps shared services alive while event and DOM owners cancel their own fibers', async () => {
  const { effectEvent, eventEffects } = await import('./effectEvent');
  const { domMount, startMount } = await import('./mount');
  class Service extends Context.Service<Service, { record: () => void }>()('Lifetime/Service') {}
  let started = 0,
    finalized = 0;
  const runtime = uiRuntime(
    Context.make(Service, {
      record: () => {
        started++;
      },
    }),
  );
  const work = Effect.gen(function* () {
    const service = yield* Service;
    service.record();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        finalized++;
      }),
    );
    return yield* Effect.never;
  }).pipe(Effect.scoped);
  const errors: unknown[] = [];
  const events = eventEffects((error) => errors.push(error));
  events.accept(effectEvent('replace', (_event: Event) => work, runtime)(new Event('click')));
  const host = startMount(
    {} as Element,
    domMount((_element: Element) => work, runtime),
  );
  expect(started).toBe(2);
  events.dispose();
  host.dispose();
  await expect.poll(() => finalized).toBe(2);
  await Effect.runPromise(runtime.provide(Effect.map(Service, (service) => service.record())));
  expect(started).toBe(3);
  expect(errors).toEqual([]);
});
