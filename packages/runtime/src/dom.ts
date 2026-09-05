import { runAll, reportError, reportSafely, type ReportError } from './errors.js';
import { eventEffects } from './effectEvent.js';
import { traceBinding, type BindingSource } from './diagnostics.js';
import { shareValue } from './share.js';
import type { Rows } from './index.js';
import type { Identity } from './collection.js';
import type { JSX } from './jsx.js';
import type { DomMount } from './mount.js';
import { startMount } from './mount.js';
import type { Program, Send } from './program.js';
type Dependencies = () => readonly unknown[];
type Cleanup = () => void;
type Build<M, E> = (scope: Scope<M, E>, parent: Node, before: Node | null) => void;
const equal = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** Compiler implementation. No implicit tracking, proxies, or per-binding subscriptions. */
export class Scope<M, E> {
  readonly jobs: Cleanup[] = [];
  readonly cleanups: Cleanup[] = [];
  disposed = false;
  private revision = 0;
  constructor(
    public value: M,
    readonly send: Send<E>,
    readonly report: ReportError = reportError,
  ) {}
  derive<A>(dependencies: Dependencies, compute: () => A, source?: BindingSource): () => A {
    let previous: readonly unknown[] | undefined;
    let value: A;
    let revision = -1;
    return () => {
      if (revision === this.revision) return value;
      const next = dependencies();
      if (!previous || !equal(previous, next)) {
        value = previous ? shareValue(value, compute()) : compute();
        traceBinding(source, previous, next, 'derive');
        previous = next;
      }
      revision = this.revision;
      return value;
    };
  }
  watch(dependencies: Dependencies, apply: () => void, source?: BindingSource) {
    let previous = dependencies();
    apply();
    traceBinding(source, undefined, previous, 'binding');
    if (!previous.length) return;
    const run = () => {
      const next = dependencies();
      if (!equal(previous, next)) {
        apply();
        traceBinding(source, previous, next, 'binding');
        previous = next;
      }
    };
    this.jobs.push(run);
  }
  set(value: M) {
    if (this.disposed) return;
    this.value = value;
    this.revision++;
    for (const job of this.jobs) {
      if (this.disposed) break;
      try {
        job();
      } catch (error) {
        reportSafely(this.report, error);
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.jobs.length = 0;
    runAll(this.cleanups.splice(0).reverse(), this.report);
  }
}
export interface View<M, E> {
  (props: M): JSX.Element;
  (props: { model: M; send: Send<E> }): JSX.Element;
  readonly build: Build<M, E>;
}

const contentBrand: unique symbol = Symbol('compiled content');
/** Owned markup accepted wherever JSX can render content. */
export interface CompiledContent {
  readonly [contentBrand]: true;
}
/** A compiled template with a typed placement value, captured in its declaring view. */
export interface Slot<A = void> {
  (value: A): JSX.Element;
  readonly [contentBrand]: [A] extends [void] ? true : false;
}
/** Compiler marker: declare inside view(), or directly in a compiled component prop. */
export function slot<A = void>(_render: (value: A) => JSX.Element): Slot<A> {
  throw new Error('MVU slot reached runtime without the snapshot JSX compiler');
}
type ContentDefinition = {
  mount(parent: Node, before: Node, value: unknown): { set(value: unknown): void; dispose(): void };
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
/** Compiler output. Captures follow their declaring scope; placements own independent scopes. */
export function compiledSlot<M, E, A>(owner: Scope<M, E>, build: Build<A, E>): Slot<A> {
  const placements = new Set<Scope<A, E>>();
  owner.jobs.push(() => {
    for (const scope of placements) scope.set(scope.value);
  });
  owner.cleanups.push(() => {
    for (const scope of placements) scope.dispose();
    placements.clear();
  });
  const definition: ContentDefinition = {
    mount(parent, before, value) {
      if (owner.disposed) throw new Error('Cannot mount content after its declaring view disposed');
      const scope = new Scope(value as A, owner.send, owner.report);
      const fragment = buildFragment(parent);
      const range = markers(fragment, null);
      scope.cleanups.push(() => remove(range.start, range.end));
      try {
        build(scope, fragment, range.end);
        parent.insertBefore(fragment, before);
        placements.add(scope);
      } catch (error) {
        scope.dispose();
        throw error;
      }
      return {
        set(value) {
          if (!Object.is(scope.value, value)) scope.set(value as A);
        },
        dispose() {
          placements.delete(scope);
          scope.dispose();
        },
      };
    },
  };
  return Object.assign((value: A): JSX.Element => new SlotPlacement(definition, value), {
    [contentBrand]: true as const,
    definition,
  }) as unknown as Slot<A>;
}

/** This declaration is a compiler marker, never a component setup callback. */
export function view<M, E>(_render: (model: M, send: Send<E>) => JSX.Element): View<M, E> {
  throw new Error('MVU view reached runtime without the snapshot JSX compiler');
}
export function compiled<M, E>(build: Build<M, E>): View<M, E> {
  return Object.assign(
    () => {
      throw new Error('Mount compiled views with mountView or inside another compiled view');
    },
    { build },
  );
}
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

export function mountView<M, E>(
  parent: Node,
  definition: View<M, E>,
  source: Program<M, E>,
  options: { onError?: ReportError } = {},
) {
  const { start, end } = markers(parent, null);
  const scope = new Scope(source.model(), source.send, options.onError);
  let unsubscribe = () => {};
  try {
    const fragment = buildFragment(parent);
    definition.build(scope, fragment, null);
    parent.insertBefore(fragment, end);
    unsubscribe = source.subscribe((model) => scope.set(model));
  } catch (error) {
    scope.dispose();
    remove(start, end);
    throw error;
  }
  return () => {
    if (scope.disposed) return;
    runAll([unsubscribe, () => scope.dispose(), () => remove(start, end)], scope.report);
  };
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
  const key = name === 'className' ? 'class' : name === 'tabIndex' ? 'tabindex' : name;
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
    [
      'checked',
      'selected',
      'disabled',
      'multiple',
      'hidden',
      'autofocus',
      'controls',
      'autoplay',
      'loop',
      'muted',
      'playsinline',
      'readonly',
      'required',
      'open',
      'inert',
      'download',
    ].includes(name) &&
    typeof value === 'boolean'
  ) {
    element.toggleAttribute(name, Boolean(value));
    if (name in element) Reflect.set(element, name, Boolean(value));
  } else if (
    value == null ||
    (value === false && !name.startsWith('aria-') && !name.startsWith('data-'))
  ) {
    element.removeAttribute(key);
  } else {
    const next = scalar(value);
    if (element.getAttribute(key) !== next) element.setAttribute(key, next);
  }
  if (key === 'class')
    for (const token of classTokens.get(element) ?? []) element.classList.add(token);
  if (name === 'style' && (value == null || typeof value !== 'object'))
    styleProperties.delete(element);
}
export function text<M, E>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  dependencies: Dependencies,
  read: () => unknown,
  source?: BindingSource,
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
      const value = read();
      if (isContent(value)) {
        node.data = '';
        if (content?.definition === value.definition) {
          content.mounted.set(value.value);
          return;
        }
        content?.mounted.dispose();
        content = undefined;
        if (start) clear(start, node);
        else {
          start = document.createComment('');
          scope.cleanups.push(() => content?.mounted.dispose());
          node.parentNode!.insertBefore(start, node);
        }
        content = {
          definition: value.definition,
          mounted: value.definition.mount(node.parentNode!, node, value.value),
        };
        return;
      }
      if (content) {
        content.mounted.dispose();
        content = undefined;
        clear(start!, node);
      }
      if (value != null && typeof value === 'object')
        throw new Error(
          'Object rendered as text. Use collection(...).from(items).map(...) for entity lists.',
        );
      const next = value == null || typeof value === 'boolean' ? '' : scalar(value);
      if (node.data !== next) node.data = next;
    },
    source,
  );
}
export function event<M, E>(
  scope: Scope<M, E>,
  element: Element,
  name: string,
  handler: (event: Event) => unknown,
) {
  let effects: ReturnType<typeof eventEffects> | undefined;
  const capture = name.endsWith('Capture');
  const type = name.slice(2, capture ? -7 : undefined).toLowerCase();
  const listener = (event: Event) => {
    if (!scope.disposed) {
      try {
        const result = handler(event);
        if (result !== null && typeof result === 'object' && !scope.disposed) {
          effects ??= eventEffects(scope.report);
          effects.accept(result);
        }
      } catch (error) {
        reportSafely(scope.report, error);
      }
    }
  };
  element.addEventListener(type, listener, capture);
  scope.cleanups.push(() => {
    element.removeEventListener(type, listener, capture);
    effects?.dispose();
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
      child = new Scope(scope.value, scope.send, scope.report);
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
  const rows = new Map<Identity, Row>();
  let previousList: Rows<A> | readonly A[] | undefined;
  let previousOuter: readonly unknown[] = [];
  let previousIdentities: readonly Identity[] = [];
  const update = () => {
    const target = end.parentNode!;
    const next = read();
    const nextOuter = outer();
    const outerChanged = !equal(previousOuter, nextOuter);
    if (next === previousList && !outerChanged) return;
    const collection = 'items' in next ? next : undefined;
    const items = collection ? collection.items : (next as readonly A[]);
    const identities = items.map((item, index) => {
      const key = collection ? collection.identity(item, index) : item;
      if (typeof key !== 'string' && typeof key !== 'number')
        throw new Error(
          'Object lists need domain identity. Declare collection(identity) once; do not add JSX keys.',
        );
      return key;
    });
    if (new Set(identities).size !== identities.length)
      throw new Error(
        'Duplicate collection identity. Identity must be unique within the rendered collection.',
      );
    const keep = new Set(identities);
    for (const [key, row] of rows) {
      if (keep.has(key)) continue;
      row.scope.dispose();
      remove(row.start, row.end);
      rows.delete(key);
    }
    for (let index = 0; index < items.length; index++) {
      const key = identities[index]!;
      const row = rows.get(key);
      const item = row ? shareValue(row.scope.value[0], items[index]!) : items[index]!;
      if (!row) {
        const fragment = buildFragment(target);
        const range = markers(fragment, null);
        const child = new Scope<readonly [A, number], E>([item, index], scope.send, scope.report);
        try {
          build(child, fragment, range.end);
        } catch (error) {
          child.dispose();
          throw error;
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
      }
    }
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
export function invoke<M, E>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  dependencies: Dependencies,
  read: () => readonly unknown[],
  build: Build<readonly unknown[], E>,
) {
  const child = new Scope(read(), scope.send, scope.report);
  scope.cleanups.push(() => child.dispose());
  build(child, parent, before);
  scope.watch(dependencies, () => {
    const next = read();
    if (!equal(child.value, next)) child.set(next);
  });
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
  const child = new Scope(model(), send, scope.report);
  scope.cleanups.push(() => child.dispose());
  definition.build(child, parent, before);
  scope.watch(dependencies, () => {
    const next = model();
    if (!Object.is(child.value, next)) child.set(next);
  });
}
export function attach<M, E>(
  scope: Scope<M, E>,
  element: Element,
  dependencies: Dependencies,
  read: () => DomMount | undefined,
) {
  let generation = 0;
  let active: ReturnType<typeof startMount> | undefined;
  scope.cleanups.push(() => {
    generation++;
    active?.dispose();
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
        try {
          active = startMount(element, mount, scope.report);
        } catch (error) {
          reportSafely(scope.report, error);
        }
      }
    });
  });
}
export function portal<M, E>(scope: Scope<M, E>, build: Build<M, E>) {
  const host = document.createElement('div');
  host.style.display = 'contents';
  document.body.appendChild(host);
  const child = new Scope(scope.value, scope.send, scope.report);
  scope.cleanups.push(() => {
    child.dispose();
    host.remove();
  });
  build(child, host, null);
  scope.jobs.push(() => child.set(scope.value));
}

/** Build static markup once per document/namespace, then clone native nodes at each use. */
export function template(build: (parent: Node, before: Node | null) => void) {
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
      build(host, null);
      if (host.firstChild && !host.firstChild.nextSibling) {
        fragment = host.removeChild(host.firstChild);
      } else {
        fragment = doc.createDocumentFragment();
        while (host.firstChild) fragment.appendChild(host.firstChild);
      }
      variants.set(svg, fragment);
    }
    parent.insertBefore(fragment.cloneNode(true), before);
  };
}
export function literal(parent: Node, before: Node | null, value: string) {
  parent.insertBefore((parent.ownerDocument ?? document).createTextNode(value), before);
}
