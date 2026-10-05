// oxlint-disable-next-line no-restricted-imports -- Renderer fixture deliberately exercises compiler implementation primitives.
export {
  Scope,
  compiled,
  attach,
  view,
  markup,
  still,
  block,
  text,
  mount,
  attribute,
} from 'effectweb/dom';
// oxlint-disable-next-line no-restricted-imports -- Row builders below drive the renderer's keyed rows directly.
import { keyedRows, Scope, type ContentRange } from 'effectweb/dom';
import type { JSX, Rows } from 'effectweb';

type Build<M, E> = (scope: Scope<M, E>, parent: Node, before: Node | null) => ContentRange | void;
/** Create an element before `before`, as a hand-written builder does. */
export function element(parent: Node, before: Node | null, tag: string): HTMLElement {
  const node = (parent.ownerDocument ?? document).createElement(tag);
  parent.insertBefore(node, before);
  return node;
}
/** A listener owned by `scope`; it stops reaching the handler once the scope is disposed. */
export function event<M, E>(
  scope: Scope<M, E>,
  target: Element,
  name: string,
  handler: (event: Event) => unknown,
) {
  const type = name.slice(2).toLowerCase();
  const listener = (event: Event) => {
    if (!scope.disposed) handler(event);
  };
  target.addEventListener(type, listener);
  scope.cleanups.push(() => target.removeEventListener(type, listener));
}
/** Keyed rows whose content is built by a row builder with its own scope. */
export function each<M, E, A>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  read: () => Rows<A> | readonly A[],
  outer: () => readonly unknown[],
  indexUsed: boolean,
  build: Build<readonly [A, number], E>,
): ContentRange {
  return keyedRows(scope, parent, before, read, outer, indexUsed, (item, index, fragment) => {
    const child = new Scope<readonly [A, number], E>(
      [item, index],
      scope.send,
      scope.report,
      scope.settlement,
    );
    let range: ContentRange | void;
    try {
      range = build(child, fragment, null);
    } catch (error) {
      child.dispose();
      throw error;
    }
    return {
      item,
      index,
      range: range ?? undefined,
      update(nextItem, nextIndex) {
        this.item = nextItem;
        this.index = nextIndex;
        child.set([nextItem, nextIndex]);
      },
      dispose: () => child.dispose(),
    };
  });
}
export { program, type Command, type Program, type Send, type Transition } from 'effectweb';

export { domBinding, entities, list, sequence } from 'effectweb';
/** Call a view as compiled JSX does. */
export function renderComponent(
  component: (props: never) => JSX.Element,
  props: object,
): JSX.Element {
  return component(props as never);
}
