import { protectSnapshot } from './snapshot.js';
import type { Source } from './source.js';

/** Members a controller uses for its own lifecycle; everything else it returns is an action. */
export type ControllerLifecycle = 'source' | 'receive' | 'beforeDispose' | 'lifetime';
const lifecycle = new Set<string>(['source', 'receive', 'beforeDispose', 'lifetime']);
/** What a controller returns besides its lifecycle members. */
export type ControllerActions<C> = {
  readonly [K in keyof C as K extends ControllerLifecycle ? never : K]: C[K];
};
export type RenderedModel<Model, Actions> = [keyof Actions] extends [never]
  ? Model
  : Model & { readonly actions: Actions };
/**
 * The model a view renders for a controller (or controller factory), in `controllerView` or
 * `mount`: its source model plus everything else it returns, besides its lifecycle members,
 * as `actions`. Use it to type views declared apart from the controller.
 */
export type ControllerModel<C> = (
  C extends (...args: never[]) => infer R ? R : C
) extends infer Controller
  ? Controller extends { readonly source: Source<infer Model> }
    ? RenderedModel<Model, ControllerActions<Controller>>
    : never
  : never;

export const isSource = (value: unknown): value is Source<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Source<unknown>).model === 'function' &&
  typeof (value as Source<unknown>).subscribe === 'function';

/**
 * The source a view renders for a controller: its model plus its actions. The rendered model
 * keeps its identity while the controller's model does, so unchanged publications are skipped.
 */
export function controllerSource(controller: { readonly source: Source<object> }): Source<object> {
  const actions: Record<string, unknown> = {};
  let named = false;
  for (const key of Object.keys(controller))
    if (!lifecycle.has(key)) {
      actions[key] = (controller as Record<string, unknown>)[key];
      named = true;
    }
  const published = controller.source;
  if (!named) return published;
  let lastModel: object | undefined;
  let lastRendered: object | undefined;
  const rendered = (model: object): object => {
    if (model !== lastModel) {
      lastModel = model;
      lastRendered = protectSnapshot({ ...model, actions }) as object;
    }
    return lastRendered!;
  };
  return {
    model: () => rendered(published.model() as object),
    subscribe: (listener) => published.subscribe((model) => listener(rendered(model as object))),
  };
}

/** A source for input that never changes. */
export function constantSource<A>(value: A): Source<A> {
  const model = protectSnapshot(value) as A;
  return { model: () => model, subscribe: () => () => {} };
}

/** What a mount renders: a source as is, or a fixed value. */
export function mountSource(input: unknown): Source<unknown> {
  return isSource(input) ? input : constantSource(input);
}
