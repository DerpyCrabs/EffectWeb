import { Context, Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { program } from './program.js';
import { controlledEffect } from './testing.js';
import { programDriver } from '../../../tests/fixtures/testing-support.js';

const commandRead = 'read';
const commandDelay = 'delay';
const commandService = 'service';

describe('public program test driver', () => {
  it('forwards close so a wrapped program still joins its finalizers', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const gate = Deferred.makeUnsafe<void>();
        let finalized = false;
        const source = program({
          initial: 0,
          update: (model: number, _message: void) => ({
            model,
            commands: [
              {
                key: commandRead,
                policy: 'replace' as const,
                effect: Effect.never.pipe(
                  Effect.ensuring(
                    Effect.gen(function* () {
                      yield* Deferred.await(gate);
                      finalized = true;
                    }),
                  ),
                ),
              },
            ],
          }),
        });
        const driver = programDriver(source);
        driver.send();
        const close = driver.close;
        expect(close).toBeTypeOf('function');
        const closing = Effect.runFork(close());
        expect(finalized).toBe(false);
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(closing);
        expect(finalized).toBe(true);
      }),
    ));
  it('awaits a key after its completion message has passed through the real queue', async () => {
    const controlled = controlledEffect<number>();
    const source = program({
      initial: 0,
      update: (model: number, message: number) =>
        message < 0
          ? {
              model,
              commands: [
                {
                  key: commandRead,
                  policy: 'replace',
                  effect: controlled.effect.pipe(
                    Effect.matchCause({ onSuccess: (value) => value, onFailure: () => 0 }),
                  ),
                },
              ],
            }
          : { model: message },
    });
    const driver = programDriver(source);
    driver.send(-1);
    let settled = false;
    const idle = Effect.runPromise(driver.awaitKey(commandRead)).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    controlled.succeed(9);
    await idle;
    expect(driver.model()).toBe(9);
    driver.dispose();
  });

  it('shares an Effect test clock context with commands instead of using real timers', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Effect.context<TestClock.TestClock>();
        const source = program({
          context,
          initial: 0,
          update: (model: number, message: number) =>
            message < 0
              ? {
                  model,
                  commands: [
                    {
                      key: commandDelay,
                      policy: 'replace',
                      effect: Effect.sleep('1 hour').pipe(
                        Effect.as(7),
                        Effect.matchCause({ onSuccess: (value) => value, onFailure: () => 0 }),
                      ),
                    },
                  ],
                }
              : { model: message },
        });
        const driver = programDriver(source, context);
        driver.send(-1);
        expect(driver.model()).toBe(0);
        yield* driver.run(TestClock.adjust('1 hour'));
        yield* driver.awaitKey(commandDelay);
        expect(driver.model()).toBe(7);
        driver.dispose();
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });

  it('rejects missing services at binding boundaries and resolves supplied service implementations', async () => {
    class NumberService extends Context.Service<NumberService, { value: number }>()(
      'Driver/Number',
    ) {}
    const source = program({
      context: Context.make(NumberService, { value: 23 }),
      initial: 0,
      update: (model: number, message: number) =>
        message < 0
          ? {
              model,
              commands: [
                {
                  key: commandService,
                  policy: 'replace',
                  effect: Effect.map(NumberService, (service) => service.value).pipe(
                    Effect.matchCause({ onSuccess: (value) => value, onFailure: () => 0 }),
                  ),
                },
              ],
            }
          : { model: message },
    });
    source.send(-1);
    await Effect.runPromise(source.awaitIdle());
    expect(source.model()).toBe(23);
    source.dispose();
  });
});

it('keeps shared services alive while event and DOM owners cancel their own fibers', async () => {
  const { eventEffects } = await import('./event-effects');
  const { domMount, startMount } = await import('./mount');
  class Service extends Context.Service<Service, { record: () => void }>()('Lifetime/Service') {}
  let started = 0,
    finalized = 0;
  const context = Context.make(Service, {
    record: () => {
      started++;
    },
  });
  const work = Effect.gen(function* () {
    const service = yield* Service;
    service.record();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        finalized++;
      }),
    );
    return yield* Effect.never;
  }).pipe(Effect.scoped, Effect.provideContext(context));
  const errors: unknown[] = [];
  const events = eventEffects((error) => errors.push(error));
  events.accept(work);
  const host = startMount(
    {} as Element,
    domMount((_element: Element) => work),
  );
  expect(started).toBe(2);
  events.dispose();
  host.dispose();
  await expect.poll(() => finalized).toBe(2);
  await Effect.runPromise(
    Effect.map(Service, (service) => service.record()).pipe(Effect.provideContext(context)),
  );
  expect(started).toBe(3);
  expect(errors).toEqual([]);
});
