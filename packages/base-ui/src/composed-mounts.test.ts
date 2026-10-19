// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { domBinding, mount, modelOwner } from 'effectweb';
import { createPopover, PopoverTrigger, type PopoverTriggerProps } from './popover.js';
import { composeMounts } from 'effectweb';
import * as Effect from 'effect/Effect';

async function drain() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
describe('native part binding composition', () => {
  it('retains consumer binding updates alongside trigger interaction and releases replaced bindings', async () => {
    const events: string[] = [];
    const popover = createPopover();
    const binding = (name: string, value: number) => ({
      ...domBinding(value, (element: HTMLButtonElement, current: () => number) => {
        events.push(`${name}:acquire:${current()}`);
        element.dataset.consumer = String(current());
        return {
          update: () => {
            events.push(`${name}:update:${current()}`);
            element.dataset.consumer = String(current());
          },
          dispose: () => events.push(`${name}:dispose`),
        };
      }),
      identity: name,
    });
    const owner = modelOwner<PopoverTriggerProps>({
      popover,
      use: binding('first', 1),
      children: 'Open',
    });
    const host = document.createElement('div');
    document.body.append(host);
    const errors: unknown[] = [];
    const root = mount(host, PopoverTrigger, owner.source, {
      onError: (error) => errors.push(error),
    });
    await drain();
    const button = host.querySelector('button')!;
    expect(button.dataset.consumer).toBe('1');
    button.click();
    expect(popover.source.model().open).toBe(true);
    owner.patch({ use: binding('first', 2) });
    expect(host.querySelector('button')).toBe(button);
    expect(button.dataset.consumer).toBe('2');
    owner.patch({ use: binding('second', 3) });
    expect(events).toEqual([
      'first:acquire:1',
      'first:update:1',
      'first:update:2',
      'first:dispose',
      'second:acquire:3',
    ]);
    await Effect.runPromise(root.close());
    expect(events.at(-1)).toBe('second:dispose');
    expect(errors).toEqual([]);
    owner.dispose();
    popover.lifetime.dispose();
    host.remove();
  });
  it('releases prior mounts when a later acquisition fails', async () => {
    const events: string[] = [];
    const bad = domBinding(undefined, () => {
      throw new Error('acquisition failed');
    });
    const first = domBinding(undefined, () => {
      events.push('acquire');
      return () => events.push('release');
    });
    const host = document.createElement('div');
    const errors: unknown[] = [];
    const popover = createPopover();
    const root = mount(
      host,
      PopoverTrigger,
      { popover, use: composeMounts([first, bad]) },
      { onError: (error) => errors.push(error) },
    );
    await drain();
    expect(events).toEqual(['acquire', 'release']);
    expect(errors).toHaveLength(1);
    await Effect.runPromise(root.close());
    expect(events).toEqual(['acquire', 'release']);
    popover.lifetime.dispose();
  });
  it('keeps scoped work alive through updates and joins it on close', async () => {
    const popover = createPopover(),
      host = document.createElement('div');
    let acquired = false,
      released = false;
    const scoped = domBinding(undefined, () =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            acquired = true;
          }),
          () =>
            Effect.sync(() => {
              released = true;
            }),
        );
        return yield* Effect.never;
      }),
    );
    const root = mount(host, PopoverTrigger, { popover, use: scoped });
    await drain();
    expect(acquired).toBe(true);
    expect(released).toBe(false);
    await Effect.runPromise(root.close());
    expect(released).toBe(true);
    popover.lifetime.dispose();
  });
  it('reconciles a binding replacement requested during acquisition exactly once', async () => {
    const events: string[] = [],
      popover = createPopover(),
      host = document.createElement('div');
    const second = domBinding(undefined, () => {
      events.push('second:acquire');
      return () => events.push('second:release');
    });
    const owner = modelOwner<PopoverTriggerProps>({ popover });
    const first = domBinding(undefined, () => {
      events.push('first:acquire');
      owner.patch({ use: second });
      return () => events.push('first:release');
    });
    owner.patch({ use: first });
    const root = mount(host, PopoverTrigger, owner.source);
    await drain();
    expect(events).toEqual(['first:acquire', 'first:release', 'second:acquire']);
    await Effect.runPromise(root.close());
    expect(events.at(-1)).toBe('second:release');
    owner.dispose();
    popover.lifetime.dispose();
  });
});
