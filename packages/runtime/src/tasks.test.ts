import { Context, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { describe, expect, it } from 'vitest';
import { defineTasks } from './tasks.js';
import { controlledEffect, programDriver } from './testing.js';
import { uiRuntime } from './runtime.js';

class Store extends Context.Service<
  Store,
  { save: (text: string) => Effect.Effect<number, 'offline'> }
>()('TasksTest/Store') {}
const value = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  Option.getOrUndefined(AsyncResult.value(result));

describe('named owned tasks', () => {
  it('infers results and errors, supplies shared test services, and settles without public completion messages', async () => {
    const pending = controlledEffect<number, 'offline'>();
    const saved: string[] = [];
    const runtime = uiRuntime(
      Context.make(Store, {
        save: (text) => {
          saved.push(text);
          return pending.effect;
        },
      }),
    );
    const definition = defineTasks({
      init: (props: { id: string }) => ({ text: props.id }),
      runtime,
    }).tasks({
      save: {
        policy: 'drop',
        run: (model, suffix: string) =>
          Effect.flatMap(Store, (store) => store.save(model.text + suffix)),
      },
      preview: { policy: 'replace', run: (model) => Effect.succeed(model.text.toUpperCase()) },
    });
    const source = definition.create({ id: 'one' });
    const driver = programDriver(source, runtime);
    const actions = definition.controls(driver.send);
    actions.run('save', '!');
    actions.patch({ text: 'edited' });
    actions.run('save', '?');
    actions.run('preview');
    await driver.awaitSlot('task:preview');
    expect(value(driver.model().tasks.preview)).toBe('EDITED');
    expect(saved).toEqual(['one!']);
    pending.fail('offline');
    await driver.awaitSlot('task:save');
    expect(AsyncResult.isFailure(driver.model().tasks.save)).toBe(true);
    actions.run('save', '?');
    pending.succeed(42);
    await driver.awaitSlot('task:save');
    expect(value(driver.model().tasks.save)).toBe(42);
    expect(saved).toEqual(['one!', 'edited?']);
    driver.dispose();
  });

  it('replaces and resets slots independently, retaining results on cancellation', async () => {
    const slow = controlledEffect<string>();
    const definition = defineTasks({
      init: (props: { entity: string }) => ({ text: props.entity }),
    }).tasks({
      save: {
        policy: 'replace',
        identity: (model) => model.props.entity,
        run: (_model, input: string) => (input === 'slow' ? slow.effect : Effect.succeed(input)),
      },
      preview: { policy: 'drop', run: (model) => Effect.succeed(model.text.length) },
    });
    const source = definition.create({ entity: 'first' });
    const actions = definition.controls(source.send);
    actions.run('save', 'saved');
    await source.awaitIdle();
    actions.run('save', 'slow');
    expect(source.model().tasks.save.waiting).toBe(true);
    actions.cancel('save');
    await source.awaitIdle();
    expect(source.model().tasks.save.waiting).toBe(false);
    expect(value(source.model().tasks.save)).toBe('saved');
    expect(slow.canceled()).toBe(1);
    actions.run('preview');
    await source.awaitIdle();
    actions.run('save', 'slow');
    actions.run('save', 'replacement');
    await source.awaitIdle();
    expect(value(source.model().tasks.save)).toBe('replacement');
    expect(slow.canceled()).toBe(2);
    definition.receive(source, { entity: 'second' });
    expect(AsyncResult.isInitial(source.model().tasks.save)).toBe(true);
    expect(value(source.model().tasks.preview)).toBe(5);
    expect(source.model().text).toBe('first');
    actions.reset('preview');
    expect(AsyncResult.isInitial(source.model().tasks.preview)).toBe(true);
    source.dispose();
  });

  it.each(['throw', 'defect'] as const)(
    'settles %s and resets all fields only on component identity changes',
    async (kind) => {
      const definition = defineTasks({
        init: (props: { id: string }) => ({ text: props.id }),
        identity: (props) => props.id,
      }).tasks({
        save: {
          policy: 'drop',
          run: () => {
            if (kind === 'throw') throw new Error('broken');
            return Effect.die('broken');
          },
        },
      });
      const source = definition.create({ id: 'first' });
      const actions = definition.controls(source.send);
      actions.patch({ text: 'draft' });
      actions.run('save');
      await source.awaitIdle();
      expect(AsyncResult.isFailure(source.model().tasks.save)).toBe(true);
      definition.receive(source, { id: 'first' });
      expect(source.model().text).toBe('draft');
      definition.receive(source, { id: 'second' });
      expect(source.model().text).toBe('second');
      expect(AsyncResult.isInitial(source.model().tasks.save)).toBe(true);
      source.dispose();
    },
  );
});

it('binds controller tasks with lazy arguments, shared slots, parallel work and owner disposal', async () => {
  const { modelOwner } = await import('./owner.js');
  const app = modelOwner({ count: 0 });
  const pending = controlledEffect<void>();
  const calls: string[] = [];
  const actions = defineTasks(app, {
    send: {
      slot: 'generation',
      policy: 'drop',
      run: (text: string) => {
        calls.push(text);
        return pending.effect;
      },
    },
    retry: {
      slot: 'generation',
      policy: 'drop',
      run: () => {
        calls.push('retry');
        return Effect.void;
      },
    },
    update: {
      policy: 'replace',
      run: (by = 1) => Effect.sync(() => app.patch({ count: app.read().count + by })),
    },
    upload: {
      policy: 'parallel',
      run: (text: string) => {
        calls.push(text);
        return pending.effect;
      },
    },
  });
  expect(calls).toEqual([]);
  actions.send('first');
  actions.retry();
  expect(calls).toEqual(['first']);
  app.transaction(() => {
    actions.update(2);
    actions.update(3);
  });
  expect(app.read().count).toBe(3);
  actions.upload('one');
  actions.upload('two');
  expect(calls).toEqual(['first', 'one', 'two']);
  app.dispose();
  await app.awaitIdle();
  actions.send('after disposal');
  expect(calls).not.toContain('after disposal');
  expect(app.isRunning('generation')).toBe(false);
});
