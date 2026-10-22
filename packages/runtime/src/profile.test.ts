// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  profileCall,
  profileFunction,
  profileInputChange,
  profileResource,
  profileSnapshot,
  profileUnchanged,
  startProfile,
  stopProfile,
} from './profile.js';
import { mapSource } from './source.js';
import { mount, view } from './dom.js';
import { jsx } from './jsx-runtime.js';
afterEach(() => {
  stopProfile();
  vi.restoreAllMocks();
});
it('produces bounded JSON reports with nested self time, causes and unchanged projections', () => {
  let time = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  startProfile({ maxEvents: 1, maxEntries: 2 });
  const fn = profileFunction(() => {}, {
    file: 'app.tsx',
    line: 3,
    column: 2,
    expression: 'view(model => ...)',
  });
  profileCall(fn, 'view', 'changed fields: title', () => {
    time += 2;
    profileCall('select', 'projection', 'input identity changed', () => {
      time += 3;
      profileUnchanged();
    });
    time += 1;
  });
  profileCall('third', 'view', 'test', () => {});
  const report = stopProfile();
  expect(report.entries.find((e) => e.kind === 'view')).toMatchObject({
    selfMs: 3,
    inclusiveMs: 6,
    location: { file: 'app.tsx' },
  });
  expect(report.entries.find((e) => e.kind === 'projection')).toMatchObject({
    selfMs: 3,
    unchanged: 1,
  });
  expect(report.droppedEntries).toBe(1);
  expect(report.droppedEvents).toBe(1);
  expect(report.events).toHaveLength(1);
  expect(report.events[0]).toMatchObject({ id: 1, complete: true });
  expect(report.events[0]!.parent).toBeUndefined();
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  report.entries[0]!.calls = 900;
  expect(profileSnapshot().entries[0]!.calls).toBe(1);
});
it('restores the span stack after failure and tracks resource balance only in its capture', () => {
  startProfile();
  const release = profileResource(() => {});
  expect(() =>
    profileCall('bad', 'view', 'test', () => {
      throw Error('expected');
    }),
  ).toThrow('expected');
  release();
  release();
  profileCall('good', 'view', 'test', () => {});
  const r = stopProfile();
  expect(r.entries.find((e) => e.name === 'bad')?.errors).toBe(1);
  expect(
    r.events.find((e) => e.entry === r.entries.find((x) => x.name === 'good')?.id)?.parent,
  ).toBeUndefined();
  expect(r.entries.find((e) => e.kind === 'binding')).toMatchObject({ acquired: 1, released: 1 });
  startProfile();
  release();
  expect(stopProfile().entries).toEqual([]);
});
it('counts selected DOM calls and restores prototypes without overwriting later instrumentation', () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;
  startProfile({ dom: true });
  profileCall('layout', 'measurement', 'read', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect();
    el.setAttribute('title', 'x');
  });
  const r = stopProfile();
  expect(r.entries[0]!.domReads).toBeGreaterThanOrEqual(1);
  expect(r.entries[0]!.domWrites).toBe(1);
  expect(Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')).toEqual(
    original,
  );
  startProfile({ dom: true });
  const replacement = () => new DOMRect();
  Element.prototype.getBoundingClientRect = replacement;
  stopProfile();
  expect(Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')?.value).toBe(
    replacement,
  );
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', original);
});
it('does not invoke getters or serialize model values to explain changes', () => {
  const getter = vi.fn(() => {
    throw Error('not a safe read');
  });
  expect(
    profileInputChange(
      {
        secret: 'before',
        get value() {
          return getter();
        },
      },
      {
        secret: 'after',
        get value() {
          return getter();
        },
      },
    ),
  ).toContain('secret');
  expect(getter).not.toHaveBeenCalled();
  expect(profileInputChange({ secret: 'before' }, { secret: 'after' })).not.toContain('after');
});
it('attributes actual view updates and equal-output source projections', () => {
  startProfile();
  let value = { count: 0 };
  const listeners = new Set<(v: typeof value) => void>();
  const source = {
    model: () => value,
    subscribe: (f: (v: typeof value) => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  const selected = mapSource(
    source,
    profileFunction((v) => v.count % 2, {
      file: 'counter.ts',
      line: 1,
      column: 1,
      expression: 'modulo',
    }),
  );
  const stop = selected.subscribe(() => {});
  const app = view(
    profileFunction((v: typeof value) => jsx('b', { children: String(v.count) }), {
      file: 'counter.tsx',
      line: 2,
      column: 1,
      expression: 'counter',
    }),
  );
  const host = document.createElement('div');
  const mounted = mount(host, app, source);
  value = { count: 2 };
  for (const listener of listeners) listener(value);
  expect(host.textContent).toBe('2');
  mounted.dispose();
  stop();
  const report = stopProfile();
  expect(report.entries.find((e) => e.kind === 'projection')).toMatchObject({
    calls: 2,
    unchanged: 1,
  });
  expect(report.entries.find((e) => e.kind === 'view')).toMatchObject({ calls: 2 });
  expect(report.events.some((e) => e.cause === 'changed fields: count')).toBe(true);
});
it('rejects invalid limits and overlapping captures', () => {
  expect(() => startProfile({ maxEvents: -1 })).toThrow(RangeError);
  startProfile();
  expect(() => startProfile()).toThrow('already active');
});
