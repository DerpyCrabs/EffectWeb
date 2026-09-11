import attributeData from './dom-attributes.json' with { type: 'json' };
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { protectSnapshot, type Snapshot } from './snapshot.js';

import { validateIdentities } from './collection.js';
import { runAll, reportError, reportSafely, type ReportError } from './errors.js';
import { eventEffects } from './effectEvent.js';
import { traceBinding, type BindingSource } from './diagnostics.js';
import type { Rows } from './index.js';
import type { Identity } from './collection.js';
import { jsxComponent, type JSX } from './jsx.js';
import type { DomMount } from './mount.js';
import { Settlement } from './settlement.js';
import { prepareMount } from './mount.js';
import type { Send } from './program.js';
import type { Source } from './source.js';
import type { UiRuntime } from './runtime.js';
type Dependencies = () => readonly unknown[];
type BindingLocation = BindingSource | (() => BindingSource | undefined);
const bindingLocation = (source: BindingLocation | undefined) =>
  typeof source === 'function' ? source() : source;
type Cleanup = () => void;
type Build<M, E> = (scope: Scope<M, E>, parent: Node, before: Node | null) => void;
const equal = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

// A model publication reconciles DOM first and controlled dependent properties second.
// Nested child scopes join the same synchronous commit; there is no reactive graph.
let commitDepth = 0;
const controlCommits = new Set<() => void>();
function commitDom<A>(work: () => A): A {
  commitDepth++;
  try {
    return work();
  } finally {
    if (--commitDepth === 0) {
      for (const apply of controlCommits) {
        controlCommits.delete(apply);
        apply();
      }
    }
  }
}
function afterDom(apply: () => void) {
  if (commitDepth) controlCommits.add(apply);
  else apply();
}

/** Compiler implementation. No implicit tracking, proxies, or per-binding subscriptions. */
export class Scope<M, E> {
  readonly jobs: Cleanup[] = [];
  readonly cleanups: Cleanup[] = [];
  disposed = false;
  constructor(
    public value: M,
    readonly send: Send<E>,
    readonly report: ReportError = reportError,
    readonly settlement: Settlement = new Settlement(),
  ) {}
  watch(dependencies: Dependencies, apply: () => void, source?: BindingLocation) {
    let previous = dependencies();
    apply();
    traceBinding(bindingLocation(source), undefined, previous, 'binding');
    if (!previous.length) return;
    const run = () => {
      const next = dependencies();
      if (!equal(previous, next)) {
        apply();
        traceBinding(bindingLocation(source), previous, next, 'binding');
        previous = next;
      }
    };
    this.jobs.push(run);
  }
  set(value: M) {
    if (this.disposed) return;
    commitDom(() => {
      this.value = value;
      for (const job of this.jobs) {
        if (this.disposed) break;
        try {
          job();
        } catch (error) {
          reportSafely(this.report, error);
        }
      }
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.jobs.length = 0;
    runAll(this.cleanups.splice(0).reverse(), this.report);
  }
}
export interface View<M, E> extends JSX.ComponentType {
  (this: never, props: [E] extends [never] ? M | Snapshot<M> : never): JSX.Element;
  readonly build: Build<M, E>;
}

/** Mount a view with an explicit model and message dispatcher. */
export const ViewBinding = /* @__PURE__ */ Object.assign(
  function ViewBinding<M, E>(
    this: never,
    props: { view: View<M, E>; model: NoInfer<M> | Snapshot<NoInfer<M>>; send: Send<NoInfer<E>> },
  ): JSX.Element {
    return new SlotPlacement(viewContent(props.view), { model: props.model, send: props.send });
  },
  { [jsxComponent]: true as const },
);

/** Untyped callers get an actionable failure instead of silently losing child messages. */
export function unboundSend(_message: unknown): never {
  throw new Error(
    'This view needs a dispatcher. Mount it through ViewBinding with model and send.',
  );
}

const contentBrand: unique symbol = Symbol('compiled content');
/** Owned markup accepted wherever JSX can render content. */
export interface CompiledContent {
  readonly [contentBrand]: true;
}
/** An ordinary render callback with a typed input. Invoke it to produce content. */
export interface Slot<A = void> {
  (value: A | Snapshot<A>): JSX.Element;
}
/* @__NO_SIDE_EFFECTS__ */
export function slot<A = void>(render: (value: Snapshot<A>) => JSX.Element): Slot<A> {
  return render as Slot<A>;
}
type ContentDefinition = {
  mount(
    parent: Node,
    before: Node,
    value: unknown,
    report: ReportError,
    settlement: Settlement,
  ): { set(value: unknown): void; dispose(): void };
};
type ContentValue = CompiledContent & { definition: ContentDefinition; value?: unknown };
// Placement values are opaque to structural sharing, which only traverses plain data.
class SlotPlacement implements CompiledContent {
  readonly [contentBrand] = true;
  constructor(
    readonly definition: ContentDefinition,
    readonly value: unknown,
  ) {}
}
function isContent(value: unknown): value is ContentValue {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    contentBrand in value
  );
}
/** Evaluate ordinary synchronous JavaScript for each immutable model publication. */
/* @__NO_SIDE_EFFECTS__ */
export function view<M, E = never>(
  render: (model: Snapshot<M>, send: Send<E>) => JSX.Element,
): View<M, E> {
  return compiled((scope, parent, before) => {
    const read = () => render(scope.value as Snapshot<M>, scope.send);
    text(scope, parent, before, () => [scope.value], read);
  });
}
/* @__NO_SIDE_EFFECTS__ */
export function compiled<M, E>(build: Build<M, E>): View<M, E> {
  const definition: View<M, E> = Object.assign(
    (props: M | Snapshot<M>) =>
      new SlotPlacement(viewContent(definition), { model: props, send: unboundSend }),
    { build, [jsxComponent]: true as const },
  );
  return definition;
}

/** Skip a view only under the caller's explicit equality contract. */
export function memoView<M, E>(
  definition: View<M, E>,
  equals: (previous: Snapshot<M>, next: Snapshot<M>) => boolean,
): View<M, E> {
  return compiled((scope, parent, before) => {
    const child = new Scope(scope.value, scope.send, scope.report, scope.settlement);
    scope.cleanups.push(() => child.dispose());
    definition.build(child, parent, before);
    scope.jobs.push(() => {
      if (!equals(child.value as Snapshot<M>, scope.value as Snapshot<M>)) child.set(scope.value);
    });
  });
}

const viewDefinitions = new WeakMap<object, ContentDefinition>();
function viewContent<M, E>(definition: View<M, E>): ContentDefinition {
  let content = viewDefinitions.get(definition);
  if (!content) {
    content = contentDefinition<{ model: M; send: Send<E> }>((scope, parent, before) => {
      const childScope = new Scope(
        scope.value.model,
        (message: E) => scope.value.send(message),
        scope.report,
        scope.settlement,
      );
      scope.cleanups.push(() => childScope.dispose());
      definition.build(childScope, parent, before);
      scope.jobs.push(() => childScope.set(scope.value.model));
    });
    viewDefinitions.set(definition, content);
  }
  return content;
}

function contentDefinition<A>(build: Build<A, never>): ContentDefinition {
  return {
    mount(parent, before, value, report, settlement) {
      const scope = new Scope(value as A, unboundSend, report, settlement);
      const fragment = buildFragment(parent);
      const range = markers(fragment, null);
      scope.cleanups.push(() => remove(range.start, range.end));
      try {
        build(scope, fragment, range.end);
        if (!scope.disposed) parent.insertBefore(fragment, before);
      } catch (error) {
        scope.dispose();
        throw error;
      }
      return { set: (value) => scope.set(value as A), dispose: () => scope.dispose() };
    },
  };
}

type MarkupProps = Readonly<Record<string, unknown>> & { readonly children?: JSX.Element };
type MarkupValue = {
  readonly props: MarkupProps;
  readonly sources?: Readonly<Record<string, BindingSource>> | undefined;
};
const markupDefinitions = new Map<string, ContentDefinition>();
/** JSX factories preserve host identity by element type; source locations are metadata only. */
export function markup(
  tag: string,
  sources?: Readonly<Record<string, BindingSource>>,
): (props: MarkupProps) => JSX.Element {
  let definition = markupDefinitions.get(tag);
  if (!definition) {
    definition = contentDefinition<MarkupValue>((scope, parent, before) => {
      const node = element(parent, before, tag);
      bindAttributes(
        scope,
        node,
        () => [scope.value.props],
        () => {
          const { children: _children, ...attributes } = scope.value.props;
          return attributes;
        },
        () => scope.value.sources,
      );
      text(
        scope,
        node,
        null,
        () => [scope.value.props.children],
        () => scope.value.props.children,
        () => scope.value.sources?.children,
      );
    });
    markupDefinitions.set(tag, definition);
  }
  return (props) => new SlotPlacement(definition, { props, sources });
}

export function renderComponent(
  component: (props: never) => JSX.Element,
  props: Readonly<Record<string, unknown>>,
): JSX.Element {
  return component(props as never);
}

type ListValue<A> = {
  readonly rows: Rows<A> | readonly A[];
  readonly render: (item: A, index: number) => JSX.Element;
};
const listDefinition = contentDefinition<ListValue<unknown>>((scope, parent, before) => {
  each(
    scope,
    parent,
    before,
    () => scope.value.rows,
    () => [scope.value.render],
    true,
    (row, parent, before) => {
      // The explicit list operation owns callback evaluation and keyed row lifetimes.
      const update = () => scope.value.render(row.value[0], row.value[1]);
      text(row, parent, before, () => [row.value, scope.value.render], update);
    },
  );
});
/** Preserve collection identity (or array reference identity) while rendering rows. */
export function list<A>(
  rows: Rows<A> | readonly A[],
  render: (item: A, index: number) => JSX.Element,
): JSX.Element {
  return new SlotPlacement(listDefinition, { rows, render });
}

/**
 * Define keyed row projection once. Every dependency is passed as an explicit input;
 * only changed projected props enter the row view's renderer.
 */
export function listView<A, Input, Props, Message = never>(options: {
  readonly project: (item: A, index: number, input: Input) => Props | Snapshot<Props>;
  readonly view: View<Props, Message>;
  readonly equals?: (previous: Snapshot<Props>, next: Snapshot<Props>) => boolean;
}) {
  type Value = { rows: Rows<A> | readonly A[]; input: Input; send: Send<Message> };
  const equals = options.equals ?? Object.is;
  const definition = contentDefinition<Value>((scope, parent, before) => {
    each(
      scope,
      parent,
      before,
      () => scope.value.rows,
      () => [scope.value.input, scope.value.send],
      true,
      (row, parent, before) => {
        const model = () =>
          protectSnapshot(options.project(row.value[0], row.value[1], scope.value.input)) as Props;
        const child = new Scope(
          model(),
          (message: Message) => scope.value.send(message),
          scope.report,
          scope.settlement,
        );
        row.cleanups.push(() => child.dispose());
        options.view.build(child, parent, before);
        row.jobs.push(() => {
          const next = model();
          if (!equals(child.value as Snapshot<Props>, next as Snapshot<Props>)) child.set(next);
        });
      },
    );
  });
  return (
    rows: Rows<A> | readonly A[],
    input: Input,
    ...dispatch: [Message] extends [never] ? [send?: Send<Message>] : [send: Send<Message>]
  ): JSX.Element =>
    new SlotPlacement(definition, { rows, input, send: dispatch[0] ?? unboundSend });
}

type Observation = { source: Source<unknown>; render: (value: unknown) => JSX.Element };
const observationDefinition = contentDefinition<Observation>((scope, parent, before) => {
  let unsubscribe = () => {};
  let source = scope.value.source;
  const child = new Scope(source.model(), unboundSend, scope.report, scope.settlement);
  scope.cleanups.push(
    () => child.dispose(),
    () => unsubscribe(),
  );
  text(
    child,
    parent,
    before,
    () => [child.value, scope.value.render],
    () => scope.value.render(child.value),
  );
  const connect = () => {
    if (scope.disposed) return;
    const current = source;
    const release = current.subscribe((value) => {
      if (!scope.disposed && source === current) child.set(value);
    });
    if (scope.disposed || source !== current) release();
    else {
      unsubscribe = release;
      child.set(current.model());
    }
  };
  connect();
  scope.jobs.push(() => {
    if (source !== scope.value.source) {
      unsubscribe();
      source = scope.value.source;
      connect();
    } else child.set(source.model());
  });
});

/** Render a declared source in its own subscribed region. No dependencies are inferred. */
export function observe<A>(
  source: Source<A>,
  render: (value: Snapshot<A>) => JSX.Element,
): JSX.Element {
  return new SlotPlacement(observationDefinition, { source, render });
}
export interface PortalProps {
  readonly children?: JSX.Element;
  readonly mount?: Element | undefined;
}
/** Owned content in an element target, defaulting to the document body. */
export const Portal: View<PortalProps, never> = /* @__PURE__ */ compiled((scope) => {
  portal(
    scope,
    (child, parent, before) => {
      text(
        child,
        parent,
        before,
        () => [child.value.children],
        () => child.value.children,
      );
    },
    () => scope.value.mount,
  );
});

function markers(parent: Node, before: Node | null) {
  const start = document.createComment('');
  const end = document.createComment('');
  parent.insertBefore(start, before);
  parent.insertBefore(end, before);
  return { start, end };
}
function remove(start: Node, end: Node) {
  let node: Node | null = start;
  while (node) {
    const next: Node | null = node.nextSibling;
    node.parentNode?.removeChild(node);
    if (node === end) break;
    node = next;
  }
}
function clear(start: Node, end: Node) {
  while (start.nextSibling && start.nextSibling !== end)
    start.parentNode!.removeChild(start.nextSibling);
}

/** Keep the longest ordered run mounted in place; only insert/move the other rows. */
function stationaryIndices(order: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = Array.from({ length: order.length }, () => -1);
  for (let index = 0; index < order.length; index++) {
    if (order[index]! < 0) continue;
    let low = 0,
      high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (order[tails[middle]!]! < order[index]!) low = middle + 1;
      else high = middle;
    }
    previous[index] = low ? tails[low - 1]! : -1;
    tails[low] = index;
  }
  const result = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) result.add(index);
  return result;
}
const svgNamespace = 'http://www.w3.org/2000/svg';
// Detached regions must retain the insertion context, including foreignObject's
// switch back to HTML. Weak keys do not retain completed build fragments.
const fragmentSvg = new WeakMap<Node, boolean>();
function svgChildren(parent: Node): boolean {
  return (
    fragmentSvg.get(parent) ??
    (parent instanceof Element &&
      parent.namespaceURI === svgNamespace &&
      parent.localName !== 'foreignObject')
  );
}
function buildFragment(parent: Node): DocumentFragment {
  const fragment = (parent.ownerDocument ?? document).createDocumentFragment();
  fragmentSvg.set(fragment, svgChildren(parent));
  return fragment;
}

export interface MountOptions {
  readonly onError?: ReportError;
  readonly runtime?: UiRuntime<never>;
}
export interface Mounted {
  (): void;
  readonly dispose: () => void;
  readonly close: () => Effect.Effect<void>;
}
export function mountView<M, E>(
  parent: Node,
  definition: View<M, E>,
  source: Source<M> & { readonly send: Send<E> },
  options?: MountOptions,
): Mounted;
export function mountView<M>(
  parent: Node,
  definition: View<M, never>,
  source: Source<M>,
  options?: MountOptions,
): Mounted;
export function mountView<M, E>(
  parent: Node,
  definition: View<M, E>,
  source: Source<M>,
  options: MountOptions & { readonly send: Send<E> },
): Mounted;
export function mountView<M, E>(
  parent: Node,
  definition: View<M, E>,
  source: Source<M> & { readonly send?: Send<E> },
  options: MountOptions & { readonly send?: Send<E> } = {},
): Mounted {
  return mountViewWithSettlement(
    parent,
    definition,
    source,
    { ...options, send: options.send ?? source.send ?? (unboundSend as Send<E>) },
    new Settlement(options.runtime),
  );
}

/** Internal mounting boundary. Its owner retains completion accounting if construction fails. */
export function mountViewWithSettlement<M, E>(
  parent: Node,
  definition: View<M, E>,
  source: Source<M>,
  options: { readonly send: Send<E>; readonly onError?: ReportError },
  settlement: Settlement,
): Mounted {
  return commitDom(() => {
    const initial = source.model();
    const { start, end } = markers(parent, null);
    const scope = new Scope(initial, options.send, options.onError, settlement);
    let unsubscribe = () => {};
    let ready = false;
    let latest = scope.value;
    try {
      unsubscribe = source.subscribe((model) => {
        latest = model;
        if (ready) scope.set(model);
      });
      const fragment = buildFragment(parent);
      definition.build(scope as unknown as Scope<M, E>, fragment, null);
      parent.insertBefore(fragment, end);
      ready = true;
      if (!Object.is(latest, scope.value)) scope.set(latest);
    } catch (error) {
      settlement.exit = Exit.die(error);
      runAll([unsubscribe, () => scope.dispose(), () => remove(start, end)], scope.report);
      throw error;
    }
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      const finish = settlement.begin();
      try {
        runAll([unsubscribe, () => scope.dispose(), () => remove(start, end)], scope.report);
      } finally {
        finish();
      }
    };
    return Object.assign(dispose, {
      dispose,
      close: () => {
        return Effect.suspend(() => {
          dispose();
          return scope.settlement.wait();
        });
      },
    });
  });
}
export function element(parent: Node, before: Node | null, tag: string): Element {
  const doc = parent.ownerDocument ?? document;
  const node =
    tag === 'svg' || svgChildren(parent)
      ? doc.createElementNS(svgNamespace, tag)
      : doc.createElement(tag);
  parent.insertBefore(node, before);
  return node;
}
const classTokens = new WeakMap<Element, Set<string>>();
let booleanAttributes: Set<string> | undefined;
const styleProperties = new WeakMap<Element, Set<string>>();
function scalar(value: unknown): string {
  if (value == null) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  throw new Error(
    'DOM values must be scalar. Render objects as compiled child views or domain collections.',
  );
}
export function attribute(element: Element, name: string, value: unknown) {
  const aliases: Readonly<Record<string, string>> = attributeData.aliases;
  const key = aliases[name] ?? name;
  const booleanValues: Readonly<Record<string, Readonly<Record<string, string>>>> =
    attributeData.booleanValues;
  if (typeof value === 'boolean') value = booleanValues[key]?.[String(value)] ?? value;
  if (name === 'classList') {
    const tokens = (value ?? {}) as Record<string, boolean>;
    const next = new Set<string>();
    for (const [classes, enabled] of Object.entries(tokens))
      for (const token of classes.split(/\s+/u).filter(Boolean)) if (enabled) next.add(token);
    for (const token of classTokens.get(element) ?? [])
      if (!next.has(token)) element.classList.remove(token);
    for (const token of next) element.classList.add(token);
    classTokens.set(element, next);
  } else if (name === 'style' && value != null && typeof value === 'object' && 'style' in element) {
    const style = element.style as CSSStyleDeclaration;
    const entries = Object.entries(value).map(
      ([property, value]) =>
        [
          property.startsWith('--')
            ? property
            : property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`),
          scalar(value),
        ] as const,
    );
    const next = new Set(entries.map(([property]) => property));
    for (const property of styleProperties.get(element) ?? [])
      if (!next.has(property)) style.removeProperty(property);
    for (const [property, value] of entries) style.setProperty(property, value);
    styleProperties.set(element, next);
  } else if (name === 'value' && 'value' in element) {
    const next = scalar(value);
    if (element.value !== next) element.value = next;
  } else if (
    (typeof value === 'boolean' || value == null) &&
    (booleanAttributes ??= new Set(attributeData.boolean)).has(key)
  ) {
    element.toggleAttribute(key, Boolean(value));
    const properties: Readonly<Record<string, string>> = attributeData.properties;
    const property = properties[key] ?? key;
    if (typeof Reflect.get(element, property) === 'boolean')
      Reflect.set(element, property, Boolean(value));
  } else if (
    value == null ||
    (value === false &&
      !attributeData.booleanish.includes(key) &&
      !name.startsWith('aria-') &&
      !name.startsWith('data-'))
  ) {
    element.removeAttribute(key);
  } else {
    const next = scalar(value);
    if (element.getAttribute(key) !== next) element.setAttribute(key, next);
  }
  if (key === 'class')
    for (const token of classTokens.get(element) ?? []) element.classList.add(token);
  if (name === 'style' && (value == null || typeof value !== 'object')) {
    if (value == null) styleProperties.delete(element);
    else if ('style' in element)
      styleProperties.set(element, new Set(Array.from(element.style as CSSStyleDeclaration)));
  }
}

/** Compiler output for attributes whose unchanged value needs no DOM refresh. */
export function bindAttribute<M, E>(
  scope: Scope<M, E>,
  element: Element,
  name: string,
  dependencies: Dependencies,
  read: () => unknown,
  source?: BindingLocation,
) {
  let previous = dependencies();
  let value = read();
  attribute(element, name, value);
  traceBinding(bindingLocation(source), undefined, previous, 'binding');
  if (!previous.length) return;
  // Keep the value cache in the dependency job itself, without an extra closure
  // for every row. Controlled input properties keep using ordinary watches.
  scope.jobs.push(() => {
    const next = dependencies();
    if (equal(previous, next)) return;
    const nextValue = read();
    if (!Object.is(value, nextValue)) {
      attribute(element, name, nextValue);
      value = nextValue;
    }
    traceBinding(bindingLocation(source), previous, next, 'binding');
    previous = next;
  });
}

const controlRestorations = new WeakMap<EventTarget, Set<(type: string) => void>>();

/** Handled edits can change a control even when dispatch publishes no new model. */
export function bindControl<M, E>(
  scope: Scope<M, E>,
  element: Element,
  name: string,
  dependencies: Dependencies,
  read: () => unknown,
  source?: BindingLocation,
) {
  let composing = false;
  let deferred = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const select = element.tagName === 'SELECT' && name === 'value';
  const write = () => {
    if (scope.disposed) return;
    try {
      if (composing) deferred = true;
      else attribute(element, name, read());
    } catch (error) {
      reportSafely(scope.report, error);
    }
  };
  const apply = () => {
    if (select) afterDom(write);
    else write();
  };
  let initialized = false;
  let published: unknown;
  scope.watch(
    dependencies,
    () => {
      const next = read();
      // A coarse dependency can change while this field's published value stays equal.
      // Preserve unfinished blur drafts; handled edits still restore through apply below.
      if (!initialized || !Object.is(published, next)) {
        initialized = true;
        published = next;
        apply();
      }
    },
    source,
  );
  if (select) {
    // The selected value may stay equal while its options change on this publication.
    scope.jobs.push(apply);
    // Options may also belong to a separately updating component or a DOM host.
    // Observe only option-affecting mutations; setting selectedness does not mutate attributes.
    const observer = new MutationObserver(apply);
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['value', 'selected', 'disabled'],
    });
    scope.cleanups.push(() => {
      observer.disconnect();
      controlCommits.delete(write);
    });
  }
  const restore = () => {
    if (composing) {
      deferred = true;
      return;
    }
    if (pending !== undefined || scope.disposed) return;
    // Native dispatch may run microtasks between listeners. A task waits for all
    // handlers (including ancestors) before restoring the latest model value.
    pending = setTimeout(() => {
      pending = undefined;
      if (!scope.disposed) {
        try {
          apply();
        } catch (error) {
          reportSafely(scope.report, error);
        }
      }
    }, 0);
  };
  const start = () => {
    composing = true;
  };
  const end = () => {
    composing = false;
    if (deferred) {
      deferred = false;
      restore();
    }
  };
  const handled = (type: string) => {
    // Clicking a text control must not commit its unfinished blur draft.
    if (type !== 'click' || name === 'checked') restore();
  };
  let restorations = controlRestorations.get(element);
  if (!restorations) controlRestorations.set(element, (restorations = new Set()));
  restorations.add(handled);
  element.addEventListener('compositionstart', start);
  element.addEventListener('compositionend', end);
  scope.cleanups.push(() => {
    clearTimeout(pending);
    restorations.delete(handled);
    if (!restorations.size) controlRestorations.delete(element);
    element.removeEventListener('compositionstart', start);
    element.removeEventListener('compositionend', end);
  });
}

export function text<M, E>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  dependencies: Dependencies,
  read: () => JSX.Element,
  source?: BindingLocation,
) {
  const node = document.createTextNode('');
  parent.insertBefore(node, before);
  let start: Comment | undefined;
  let content:
    | { definition: ContentDefinition; mounted: ReturnType<ContentDefinition['mount']> }
    | undefined;
  scope.watch(
    dependencies,
    () => {
      let value = read();
      if (Array.isArray(value)) {
        validateContent(value);
        value = new SlotPlacement(arrayContent, value);
      }
      if (isContent(value)) {
        if (node.data !== '') node.data = '';
        if (content?.definition === value.definition) {
          content.mounted.set(value.value);
          return;
        }
        const previous = content;
        content = undefined;
        previous?.mounted.dispose();
        if (scope.disposed) return;
        if (start) clear(start, node);
        else {
          start = document.createComment('');
          scope.cleanups.push(() => content?.mounted.dispose());
          node.parentNode!.insertBefore(start, node);
        }
        const mounted = value.definition.mount(
          node.parentNode!,
          node,
          value.value,
          scope.report,
          scope.settlement,
        );
        if (scope.disposed) mounted.dispose();
        else content = { definition: value.definition, mounted };
        return;
      }
      if (value != null && typeof value === 'object')
        throw new Error(
          'Unsupported JSX content. Use compiled views or slots for markup, collections for entities, and an owned DOM host for native nodes.',
        );
      const next = value == null || typeof value === 'boolean' ? '' : scalar(value);
      if (content) {
        content.mounted.dispose();
        content = undefined;
        clear(start!, node);
      }
      if (node.data !== next) node.data = next;
    },
    source,
  );
}
function validateContent(value: unknown, active = new Set<readonly unknown[]>()) {
  if (Array.isArray(value)) {
    if (active.has(value)) throw new TypeError('JSX content arrays cannot contain cycles.');
    active.add(value);
    for (const child of value) validateContent(child, active);
    active.delete(value);
  } else if (
    !isContent(value) &&
    value != null &&
    !['string', 'number', 'boolean'].includes(typeof value)
  ) {
    throw new TypeError(
      'Unsupported JSX content. Use an owned DOM host for native nodes and compiled views for objects.',
    );
  }
}

const arrayContent: ContentDefinition = {
  mount: (_parent, before, value, report, settlement) =>
    mountArray(report, before, value as readonly JSX.Element[], settlement),
};

/** Runtime content arrays are positional; domain lists retain the explicit collection contract. */
function mountArray(
  report: ReportError,
  before: Node,
  initial: readonly JSX.Element[],
  settlement: Settlement,
) {
  const cells: Array<{ scope: Scope<JSX.Element, never>; start: Comment; end: Comment }> = [];
  let disposed = false;
  const disposeCell = (cell: (typeof cells)[number]) => {
    cell.scope.dispose();
    remove(cell.start, cell.end);
  };
  const set = (input: unknown) => {
    if (disposed) return;
    const values = input as readonly JSX.Element[];
    validateContent(values);
    while (cells.length > values.length) {
      disposeCell(cells.pop()!);
      if (disposed) return;
    }
    for (let index = 0; index < values.length; index++) {
      const cell = cells[index];
      if (cell) {
        if (!Object.is(cell.scope.value, values[index])) cell.scope.set(values[index]);
        if (disposed) return;
        continue;
      }
      const scope = new Scope(values[index], unboundSend, report, settlement);
      const fragment = buildFragment(before.parentNode!);
      const range = markers(fragment, null);
      try {
        text(
          scope,
          fragment,
          range.end,
          () => [scope.value],
          () => scope.value,
        );
        if (disposed) {
          scope.dispose();
          return;
        }
        before.parentNode!.insertBefore(fragment, before);
        cells.push({ scope, ...range });
      } catch (error) {
        scope.dispose();
        throw error;
      }
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const cell of cells.splice(0)) disposeCell(cell);
  };
  try {
    set(initial);
  } catch (error) {
    dispose();
    throw error;
  }
  return { set, dispose };
}

export function event<M, E>(
  scope: Scope<M, E>,
  element: Element,
  name: string,
  handler: (event: Event) => JSX.EventResult,
) {
  let effects: ReturnType<typeof eventEffects> | undefined;
  const capture =
    name.endsWith('Capture') && name !== 'onGotPointerCapture' && name !== 'onLostPointerCapture';
  const nativeName = name.slice(2, capture ? -7 : undefined);
  const type =
    nativeName === 'Begin' || nativeName === 'End' || nativeName === 'Repeat'
      ? `${nativeName.toLowerCase()}Event`
      : nativeName.toLowerCase();
  const listener = (event: Event) => {
    if (!scope.disposed) {
      try {
        const result = handler(event);
        if (result !== null && typeof result === 'object' && !scope.disposed) {
          effects ??= eventEffects(scope.report, scope.settlement);
          effects.accept(result);
        }
      } catch (error) {
        reportSafely(scope.report, error);
      } finally {
        // Restore only after an application handler commits or rejects an edit.
        // The target also covers handlers delegated to an ancestor.
        if (event.target && ['input', 'change', 'blur', 'focusout', 'click'].includes(type))
          for (const restore of controlRestorations.get(event.target) ?? []) restore(type);
      }
    }
  };
  element.addEventListener(type, listener, capture);
  scope.cleanups.push(() => {
    element.removeEventListener(type, listener, capture);
    effects?.dispose();
  });
}

/** The event binding owns its requests; snapshot renders may replace its callback. */
export function bindEvent<M, E>(
  scope: Scope<M, E>,
  element: Element,
  name: string,
  dependencies: Dependencies,
  read: () => ((event: Event) => JSX.EventResult) | undefined,
) {
  let current: ReturnType<typeof read>;
  let owned: Scope<unknown, E> | undefined;
  scope.cleanups.push(() => owned?.dispose());
  scope.watch(dependencies, () => {
    const next = read();
    if (Object.is(current, next)) return;
    current = next;
    if (!next) {
      owned?.dispose();
      owned = undefined;
    } else if (!owned) {
      owned = new Scope(next, scope.send, scope.report, scope.settlement);
      event(owned, element, name, (event) => current?.(event));
    }
  });
}

/** Reconcile merged JSX attributes. Each host, event and control owns its cleanup. */
export function bindAttributes<M, E>(
  scope: Scope<M, E>,
  element: Element,
  dependencies: Dependencies,
  read: () => Readonly<Record<string, unknown>>,
  sources?: () => Readonly<Record<string, BindingSource>> | undefined,
) {
  const bindings = new Map<string, Scope<unknown, E>>();
  let previous: Readonly<Record<string, unknown>> = {};
  const isEvent = (name: string) => /^on[A-Z]/u.test(name);
  const isControl = (name: string) =>
    (name === 'value' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) ||
    (name === 'checked' && element.tagName === 'INPUT');
  scope.cleanups.push(() => {
    runAll(
      [...bindings.values()].reverse().map((binding) => () => binding.dispose()),
      scope.report,
    );
    bindings.clear();
  });
  scope.watch(dependencies, () => {
    const next = read();
    for (const name of Object.keys(next)) {
      if (['key', 'ref', 'innerHTML', 'children'].includes(name))
        throw new Error(
          `Spread attribute ${name} is unsupported. Use collections, DOM hosts, or JSX children.`,
        );
    }
    for (const name of Object.keys(previous)) {
      if (Object.hasOwn(next, name)) continue;
      bindings.get(name)?.dispose();
      bindings.delete(name);
      if (name !== 'use' && !isEvent(name)) attribute(element, name, undefined);
    }
    for (const [name, value] of Object.entries(next)) {
      if (!Object.hasOwn(previous, name) || !Object.is(previous[name], value))
        traceBinding(
          sources?.()?.[name],
          Object.hasOwn(previous, name) ? [previous[name]] : undefined,
          [value],
          'binding',
        );
      if (name !== 'use' && !isEvent(name) && !isControl(name)) {
        if (!Object.hasOwn(previous, name) || !Object.is(previous[name], value))
          attribute(element, name, value);
        continue;
      }
      let binding = bindings.get(name);
      if (binding && Object.is(binding.value, value)) continue;
      if (binding) {
        binding.set(value);
        continue;
      }
      const owned = new Scope<unknown, E>(value, scope.send, scope.report, scope.settlement);
      bindings.set(name, owned);
      if (name === 'use')
        attach(
          owned,
          element,
          () => [owned.value],
          () => owned.value as DomMount | undefined,
        );
      else if (isControl(name))
        bindControl(
          owned,
          element,
          name,
          () => [owned.value],
          () => owned.value,
        );
      else
        bindEvent(
          owned,
          element,
          name,
          () => [owned.value],
          () => owned.value as ((event: Event) => JSX.EventResult) | undefined,
        );
    }
    previous = next;
  });
  if (element.tagName === 'SELECT')
    scope.jobs.push(() => {
      const binding = bindings.get('value');
      if (binding) binding.set(binding.value);
    });
}
export function branch<M, E>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  choose: () => boolean,
  yes: Build<M, E>,
  no: Build<M, E>,
) {
  const { start, end } = markers(parent, before);
  let child: Scope<M, E> | undefined;
  let active: boolean | undefined;
  const update = () => {
    const next = Boolean(choose());
    if (active !== next) {
      child?.dispose();
      clear(start, end);
      child = new Scope(scope.value, scope.send, scope.report, scope.settlement);
      const fragment = buildFragment(end.parentNode!);
      try {
        (next ? yes : no)(child, fragment, null);
        end.parentNode!.insertBefore(fragment, end);
        active = next;
      } catch (error) {
        child.dispose();
        active = undefined;
        throw error;
      }
    } else child!.set(scope.value);
  };
  scope.jobs.push(update);
  scope.cleanups.push(() => child?.dispose());
  update();
}
export function each<M, E, A>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  read: () => Rows<A> | readonly A[],
  outer: Dependencies,
  indexUsed: boolean,
  build: Build<readonly [A, number], E>,
) {
  const end = document.createComment('');
  parent.insertBefore(end, before);
  type Row = { start: Node; end: Node; scope: Scope<readonly [A, number], E> };
  const rows = new Map<A | Identity, Row>();
  let previousList: Rows<A> | readonly A[] | undefined;
  let previousOuter: readonly unknown[] = [];
  let previousIdentities: readonly (A | Identity)[] = [];
  const update = () => {
    if (scope.disposed) return;
    const target = end.parentNode!;
    const next = read();
    const nextOuter = outer();
    const outerChanged = !equal(previousOuter, nextOuter);
    if (next === previousList) {
      if (outerChanged) for (const row of rows.values()) row.scope.set(row.scope.value);
      previousOuter = nextOuter;
      return;
    }
    const collection = 'items' in next ? next : undefined;
    const items = collection ? collection.items : (next as readonly A[]);
    // A list filling its container can clear the DOM in one operation. Root lists
    // and lists with adjacent content retain their bounded per-row removal path.
    if (
      !items.length &&
      rows.size &&
      target instanceof Element &&
      target.firstChild === rows.get(previousIdentities[0]!)?.start &&
      target.lastChild === end
    ) {
      for (const row of rows.values()) {
        row.scope.dispose();
        if (scope.disposed) return;
      }
      target.replaceChildren(end);
      rows.clear();
      previousList = next;
      previousOuter = nextOuter;
      previousIdentities = [];
      return;
    }
    const identities = validateIdentities(items, (item, index) =>
      collection ? collection.identity(item, index) : item,
    );
    const keep = new Set(identities);
    for (const [key, row] of rows) {
      if (keep.has(key)) continue;
      row.scope.dispose();
      if (scope.disposed) return;
      remove(row.start, row.end);
      rows.delete(key);
    }
    for (let index = 0; index < items.length; index++) {
      const key = identities[index]!;
      const row = rows.get(key);
      const item = items[index]!;
      if (!row) {
        const fragment = buildFragment(target);
        const range = markers(fragment, null);
        const child = new Scope<readonly [A, number], E>(
          [item, index],
          scope.send,
          scope.report,
          scope.settlement,
        );
        try {
          build(child, fragment, range.end);
        } catch (error) {
          child.dispose();
          throw error;
        }
        if (scope.disposed) {
          child.dispose();
          return;
        }
        // A single element is its own stable range. Keep markers for dynamic/multiple roots.
        const root = range.start.nextSibling;
        const single = root instanceof Element && root.nextSibling === range.end;
        rows.set(key, {
          start: single ? root : range.start,
          end: single ? root : range.end,
          scope: child,
        });
        if (single) {
          range.start.remove();
          range.end.remove();
        }
        target.insertBefore(fragment, end);
      } else if (
        outerChanged ||
        row.scope.value[0] !== item ||
        (indexUsed && row.scope.value[1] !== index)
      ) {
        row.scope.set([item, index]);
        if (scope.disposed) return;
      }
    }
    // Retained prefixes are already ordered. New tail rows were appended above and
    // removed tail rows were disposed, so edits, appends and truncations need no moves.
    let orderChanged = false;
    for (let index = 0; index < Math.min(previousIdentities.length, identities.length); index++) {
      if (previousIdentities[index] !== identities[index]) {
        orderChanged = true;
        break;
      }
    }
    if (orderChanged) {
      const positions = new Map(previousIdentities.map((key, index) => [key, index]));
      const stationary = stationaryIndices(identities.map((key) => positions.get(key) ?? -1));
      let anchor: Node = end;
      for (let index = identities.length - 1; index >= 0; index--) {
        const row = rows.get(identities[index]!)!;
        if (!stationary.has(index) && row.end.nextSibling !== anchor) {
          const focused =
            document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
          let node: Node | null = row.start;
          while (node) {
            const next: Node | null = node.nextSibling;
            const move = Reflect.get(target, 'moveBefore');
            if (typeof move === 'function' && target.isConnected && node.isConnected)
              move.call(target, node, anchor);
            else target.insertBefore(node, anchor);
            if (node === row.end) break;
            node = next;
          }
          if (focused?.isConnected && document.activeElement !== focused)
            focused.focus({ preventScroll: true });
        }
        anchor = row.start;
      }
    }
    previousList = next;
    previousOuter = nextOuter;
    previousIdentities = identities;
  };
  scope.jobs.push(update);
  scope.cleanups.push(() => {
    for (const row of rows.values()) row.scope.dispose();
    rows.clear();
  });
  update();
}
export function child<M, E, C, F>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  definition: View<C, F>,
  dependencies: Dependencies,
  model: () => C,
  send: Send<F>,
) {
  const child = new Scope(model(), send, scope.report, scope.settlement);
  scope.cleanups.push(() => child.dispose());
  definition.build(child, parent, before);
  scope.watch(dependencies, () => {
    const next = model();
    if (!Object.is(child.value, next)) child.set(next);
  });
}

/** A late-bound compiled definition owns one replaceable DOM region. */
export function viewRegion<M, E>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  options: { manual?: boolean; report?: ReportError } = {},
) {
  const { start, end } = markers(parent, before);
  let active: Scope<M, E> | undefined;
  let definition: View<M, E> | undefined;
  if (!options.manual) scope.jobs.push(() => active?.set(scope.value));
  scope.cleanups.push(() => {
    active?.dispose();
    remove(start, end);
  });
  return (next: View<M, E> | undefined) =>
    commitDom(() => {
      if (scope.disposed) return;
      if (definition === next) {
        active?.set(scope.value);
        return;
      }
      const previous = active;
      active = undefined;
      definition = undefined;
      previous?.dispose();
      if (scope.disposed) return;
      clear(start, end);
      if (!next) return;
      const child = new Scope(
        scope.value,
        scope.send,
        options.report ?? scope.report,
        scope.settlement,
      );
      const fragment = buildFragment(end.parentNode!);
      active = child;
      definition = next;
      try {
        next.build(child, fragment, null);
        if (scope.disposed || active !== child) child.dispose();
        else end.parentNode!.insertBefore(fragment, end);
      } catch (error) {
        child.dispose();
        if (active === child) {
          active = undefined;
          definition = undefined;
        }
        throw error;
      }
    });
}

export function attach<M, E, T extends Element>(
  scope: Scope<M, E>,
  element: T,
  dependencies: Dependencies,
  read: () => DomMount<NoInfer<T>> | undefined,
) {
  let generation = 0;
  let active: ReturnType<typeof prepareMount<T>> | undefined;
  scope.cleanups.push(() => {
    generation++;
    active?.dispose(scope.settlement.exit);
    active = undefined;
  });
  scope.watch(dependencies, () => {
    const mount = read();
    if (mount && active?.update(mount)) return;
    const token = ++generation;
    active?.dispose();
    active = undefined;
    if (!mount) return;
    queueMicrotask(() => {
      if (!scope.disposed && token === generation) {
        const finished = scope.settlement.begin();
        try {
          const acquired = prepareMount(element, mount, scope.report, scope.settlement.runtime);
          Effect.runFork(acquired.closed).addObserver(finished);
          if (scope.disposed || token !== generation) acquired.dispose();
          else {
            active = acquired;
            acquired.start();
          }
        } catch (error) {
          finished();
          reportSafely(scope.report, error);
        }
      }
    });
  });
}
export function portal<M, E>(
  scope: Scope<M, E>,
  build: Build<M, E>,
  mount: () => Element | undefined = () => undefined,
) {
  let host: HTMLElement | SVGElement | undefined;
  let child: Scope<M, E> | undefined;
  scope.cleanups.push(() => {
    child?.dispose();
    host?.remove();
  });
  const update = () => {
    const target = mount() ?? document.body;
    const svg = svgChildren(target);
    if (!host || (host.namespaceURI === svgNamespace) !== svg) {
      child?.dispose();
      host?.remove();
      if (scope.disposed) return;
      host = svg
        ? target.ownerDocument.createElementNS(svgNamespace, 'g')
        : target.ownerDocument.createElement('div');
      host.style.display = 'contents';
      child = new Scope(scope.value, scope.send, scope.report, scope.settlement);
      target.appendChild(host);
      build(child, host, null);
      return;
    }
    if (host.parentNode !== target) {
      const focused = host.ownerDocument.activeElement;
      const move = Reflect.get(target, 'moveBefore');
      if (
        typeof move === 'function' &&
        target.isConnected &&
        host.isConnected &&
        target.ownerDocument === host.ownerDocument
      )
        move.call(target, host, null);
      else target.appendChild(host);
      if (
        focused instanceof HTMLElement &&
        focused.isConnected &&
        focused.ownerDocument.activeElement !== focused
      )
        focused.focus({ preventScroll: true });
    }
    child!.set(scope.value);
  };
  scope.jobs.push(update);
  update();
}

// HTML parsing supplies the initial nodes. Unusual placements, such as mounting
// an HTML-named view inside SVG, still follow the same namespace rules as element().
function placeTemplate(parent: Node, node: Node) {
  if (node.nodeType !== 1) {
    parent.appendChild(node);
    return;
  }
  const source = node as Element;
  const namespace =
    source.localName === 'svg' || svgChildren(parent)
      ? svgNamespace
      : 'http://www.w3.org/1999/xhtml';
  if (source.namespaceURI === namespace) {
    parent.appendChild(source);
    return;
  }
  const target = element(parent, null, source.localName);
  for (const attr of source.attributes) target.setAttribute(attr.name, attr.value);
  while (source.firstChild) placeTemplate(target, source.firstChild);
  source.remove();
}

/** Build static markup once per document/namespace, then clone native nodes at each use. */
export function template(build: string | ((parent: Node, before: Node | null) => void), depth = 0) {
  const documents = new WeakMap<Document, Map<boolean, Node>>();
  return (parent: Node, before: Node | null) => {
    const doc = parent.ownerDocument ?? document;
    const svg = svgChildren(parent);
    let variants = documents.get(doc);
    if (!variants) {
      variants = new Map();
      documents.set(doc, variants);
    }
    let fragment = variants.get(svg);
    if (!fragment) {
      const host = svg
        ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
        : doc.createElement('div');
      if (typeof build === 'string') {
        const source = doc.createElement('template');
        source.innerHTML = build;
        let node = source.content.firstChild!;
        for (let index = 0; index < depth; index++) node = node.firstChild!;
        placeTemplate(host, node);
      } else build(host, null);
      if (host.firstChild && !host.firstChild.nextSibling) {
        fragment = host.removeChild(host.firstChild);
      } else {
        fragment = doc.createDocumentFragment();
        while (host.firstChild) fragment.appendChild(host.firstChild);
      }
      variants.set(svg, fragment);
    }
    const clone = fragment.cloneNode(true);
    parent.insertBefore(clone, before);
    return clone;
  };
}
export function literal(parent: Node, before: Node | null, value: string) {
  parent.insertBefore((parent.ownerDocument ?? document).createTextNode(value), before);
}
