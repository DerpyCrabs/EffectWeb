import { Effect, Fiber } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { Scope } from './dom.js';
import { observeBindings } from './diagnostics.js';
import { fromPromise } from './load.js';
import { program } from './program.js';
import { sessionGroup } from './session.js';

describe('UI failure isolation', () => {
  it('finishes all cleanups in reverse order and only disposes once', () => {
    const errors = vi.fn();
    const scope = new Scope(0, () => {}, errors);
    const order: number[] = [];
    scope.cleanups.push(
      () => order.push(1),
      () => {
        order.push(2);
        throw new Error('cleanup');
      },
      () => order.push(3),
    );
    scope.dispose();
    scope.dispose();
    expect(order).toEqual([3, 2, 1]);
    expect(errors.mock.calls[0]![0]).toBeInstanceOf(AggregateError);
    expect(scope.cleanups).toHaveLength(0);
  });
  it('updates siblings after a binding fails and retries that binding on the next snapshot', () => {
    const errors = vi.fn();
    const scope = new Scope(0, () => {}, errors);
    const rendered: number[] = [],
      sibling: number[] = [];
    scope.watch(
      () => [scope.value],
      () => {
        if (scope.value === 1) throw new Error('bad value');
        rendered.push(scope.value);
      },
    );
    scope.watch(
      () => [scope.value],
      () => {
        sibling.push(scope.value);
      },
    );
    scope.set(1);
    scope.set(2);
    expect(rendered).toEqual([0, 2]);
    expect(sibling).toEqual([0, 1, 2]);
    expect(errors).toHaveBeenCalledTimes(1);
  });
  it('keeps command execution and other subscribers alive after a subscriber throws', async () => {
    const errors = vi.fn(),
      listener = vi.fn();
    const source = program({
      initial: 0,
      onDefect: errors,
      update: (_: number, value: number) => ({
        model: value,
        ...(value === 1 ? { commands: [{ slot: 'load', effect: Effect.succeed(2) }] } : {}),
      }),
    });
    source.subscribe(() => {
      throw new Error('subscriber');
    });
    source.subscribe(listener);
    source.send(1);
    await expect.poll(source.model).toBe(2);
    expect(listener).toHaveBeenLastCalledWith(2);
    expect(errors).toHaveBeenCalled();
    source.dispose();
  });
  it('owns every session subscription and disposal even when one adapter fails', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = vi.fn(),
      dispose = vi.fn(),
      refresh = vi.fn();
    const group = sessionGroup(
      [
        { dispose, refresh, subscribe: () => stop },
        {
          dispose() {
            throw new Error('adapter');
          },
        },
      ],
      () => {},
    );
    group.refresh();
    group.dispose();
    group.dispose();
    group.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    reported.mockRestore();
  });
});

it('adapts a Promise factory lazily and forwards interruption through AbortSignal', async () => {
  const abort = vi.fn(),
    started = vi.fn();
  const load = fromPromise((signal) => {
    started();
    signal.addEventListener('abort', abort);
    return new Promise<never>(() => {});
  });
  expect(started).not.toHaveBeenCalled();
  const fiber = Effect.runFork(load);
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(started).toHaveBeenCalledTimes(1);
  expect(abort).toHaveBeenCalledTimes(1);
});

it('reports changed dependency names without retaining model data', () => {
  const updates = vi.fn();
  const stop = observeBindings(updates);
  const scope = new Scope({ title: 'first', count: 0 }, () => {});
  scope.watch(
    () => [scope.value.title],
    () => {},
    {
      file: 'test.tsx',
      line: 2,
      column: 3,
      expression: 'model.title',
      dependencies: ['model.title'],
    },
  );
  scope.set({ title: 'first', count: 1 });
  expect(updates).toHaveBeenCalledTimes(1);
  scope.set({ title: 'second', count: 1 });
  expect(updates.mock.lastCall![0].changed).toEqual(['model.title']);
  stop();
  scope.set({ title: 'third', count: 1 });
  expect(updates).toHaveBeenCalledTimes(2);
});

it('does not revive a disposed diagnostic observer when another observer stops', () => {
  const first = vi.fn(),
    second = vi.fn();
  const stopFirst = observeBindings(first),
    stopSecond = observeBindings(second);
  const scope = new Scope(0, () => {});
  scope.watch(
    () => [scope.value],
    () => {},
    { file: 'test.tsx', line: 1, column: 1, expression: 'model', dependencies: ['model'] },
  );
  stopFirst();
  stopSecond();
  first.mockClear();
  second.mockClear();
  scope.set(1);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
});
