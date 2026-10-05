// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { list, mount, observe, view } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';
import { liveSource } from './source.js';

function viewersFamily() {
  const watching = new Map<string, (names: string[]) => void>();
  const viewers = liveSource({
    initial: (_id: string): readonly string[] => [],
    subscribe: (id, publish) => {
      watching.set(id, publish);
      return () => watching.delete(id);
    },
  });
  return { viewers, watching };
}

it('subscribes per key while observed and stops when the observing view goes away', () => {
  const { viewers, watching } = viewersFamily();
  const owner = modelOwner({ open: ['a', 'b'] as readonly string[] });
  const host = document.createElement('div');
  const mounted = mount(
    host,
    view<{ readonly open: readonly string[] }>((model) =>
      jsx('ul', {
        children: list(model.open, (id) =>
          jsx('li', {
            children: observe(viewers(id), (names) => `${id}: ${names.join(', ') || 'nobody'}`),
          }),
        ),
      }),
    ),
    owner.source,
  );
  expect([...watching.keys()]).toEqual(['a', 'b']);
  watching.get('a')!(['Ann']);
  expect(host.textContent).toBe('a: Annb: nobody');
  owner.patch({ open: ['b'] });
  expect([...watching.keys()]).toEqual(['b']);
  mounted.dispose();
  expect(watching.size).toBe(0);
});

it('shares one subscription between observers of the same key and restarts from initial', () => {
  const { viewers, watching } = viewersFamily();
  expect(viewers('a')).toBe(viewers('a'));
  const first = viewers('a').subscribe(() => {});
  const second = viewers('a').subscribe(() => {});
  expect(watching.size).toBe(1);
  watching.get('a')!(['Ann']);
  expect(viewers('a').model()).toEqual(['Ann']);
  first();
  expect(watching.size).toBe(1);
  second();
  expect(watching.size).toBe(0);
  expect(viewers('a').model()).toEqual([]);
});

it('stops a subscription that publishes synchronously when its only observer leaves at once', () => {
  let stops = 0;
  const live = liveSource({
    initial: (_key: number) => 0,
    subscribe: (key, publish) => {
      publish(key * 2);
      return () => stops++;
    },
  });
  const seen: number[] = [];
  const stop = live(3).subscribe((value) => seen.push(value));
  expect(live(3).model()).toBe(6);
  expect(seen).toEqual([6]);
  stop();
  stop();
  expect(stops).toBe(1);
});
