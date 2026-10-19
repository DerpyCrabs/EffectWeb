import type * as Atom from 'effect/reactivity/Atom';
import type * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import type { Source } from './source.js';

const sources = new WeakMap<
  AtomRegistry.AtomRegistry,
  WeakMap<Atom.Atom<unknown>, Source<unknown>>
>();

/**
 * Observe an Effect `Atom` through a registry. The source reads the atom's current value and
 * keeps the atom mounted while a view or controller is subscribed, so the same atom can feed
 * EffectWeb views and other Effect code. One source is shared per registry and atom.
 */
export function atomSource<A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A>): Source<A> {
  let byAtom = sources.get(registry);
  if (!byAtom) {
    byAtom = new WeakMap();
    sources.set(registry, byAtom);
  }
  let source = byAtom.get(atom) as Source<A> | undefined;
  if (!source) {
    source = {
      model: () => registry.get(atom),
      subscribe: (listener) => registry.subscribe(atom, listener),
    };
    byAtom.set(atom, source);
  }
  return source;
}
