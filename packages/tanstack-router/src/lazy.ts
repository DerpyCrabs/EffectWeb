import * as Effect from 'effect/Effect';
import { isModuleNotFoundError } from '@tanstack/router-core';
import type { View } from 'effectweb';
import { lazyView } from 'effectweb/advanced';

type Loaded<Module, Key extends keyof Module> =
  Module[Key] extends View<infer Props, never>
    ? View<Props, never> & { readonly preload: () => Promise<void> }
    : never;

/**
 * A route view loaded on first placement: `lazyRouteComponent(() => import('./Page'), 'Page')`.
 * Its `preload()` loads the module ahead of navigation. A module missing after a deploy reloads
 * the page once, as TanStack Router does.
 */
export function lazyRouteComponent<
  Module extends object,
  Key extends keyof Module = 'default' & keyof Module,
>(importer: () => Promise<Module>, exportName?: Key): Loaded<Module, Key> {
  let loading: Promise<void> | undefined;
  let loaded: View<unknown, never> | undefined;
  let failed = false;
  let failure: unknown;
  const load = () =>
    (loading ??= importer()
      .then((module) => {
        const name = exportName ?? 'default';
        const definition = module[name as keyof Module];
        if (typeof definition !== 'function' || !('build' in definition))
          throw new TypeError(`Route export ${String(name)} must be an EffectWeb view`);
        loaded = definition as unknown as View<unknown, never>;
      })
      .catch((error: unknown) => {
        failed = true;
        failure = error;
      }));
  const definition = lazyView<unknown, never>(() =>
    Effect.promise(load).pipe(
      Effect.flatMap(() => {
        if (!failed) return Effect.succeed(loaded!);
        // Speculative preloads must not navigate away from the current page. This
        // continuation belongs to the mounted view, so unmount also cancels recovery.
        if (
          isModuleNotFoundError(failure) &&
          failure instanceof Error &&
          typeof window !== 'undefined' &&
          typeof sessionStorage !== 'undefined'
        ) {
          const key = `tanstack_router_reload:${failure.message}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            window.location.reload();
            return Effect.never;
          }
        }
        return Effect.die(failure);
      }),
    ),
  );
  return Object.assign(definition, { preload: load }) as Loaded<Module, Key>;
}
