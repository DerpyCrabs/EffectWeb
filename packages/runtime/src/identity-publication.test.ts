// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collection, entities, sequence } from './collection.js';
import { list, mount, observe, view } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';
import { shareValue } from './share.js';
import { protectSnapshot, type Snapshot, type SnapshotOpaque } from './snapshot.js';
import { mapSource, type Source } from './source.js';

type Row = { id: string; label: string; nested: { value: number } };
const initialRows = (): Row[] => [
  { id: 'a', label: 'A', nested: { value: 1 } },
  { id: 'b', label: 'B', nested: { value: 2 } },
];
const byId = (row: Snapshot<Row>) => row.id;
const domain = collection<Row>(byId);
const renderRow = (row: Snapshot<Row>) => jsx('input', { 'data-id': row.id });

// Compare real DOM-local draft state, not only the keys computed by each API.
describe('identity preservation', () => {
  for (const style of ['inline', 'entities', 'collection', 'position'] as const) {
    it(`${style}: tests which row retains an uncontrolled input draft after reorder`, () => {
      const owner = modelOwner({ rows: initialRows() });
      const host = document.createElement('div');
      const stop = mount(
        host,
        view<{ rows: Row[] }>((model) => {
          switch (style) {
            case 'inline':
              return list(model.rows, byId, renderRow);
            case 'entities':
              return list(entities(model.rows), renderRow);
            case 'collection':
              return list(domain.from(model.rows), renderRow);
            case 'position':
              return list(sequence(model.rows), renderRow);
          }
        }),
        owner.source,
      );
      const original = host.querySelector('input')!;
      original.value = 'unsaved draft for a';
      owner.patch({ rows: initialRows().reverse() });
      const inputs = [...host.querySelectorAll('input')];
      expect(inputs.map((input) => input.dataset.id)).toEqual(['b', 'a']);
      expect(inputs[style === 'position' ? 0 : 1]).toBe(original);
      expect(inputs[style === 'position' ? 0 : 1]!.value).toBe('unsaved draft for a');
      stop.dispose();
      owner.dispose();
    });
  }

  it('an inline positional key is equivalent to sequence, including slice-local identity', () => {
    const rows = initialRows();
    const sliced = sequence(rows).slice(1);
    expect(sliced.items.map(sliced.identity)).toEqual([0]);
    expect(rows.slice(1).map((_row, index) => index)).toEqual([0]);
    // sequence does not retain the original positions after filtering/slicing.
  });

  it('plain structural sharing cannot substitute for keyed sharing across a reorder', () => {
    const before = initialRows();
    const next = structuredClone(before).reverse();
    const positional = shareValue(before, next);
    const keyed = domain.share(before, next);
    expect(positional).toEqual(keyed);
    expect(positional[0]).not.toBe(before[1]);
    expect(keyed[0]).toBe(before[1]);
    expect(keyed[1]).toBe(before[0]);
  });
});

function tracked<A>(source: Source<A>) {
  let active = 0;
  return {
    model: source.model,
    subscribe(listener: (value: Snapshot<A>) => void) {
      active++;
      const stop = source.subscribe(listener);
      let stopped = false;
      return () => {
        if (!stopped) {
          stopped = true;
          active--;
          stop();
        }
      };
    },
    active: () => active,
  };
}

it('mapSource eliminates copied state, suppresses equal selections, and observes only on demand', () => {
  const owner = modelOwner({ count: 1, unrelated: 0 });
  const source = tracked(owner.source);
  const derived = mapSource(source, (model) => model.count * 2);
  expect(derived.model()).toBe(2);
  expect(source.active()).toBe(0);
  const values: number[] = [];
  const stop = derived.subscribe((value) => values.push(value));
  expect(source.active()).toBe(1);
  owner.patch({ unrelated: 1 });
  owner.patch({ count: 2 });
  expect(values).toEqual([4]);
  stop();
  expect(source.active()).toBe(0);
  owner.patch({ count: 3 });
  expect(derived.model()).toBe(6);
  owner.dispose();
});

it('observe owns a dynamic subscription without disposing its source producer', () => {
  const data = modelOwner({ count: 1 });
  const source = tracked(data.source);
  const ui = modelOwner({ visible: true });
  const host = document.createElement('div');
  const stop = mount(
    host,
    view<{ visible: boolean }>((model) =>
      model.visible ? observe(source, (value) => jsx('span', { children: value.count })) : null,
    ),
    ui.source,
  );
  expect(source.active()).toBe(1);
  data.patch({ count: 2 });
  expect(host.textContent).toBe('2');
  ui.patch({ visible: false });
  expect(source.active()).toBe(0);
  expect(data.disposed).toBe(false);
  data.patch({ count: 3 });
  ui.patch({ visible: true });
  expect(host.textContent).toBe('3');
  stop.dispose();
  expect(source.active()).toBe(0);
  ui.dispose();
  data.dispose();
});

it('sharing and protection are distinct: borrowed data is not frozen by shareValue', () => {
  const previous = { nested: { value: 1 } };
  const shared = shareValue(previous, { nested: { value: 1 } });
  expect(shared).toBe(previous);
  expect(Object.isFrozen(shared)).toBe(false);
  protectSnapshot(shared);
  expect(Object.isFrozen(previous.nested)).toBe(true);
  expect(() => {
    previous.nested.value = 2;
  }).toThrow();
});

it('a Snapshot type annotation alone does not protect a mutable producer alias', () => {
  const mutable = { nested: { value: 1 } };
  const readonly: Snapshot<typeof mutable> = mutable;
  mutable.nested.value = 2;
  expect(readonly.nested.value).toBe(2);
  protectSnapshot(mutable);
  expect(() => {
    mutable.nested.value = 3;
  }).toThrow();
});

it('opaque resources stay live while plain data is protected', () => {
  class Counter {
    value = 0;
    increment() {
      this.value++;
    }
  }
  const counter = new Counter();
  const published = protectSnapshot({ counter, data: { value: 0 } });
  counter.increment();
  expect(published.counter.value).toBe(1);
  expect(Object.isFrozen(counter)).toBe(false);
  expect(Object.isFrozen(published.data)).toBe(true);
  // Runtime opacity is prototype-based; the optional type brand is not consulted.
});

// Opaque branding does not change runtime representation.
it('a branded plain service still freezes at runtime despite allowing mutable fields in its type', () => {
  interface Service extends SnapshotOpaque {
    pending: string[];
  }
  const service: Service = { pending: [] };
  const published: Snapshot<Service> = protectSnapshot(service);
  expect(() => published.pending.push('work')).toThrow();
});
