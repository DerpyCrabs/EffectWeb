import { expect, it } from 'vitest';
import * as Atom from 'effect/reactivity/Atom';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import { atomSource } from './atom.js';
import { mapSource } from './source.js';

it('reads the atom through the registry and publishes its changes while subscribed', () => {
  const registry = AtomRegistry.make();
  const count = Atom.make(1);
  const doubled = Atom.make((get) => get(count) * 2);
  const source = atomSource(registry, doubled);
  expect(atomSource(registry, doubled)).toBe(source);
  expect(source.model()).toBe(2);
  const seen: number[] = [];
  const stop = source.subscribe((value) => seen.push(value));
  registry.set(count, 2);
  registry.set(count, 3);
  expect(seen).toEqual([4, 6]);
  expect(mapSource(source, (value) => value + 1).model()).toBe(7);
  stop();
  registry.set(count, 4);
  expect(seen).toEqual([4, 6]);
  expect(source.model()).toBe(8);
  registry.dispose();
});
