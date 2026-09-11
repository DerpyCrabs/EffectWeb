import { Context, Effect, Stream, SubscriptionRef } from 'effect';
import * as Atom from 'effect/unstable/reactivity/Atom';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';
import { expect, it } from 'vitest';
import {
  fromAtom,
  fromStream,
  fromSubscriptionRef,
  mapSource,
  projectionSource,
} from './source.js';
import { program } from './program.js';

it('maps only explicitly selected data and does not own the producer', () => {
  const source = program({
    initial: { name: 'one', count: 0 },
    update: (model, patch: Partial<{ name: string; count: number }>) => ({
      model: { ...model, ...patch },
    }),
  });
  const selected = mapSource(source, (model) => model.name);
  const values: string[] = [];
  const stop = selected.subscribe((value) => values.push(value));
  source.send({ count: 1 });
  source.send({ name: 'two' });
  expect(selected.model()).toBe('two');
  stop();
  source.send({ name: 'three' });
  expect(selected.model()).toBe('three');
  expect(values).toEqual(['two']);
  source.dispose();
});

it('observes an existing SubscriptionRef and closes only its subscription', async () => {
  const ref = Effect.runSync(SubscriptionRef.make({ count: 0 }));
  const values: number[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fromSubscriptionRef(ref);
        source.subscribe((value) => values.push(value.count));
        yield* SubscriptionRef.set(ref, { count: 1 });
        yield* Effect.yieldNow;
        expect(source.model()).toEqual({ count: 1 });
        expect(Object.isFrozen(source.model())).toBe(true);
      }),
    ),
  );
  await Effect.runPromise(SubscriptionRef.set(ref, { count: 2 }));
  expect(values).toEqual([1]);
});

it('runs snapshot streams with captured services and releases stream resources', async () => {
  const label = Context.Reference('source-test/label', { defaultValue: () => 'default' });
  let released = false;
  const values: string[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fromStream(
          Stream.fromEffect(
            Effect.gen(function* () {
              yield* Effect.acquireRelease(Effect.void, () =>
                Effect.sync(() => {
                  released = true;
                }),
              );
              return yield* label;
            }),
          ).pipe(Stream.concat(Stream.never)),
          'initial',
        );
        values.push(source.model());
      }),
    ).pipe(Effect.provideService(label, 'application')),
  );
  expect(values).toEqual(['application']);
  expect(released).toBe(true);
});

it('uses an existing atom registry and leaves it usable after the observation closes', async () => {
  const registry = AtomRegistry.make();
  const count = Atom.make(0);
  const values: number[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fromAtom(count, registry);
        source.subscribe((value) => values.push(value));
        registry.set(count, 1);
        expect(source.model()).toBe(1);
      }),
    ),
  );
  registry.set(count, 2);
  expect(registry.get(count)).toBe(2);
  expect(values).toEqual([1]);
  registry.dispose();
});

it('does not erase an observation that was read before its subscriber is notified', () => {
  const owner = program({ initial: 0, update: (_model, model: number) => ({ model }) });
  const selected = mapSource(owner, (value) => value + 1);
  const values: number[] = [];
  owner.subscribe(() => selected.model());
  const stop = selected.subscribe((value) => values.push(value));
  owner.send(1);
  expect(values).toEqual([2]);
  stop();
  owner.dispose();
});

it('batches projections and repeats invalidation during refresh without publishing stale data', async () => {
  let value = 0;
  const values: number[] = [];
  let invalidateDuringRefresh = false;
  const source = projectionSource({
    project: () => value,
    refresh() {
      if (invalidateDuringRefresh) {
        invalidateDuringRefresh = false;
        value++;
        source.changed();
      }
    },
  });
  source.start();
  source.subscribe((value) => values.push(value));
  value++;
  source.changed();
  source.changed();
  invalidateDuringRefresh = true;
  await Promise.resolve();
  await Promise.resolve();
  expect(values).toEqual([2]);
  source.dispose();
});
