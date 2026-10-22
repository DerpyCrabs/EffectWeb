import * as Effect from 'effect/Effect';
import { describe, expect, it } from 'vitest';
import { domBinding, domMount, prepareMount } from './mount.js';
import type { DomLifetime, DomMeasurement } from './dom-measurement.js';

function browser() {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const window = {
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
  } as Window;
  return {
    element: { ownerDocument: { defaultView: window } } as Element,
    frames,
    frame() {
      const batch = [...frames.values()];
      frames.clear();
      for (const run of batch) run(0);
    },
  };
}
describe('binding-owned DOM measurement', () => {
  it('coalesces per owner Window and reads every binding before writing', () => {
    const a = browser(),
      b = browser();
    const events: string[] = [];
    const mount = (host: ReturnType<typeof browser>, name: string) => {
      const lifetime = prepareMount(
        host.element,
        domMount((_element, owner) => {
          const task = owner.measure({
            read: () => {
              events.push(`read ${name}`);
              return name;
            },
            write: (name) => {
              events.push(`write ${name}`);
            },
          });
          task.schedule();
          task.schedule();
        }),
      );
      lifetime.start();
      return lifetime;
    };
    const mounts = [mount(a, 'a'), mount(a, 'b'), mount(b, 'c')];
    expect(a.frames.size).toBe(1);
    expect(b.frames.size).toBe(1);
    a.frame();
    expect(events).toEqual(['read a', 'read b', 'write a', 'write b']);
    b.frame();
    expect(events.at(-1)).toBe('write c');
    mounts.forEach((mount) => mount.dispose());
  });
  it('invalidates data changed during a read and reads latest data next frame', () => {
    const host = browser();
    const values: number[] = [];
    let change = () => {};
    const acquire = (_element: Element, current: () => number, owner: DomLifetime) => {
      const task = owner.measure({
        read: () => {
          const value = current();
          change();
          return value;
        },
        write: (value) => {
          values.push(value);
        },
      });
      task.schedule();
    };
    const mount = prepareMount(host.element, domBinding(1, acquire));
    change = () => {
      change = () => {};
      mount.update(domBinding(2, acquire));
    };
    mount.start();
    host.frame();
    expect(values).toEqual([]);
    host.frame();
    expect(values).toEqual([2]);
    mount.dispose();
  });
  it('invalidates a sibling write when another write changes its binding data', () => {
    const host = browser();
    const values: number[] = [];
    const acquire = (_element: Element, input: () => number, owner: DomLifetime) => {
      owner
        .measure({
          read: input,
          write: (value) => {
            values.push(value);
          },
        })
        .schedule();
    };
    const second = prepareMount(host.element, domBinding(1, acquire));
    const first = prepareMount(
      host.element,
      domMount((_element, owner) => {
        owner
          .measure({
            read: () => 0,
            write: () => {
              second.update(domBinding(2, acquire));
            },
          })
          .schedule();
      }),
    );
    first.start();
    second.start();
    host.frame();
    expect(values).toEqual([]);
    host.frame();
    expect(values).toEqual([2]);
    first.dispose();
    second.dispose();
  });
  it('cancel skips pending or already-read writes and can subsequently reschedule', () => {
    const host = browser();
    const values: number[] = [];
    let task!: DomMeasurement;
    let cancel = true;
    const mount = prepareMount(
      host.element,
      domMount((_element, owner) => {
        owner
          .measure({
            read: () => {
              if (cancel) task.cancel();
              return 0;
            },
            write: () => {},
          })
          .schedule();
        task = owner.measure({
          read: () => 3,
          write: (value) => {
            values.push(value);
          },
        });
        task.schedule();
      }),
    );
    mount.start();
    host.frame();
    expect(values).toEqual([]);
    cancel = false;
    task.schedule();
    host.frame();
    expect(values).toEqual([3]);
    task.schedule();
    task.cancel();
    expect(host.frames.size).toBe(0);
    mount.dispose();
  });
  it('disposal during another write prevents stale publication and releases last frame', () => {
    const host = browser();
    const values: number[] = [];
    const second = prepareMount(
      host.element,
      domMount((_element, owner) => {
        owner
          .measure({
            read: () => 1,
            write: (value) => {
              values.push(value);
            },
          })
          .schedule();
      }),
    );
    const first = prepareMount(
      host.element,
      domMount((_element, owner) => {
        owner.measure({ read: () => 1, write: () => second.dispose() }).schedule();
      }),
    );
    first.start();
    second.start();
    host.frame();
    expect(values).toEqual([]);
    first.dispose();
    const queued = prepareMount(
      host.element,
      domMount((_element, owner) => {
        owner
          .measure({
            read: () => 1,
            write: (value) => {
              values.push(value);
            },
          })
          .schedule();
      }),
    );
    queued.start();
    queued.dispose();
    expect(host.frames.size).toBe(0);
  });
  it('read, write and cleanup failures do not leave tasks alive or starve siblings', () => {
    const host = browser();
    const errors: unknown[] = [];
    const values: number[] = [];
    const mount = prepareMount(
      host.element,
      domMount((_element, owner) => {
        owner
          .measure({
            read: () => {
              throw new Error('read');
            },
            write: () => {},
          })
          .schedule();
        owner
          .measure({
            read: () => 1,
            write: () => {
              throw new Error('write');
            },
          })
          .schedule();
        const task = owner.measure({
          read: () => 2,
          write: (value) => {
            values.push(value);
          },
        });
        task.schedule();
        return () => {
          task.schedule();
          throw new Error('cleanup');
        };
      }),
      (error) => errors.push(error),
    );
    mount.start();
    host.frame();
    expect(values).toEqual([2]);
    expect(errors).toHaveLength(2);
    expect(() => mount.dispose()).toThrow('cleanup');
    expect(host.frames.size).toBe(0);
  });
  it('setup failures and reentrant disposal cancel even resources created afterwards', () => {
    const host = browser();
    let owner!: DomLifetime;
    const mount = prepareMount(
      host.element,
      domMount((_element, lifetime) => {
        owner = lifetime;
        lifetime.measure({ read: () => 1, write: () => {} }).schedule();
        throw new Error('setup');
      }),
    );
    expect(() => mount.start()).toThrow('setup');
    expect(host.frames.size).toBe(0);
    owner.measure({ read: () => 1, write: () => {} }).schedule();
    expect(host.frames.size).toBe(0);
    const reentrant = prepareMount(
      host.element,
      domMount((_element, lifetime) => {
        reentrant.dispose();
        lifetime.measure({ read: () => 1, write: () => {} }).schedule();
      }),
    );
    reentrant.start();
    expect(host.frames.size).toBe(0);
  });
  it('rescheduling from a read or write waits until another frame', () => {
    const host = browser();
    const values: number[] = [];
    let count = 0;
    let task!: DomMeasurement;
    const mount = prepareMount(
      host.element,
      domMount((_element, owner) => {
        task = owner.measure({
          read: () => {
            if (++count === 1) task.schedule();
            return count;
          },
          write: (value) => {
            values.push(value);
            if (value === 2) task.schedule();
          },
        });
        task.schedule();
      }),
    );
    mount.start();
    host.frame();
    expect(values).toEqual([]);
    host.frame();
    expect(values).toEqual([2]);
    host.frame();
    expect(values).toEqual([2, 3]);
    mount.dispose();
  });
  it('failed Effect acquisition cancels measurements and closes its resource scope', async () => {
    const host = browser();
    const errors: unknown[] = [];
    let owner!: DomLifetime;
    const mounted = prepareMount(
      host.element,
      domMount((_element, lifetime) => {
        owner = lifetime;
        return Effect.sync(() => {
          lifetime.measure({ read: () => 1, write: () => {} }).schedule();
        }).pipe(Effect.andThen(Effect.fail('acquisition failed')));
      }),
      (error) => {
        errors.push(error);
      },
    );
    mounted.start();
    await Effect.runPromise(mounted.closed);
    expect(host.frames.size).toBe(0);
    expect(errors).toHaveLength(1);
    owner.measure({ read: () => 1, write: () => {} }).schedule();
    expect(host.frames.size).toBe(0);
  });
});
