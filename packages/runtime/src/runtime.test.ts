import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { Scope } from './dom.js';
import { program } from './program.js';

const commandLoad = 'load';

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
        ...(value === 1
          ? { commands: [{ policy: 'replace', key: commandLoad, effect: Effect.succeed(2) }] }
          : {}),
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
});
