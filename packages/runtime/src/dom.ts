import attributeData from './dom-attributes.json' with { type: 'json' };
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';

import { keyed, validateIdentities } from './collection.js';
import { runAll, reportError, reportSafely, type ReportError } from './errors.js';
import { eventEffects } from './event-effects.js';
// Internal listener ownership, available to runtime contract checks.
export { eventEffects };
/** Development metadata naming where a binding was written; used to locate render failures. */
export interface BindingSource {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly expression: string;
}
import type { Rows } from './index.js';
import type { Identity } from './collection.js';
import { jsxComponent, type JSX } from './jsx.js';
import type { DomMount } from './mount.js';
import { Settlement } from './settlement.js';
import { prepareMount } from './mount.js';
import type { Send } from './program.js';
import type { Source } from './source.js';
import { isSource, mountSource } from './controller.js';
type Dependencies = () => readonly unknown[];
type BindingLocation = BindingSource | (() => BindingSource | undefined);
const bindingLocation = (source: BindingLocation | undefined) =>
  typeof source === 'function' ? source() : source;
type Cleanup = () => void;
/** The live first and last DOM node of mounted content. */
export interface ContentRange {
  readonly start: Node;
  readonly end: Node;
}
/**
 * Builds content before `before`. A build that returns its range needs no comment markers
 * around it; a build that returns nothing is wrapped in markers by its owner.
 */
type Build<M, E> = (scope: Scope<M, E>, parent: Node, before: Node | null) => ContentRange | void;
// Development builds know where each binding was written. Name the innermost one in its
// failure, so a report identifies the view instead of only the renderer's stack.
const located = new WeakSet<object>();
function locate(error: unknown, source: BindingLocation | undefined): unknown {
  if (!source || !(error instanceof Error) || located.has(error)) return error;
  const binding = bindingLocation(source);
  if (!binding) return error;
  located.add(error);
  try {
    error.message += `\n    in {${binding.expression}} (${binding.file}:${binding.line}:${binding.column})`;
  } catch {
    // A frozen error keeps its own message.
  }
  return error;
}
function locatedReport(report: ReportError, source: BindingLocation | undefined): ReportError {
  return source && bindingLocation(source) ? (error) => report(locate(error, source)) : report;
}
const equal = (a: readonly unknown[], b: readonly unknown[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (!Object.is(a[index], b[index])) return false;
  return true;
};

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
    const update = source
      ? () => {
          try {
            apply();
          } catch (error) {
            throw locate(error, source);
          }
        }
      : apply;
    update();
    if (!previous.length) return;
    const run = () => {
      const next = dependencies();
      if (!equal(previous, next)) {
        update();
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
/**
 * The props of a view that sends messages. No props satisfy it, so placing such a view as
 * `<Row … />` is a type error that names the fix.
 */
export interface MessageViewPlacement {
  readonly 'This view sends messages. Give it to component({ init, update }, view) or mount, or pass send to the child as a prop': never;
}
export interface View<M, E> extends JSX.ComponentType {
  (this: never, props: [E] extends [never] ? M : MessageViewPlacement): JSX.Element;
  readonly build: Build<M, E>;
}

/** Untyped callers get an actionable failure instead of silently losing child messages. */
export function unboundSend(_message: unknown): never {
  throw new Error(
    'This view sends messages but has no dispatcher. Mount it through component or mount, or pass send as a prop.',
  );
}

const contentBrand: unique symbol = Symbol('compiled content');
/** Owned markup accepted wherever JSX can render content. */
export interface CompiledContent {
  readonly [contentBrand]: true;
}
interface MountedContent extends ContentRange {
  set(value: unknown): void;
  dispose(): void;
}
type ContentDefinition = {
  /** Present on intrinsic element definitions. */
  readonly tag?: string;
  mount(
    parent: Node,
    before: Node | null,
    value: unknown,
    report: ReportError,
    settlement: Settlement,
  ): MountedContent;
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
/**
 * An intrinsic element in JSX output. It is its own mount value, so an element costs one
 * object (plus its children array) per render.
 */
class MarkupPlacement implements CompiledContent {
  declare readonly [contentBrand]: true;
  readonly value = this;
  constructor(
    readonly definition: ContentDefinition,
    readonly attrs: MarkupAttributes,
    /** One child, or the array of children when `arity` is 2 or more. */
    readonly children: unknown,
    /** The number of fixed children at the call site, or -1 for a single child. */
    readonly arity: number,
    readonly sources: Readonly<Record<string, BindingSource>> | undefined,
    /** Set by `still`: every attribute and child is a literal, so the element can be cloned. */
    readonly still: boolean,
  ) {}
}
/**
 * The static shape of one JSX call site: tag, attributes and children. Attributes are the
 * hoisted literal object (baked into the skeleton), `null` for none, or `0` when they are
 * dynamic. A child is literal text, `1` for a dynamic position, a nested element's shape, or
 * a hoisted static element.
 */
export type SiteNode = readonly [
  tag: string,
  attrs: Readonly<Record<string, unknown>> | null | 0,
  children: readonly (string | 1 | SiteNode | CompiledContent)[],
];
/**
 * One JSX call site with nested elements: the site's static shape and the values of its
 * dynamic positions in source order (an element's attributes come before its children). A
 * whole element tree costs one object and one array per render.
 */
class BlockPlacement implements CompiledContent {
  declare readonly [contentBrand]: true;
  readonly value = this;
  constructor(
    readonly definition: ContentDefinition,
    readonly site: SiteNode,
    readonly values: readonly unknown[],
    /** Development metadata for each dynamic position. */
    readonly sources: readonly (BindingSource | undefined)[] | undefined,
  ) {}
}
Object.defineProperty(MarkupPlacement.prototype, contentBrand, { value: true });
Object.defineProperty(BlockPlacement.prototype, contentBrand, { value: true });
const holeCounts = new WeakMap<SiteNode, number>();
/** The number of dynamic positions in a shape, including those of its nested elements. */
function holeCount(site: SiteNode): number {
  let count = holeCounts.get(site);
  if (count === undefined) {
    count = site[1] === 0 ? 1 : 0;
    for (const child of site[2]) {
      if (child === 1) count++;
      else if (typeof child !== 'string' && !(child instanceof MarkupPlacement))
        count += holeCount(child as SiteNode);
    }
    holeCounts.set(site, count);
  }
  return count;
}
/**
 * The element-by-element form of a block, for the paths that reconcile per element: a site
 * that cannot be cloned, or markup from another site arriving at the same position. Nested
 * elements stay blocks of their own shape unless `deep`.
 */
function expand(placement: BlockPlacement, deep: boolean): MarkupPlacement {
  const { values, sources } = placement;
  let cursor = 0;
  const build = (site: SiteNode): MarkupPlacement => {
    const [tag, attrs, children] = site;
    const applied = attrs === 0 ? (values[cursor++] as MarkupAttributes) : attrs;
    const items: unknown[] = [];
    let source: BindingSource | undefined;
    for (const child of children) {
      if (child === 1) {
        source = sources?.[cursor];
        items.push(values[cursor++]);
      } else if (typeof child === 'string' || child instanceof MarkupPlacement) items.push(child);
      else if (deep) items.push(build(child as SiteNode));
      else {
        const shape = child as SiteNode;
        const end = cursor + holeCount(shape);
        items.push(
          new BlockPlacement(
            markupDefinition(shape[0]),
            shape,
            values.slice(cursor, end),
            sources?.slice(cursor, end),
          ),
        );
        cursor = end;
      }
    }
    const count = items.length;
    return new MarkupPlacement(
      markupDefinition(tag),
      applied,
      count > 1 ? items : items[0],
      count > 1 ? count : -1,
      count === 1 && source ? { children: source } : undefined,
      false,
    );
  };
  return build(placement.site);
}
function isContent(value: unknown): value is ContentValue {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    contentBrand in value
  );
}
/** A placement built by another copy of this module: its brand symbol is a different symbol. */
function foreignContent(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    'definition' in value &&
    'value' in value &&
    typeof (value as { definition?: { mount?: unknown } }).definition?.mount === 'function'
  );
}
const foreignContentMessage =
  'This JSX was built by a second copy of effectweb. Two runtime copies are loaded: deduplicate the effectweb dependency (one install, resolve.dedupe, or one import path) so views and the compiled output share a runtime.';
/** Evaluate ordinary synchronous JavaScript for each immutable model publication. */
/* @__NO_SIDE_EFFECTS__ */
export function view<M, E = never>(render: (model: M, send: Send<E>) => JSX.Element): View<M, E> {
  return compiled((scope, parent, before) => {
    const read = () => render(scope.value as M, scope.send);
    return text(scope, parent, before, () => [scope.value], read);
  });
}
/* @__NO_SIDE_EFFECTS__ */
export function compiled<M, E>(build: Build<M, E>): View<M, E> {
  const definition: View<M, E> = Object.assign(
    (props: M | MessageViewPlacement) =>
      new SlotPlacement(viewContent(definition), { model: props, send: unboundSend }),
    { build, [jsxComponent]: true as const },
  );
  return definition;
}

/** Skip a view only under the caller's explicit equality contract. */
export function memoView<M, E>(
  definition: View<M, E>,
  equals: (previous: M, next: M) => boolean,
): View<M, E> {
  return compiled((scope, parent, before) => {
    const child = new Scope(scope.value, scope.send, scope.report, scope.settlement);
    scope.cleanups.push(() => child.dispose());
    const range = definition.build(child, parent, before);
    scope.jobs.push(() => {
      if (!equals(child.value as M, scope.value as M)) child.set(scope.value);
    });
    return range;
  });
}

const capturedValues = Symbol('captured');
type Captured = { readonly [capturedValues]?: readonly unknown[] };
/**
 * Compiler output for an inline function prop of a view: the site it was written at and the
 * outer values it reads. Two functions from one site that read the same values behave the same,
 * so the view receiving them is not run again.
 */
export function captured<F extends object>(callback: F, values: readonly unknown[]): F {
  (callback as { [capturedValues]?: readonly unknown[] })[capturedValues] = values;
  return callback;
}
function sameCaptured(previous: unknown, next: unknown): boolean {
  if (typeof previous !== 'function' || typeof next !== 'function') return false;
  const before = (previous as Captured)[capturedValues];
  const after = (next as Captured)[capturedValues];
  if (!before || !after || before.length !== after.length) return false;
  for (let index = 0; index < after.length; index++)
    if (!Object.is(before[index], after[index])) return false;
  return true;
}

/** Two plain objects with the same keys and identical values. */
function sameFields(previous: unknown, next: unknown): boolean {
  if (
    previous === null ||
    next === null ||
    typeof previous !== 'object' ||
    typeof next !== 'object'
  )
    return false;
  const prototype: unknown = Object.getPrototypeOf(next);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getPrototypeOf(previous) !== prototype
  )
    return false;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  let count = 0;
  for (const key in after) {
    if (
      !Object.hasOwn(before, key) ||
      (!Object.is(before[key], after[key]) && !sameCaptured(before[key], after[key]))
    )
      return false;
    count++;
  }
  for (const _ in before) count--;
  return count === 0;
}
const viewDefinitions = new WeakMap<object, ContentDefinition>();
function viewContent<M, E>(definition: View<M, E>): ContentDefinition {
  let content = viewDefinitions.get(definition);
  if (!content) {
    content = {
      mount: (parent, before, value, report, settlement) =>
        new ViewContent(definition, parent, before, value as ViewInput<M, E>, report, settlement),
    };
    viewDefinitions.set(definition, content);
  }
  return content;
}

/**
 * The range of a build that did not report one: its single root element when that is all it
 * added after `mark`, otherwise a pair of markers placed around what it added.
 */
function boundRange(fragment: DocumentFragment, mark: Node | null): ContentRange {
  const first = mark ? mark.nextSibling : fragment.firstChild;
  if (first && first === fragment.lastChild && first instanceof Element)
    return { start: first, end: first };
  const start = document.createComment('');
  const end = document.createComment('');
  fragment.insertBefore(start, first);
  fragment.appendChild(end);
  return { start, end };
}
function removeAfter(parent: Node, mark: Node | null) {
  while (parent.lastChild && parent.lastChild !== mark) parent.removeChild(parent.lastChild);
}
/** Content built by a builder into its own scope, mounted at one position. */
class BuiltContent<A, E> implements MountedContent {
  protected scope!: Scope<A, E>;
  private range!: ContentRange;
  protected place(scope: Scope<A, E>, build: Build<A, E>, parent: Node, before: Node | null) {
    this.scope = scope;
    // Content appended to a detached build fragment is built in place: its owner inserts
    // that fragment once, so a fragment of its own would only move the nodes twice.
    const direct = parent.nodeType === 11 && before === null;
    const fragment = direct ? (parent as DocumentFragment) : buildFragment(parent);
    const mark = direct ? parent.lastChild : null;
    let built: ContentRange | void;
    try {
      built = build(scope, fragment, null);
    } catch (error) {
      scope.dispose();
      if (direct) removeAfter(fragment, mark);
      throw error;
    }
    // Content that reports its own range needs no markers around it.
    this.range = built ?? boundRange(fragment, mark);
    if (direct) {
      if (scope.disposed) removeAfter(fragment, mark);
    } else if (!scope.disposed) parent.insertBefore(fragment, before);
  }
  get start(): Node {
    return this.range.start;
  }
  get end(): Node {
    return this.range.end;
  }
  set(value: unknown) {
    this.scope.set(value as A);
  }
  dispose() {
    const scope = this.scope;
    if (scope.disposed) return;
    const removedByAncestor = detaching;
    const start = this.range.start;
    const end = this.range.end;
    detached(() => scope.dispose());
    if (!removedByAncestor) remove(start, end);
  }
}
class DefinedContent<A> extends BuiltContent<A, never> {
  constructor(
    build: Build<A, never>,
    parent: Node,
    before: Node | null,
    value: A,
    report: ReportError,
    settlement: Settlement,
  ) {
    super();
    this.place(new Scope(value, unboundSend, report, settlement), build, parent, before);
  }
}
function contentDefinition<A>(build: Build<A, never>): ContentDefinition {
  return {
    mount: (parent, before, value, report, settlement) =>
      new DefinedContent(build, parent, before, value as A, report, settlement),
  };
}
type ViewInput<M, E> = { readonly model: M; readonly send: Send<E> };
/** A placed view: its model scope, bound to the dispatcher of the latest placement. */
class ViewContent<M, E> extends BuiltContent<M, E> {
  constructor(
    definition: View<M, E>,
    parent: Node,
    before: Node | null,
    private input: ViewInput<M, E>,
    report: ReportError,
    settlement: Settlement,
  ) {
    super();
    const scope = new Scope<M, E>(
      input.model,
      (message: E) => this.input.send(message),
      report,
      settlement,
    );
    this.place(scope, definition.build, parent, before);
  }
  override set(value: unknown) {
    const input = value as ViewInput<M, E>;
    this.input = input;
    const next = input.model;
    const scope = this.scope;
    // JSX builds a new props object on every render. Views are pure, so props whose
    // fields are all identical render the same content and are skipped.
    if (next !== scope.value && sameFields(scope.value, next)) return;
    scope.set(next);
  }
}

type MarkupAttributes = Readonly<Record<string, unknown>> | null | undefined;
type MarkupValue = MarkupPlacement | BlockPlacement;
const noAttributes: Readonly<Record<string, unknown>> = Object.freeze({});
const markupDefinitions = new Map<string, ContentDefinition>();
/**
 * JSX factories preserve host identity by element type; source locations are metadata only.
 * Attributes arrive separately from children, so a literal attribute object hoisted by the
 * compiler keeps its identity and skips reconciliation entirely.
 */
function markupDefinition(tag: string): ContentDefinition {
  let definition = markupDefinitions.get(tag);
  if (!definition) {
    definition = {
      tag,
      mount: (parent, before, value, report, settlement) =>
        new ElementMount(tag, parent, before, value as MarkupValue, report, settlement),
    };
    markupDefinitions.set(tag, definition);
  }
  return definition;
}
export function markup(
  tag: string,
  sources?: Readonly<Record<string, BindingSource>>,
): (attrs: MarkupAttributes, ...children: unknown[]) => JSX.Element {
  const element = markupDefinition(tag);
  return (attrs, ...children) => {
    const count = children.length;
    return new MarkupPlacement(
      element,
      attrs,
      // Spread attributes may carry children; JSX children at the call site take precedence.
      count > 1 ? children : count ? children[0] : attrs?.children,
      count > 1 ? count : -1,
      sources,
      false,
    );
  };
}

/**
 * A call site whose element contains nested elements. The compiler records the tree's static
 * shape once and passes only the values of its dynamic positions on each render.
 */
export function block(
  site: SiteNode,
  sources?: readonly (BindingSource | undefined)[],
): (...values: unknown[]) => JSX.Element {
  const element = markupDefinition(site[0]);
  return (...values) => new BlockPlacement(element, site, values, sources);
}

/**
 * Mark an element whose attributes and children are all literals. The compiler applies it to
 * hoisted static JSX; such an element is built once and cloned for every later mount.
 */
export function still(content: JSX.Element): JSX.Element {
  if (content instanceof MarkupPlacement)
    return new MarkupPlacement(
      content.definition,
      content.attrs,
      content.children,
      content.arity,
      content.sources,
      true,
    );
  return content;
}

// Elements with their own state or loading behaviour are always created, never cloned.
const untemplated = new Set([
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'iframe',
  'video',
  'audio',
  'object',
  'embed',
  'script',
  'canvas',
]);
// Elements that start loading or playing from their attributes, even outside the document.
const loading = new Set(['iframe', 'video', 'audio', 'object', 'embed', 'script']);
const templates = new WeakMap<object, { html?: Element | null; svg?: Element | null }>();
function staticTemplate(tag: string, value: MarkupPlacement, svg: boolean): Element | undefined {
  let entry = templates.get(value);
  if (!entry) templates.set(value, (entry = {}));
  const key = svg ? 'svg' : 'html';
  let template = entry[key];
  if (template === undefined) entry[key] = template = buildStatic(tag, value, svg) ?? null;
  return template ?? undefined;
}
function buildStatic(tag: string, value: MarkupPlacement, svg: boolean): Element | undefined {
  if (untemplated.has(tag) || tag.includes('-')) return undefined;
  const node = svg ? document.createElementNS(svgNamespace, tag) : document.createElement(tag);
  const attrs = value.attrs;
  if (attrs)
    for (const name in attrs) {
      const item = attrs[name];
      if (
        name === 'children' ||
        name === 'use' ||
        name === 'value' ||
        name === 'checked' ||
        name === 'key' ||
        name === 'ref' ||
        name === 'innerHTML' ||
        isEvent(name) ||
        (typeof item !== 'string' && typeof item !== 'number' && item !== true)
      )
        return undefined;
      attribute(node, name, item);
    }
  const nested = node.namespaceURI === svgNamespace && node.localName !== 'foreignObject';
  const children = value.children;
  const items =
    value.arity >= 0 ? (children as readonly unknown[]) : children === undefined ? [] : [children];
  for (const item of items) {
    if (typeof item === 'string' || typeof item === 'number')
      node.appendChild(document.createTextNode(String(item)));
    else if (item instanceof MarkupPlacement && item.still) {
      const childTag = item.definition.tag!;
      const child = buildStatic(childTag, item, childTag === 'svg' || nested);
      if (!child) return undefined;
      node.appendChild(child);
    } else return undefined;
  }
  return node;
}

/** The detached element tree of a call site, cloned for every mount of that site. */
function siteSkeleton(site: SiteNode, svg: boolean): Element | undefined {
  let entry = templates.get(site);
  if (!entry) templates.set(site, (entry = {}));
  const key = svg ? 'svg' : 'html';
  let template = entry[key];
  if (template === undefined) entry[key] = template = buildSkeleton(site, svg) ?? null;
  return template ?? undefined;
}
function buildSkeleton(site: SiteNode, svg: boolean): Element | undefined {
  const [tag, attrs, children] = site;
  if (attrs && loading.has(tag)) return undefined;
  const node = svg ? document.createElementNS(svgNamespace, tag) : document.createElement(tag);
  if (attrs) for (const name in attrs) attribute(node, name, attrs[name]);
  const nested = node.namespaceURI === svgNamespace && node.localName !== 'foreignObject';
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    // Each dynamic position is an empty text node: dynamic text only has to set its data.
    else if (child === 1) node.appendChild(document.createTextNode(''));
    else if (child instanceof MarkupPlacement) {
      const tagName = child.definition.tag!;
      const built = buildStatic(tagName, child, tagName === 'svg' || nested);
      if (!built) return undefined;
      node.appendChild(built);
    } else {
      const shape = child as SiteNode;
      const built = buildSkeleton(shape, shape[0] === 'svg' || nested);
      if (!built) return undefined;
      node.appendChild(built);
    }
  }
  return node;
}

const isControl = (element: Element, name: string) =>
  (name === 'value' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) ||
  (name === 'checked' && element.tagName === 'INPUT');

/** Content that is shown as text: a position holding it needs no slot. */
const plain = (value: unknown): value is string | number | bigint | boolean | null | undefined =>
  value == null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  typeof value === 'bigint';
const plainText = (value: string | number | bigint | boolean | null | undefined): string =>
  value == null || typeof value === 'boolean' ? '' : String(value);

const Children = { None: 0, Text: 1, Single: 2, Fixed: 3, Static: 4 } as const;
type Children = (typeof Children)[keyof typeof Children];
/**
 * One mounted intrinsic element. It reconciles its attributes and children directly and
 * allocates an owner scope only for events, controls and DOM bindings, so an element that
 * owns nothing costs one object and no extra DOM nodes.
 */
class ElementMount implements MountedContent {
  readonly node: Element;
  disposed = false;
  private attrs: MarkupAttributes;
  private applied: Readonly<Record<string, unknown>> = noAttributes;
  private attrsFailed = false;
  private bindings: Record<string, Binding | undefined> | undefined;
  private kind: Children = Children.None;
  private children: unknown;
  private childrenFailed = false;
  private textNode: Text | undefined;
  private slot: ContentSlot | undefined;
  private slots: ContentSlot[] | undefined;
  /** The call site this element was cloned from, while it is still managed as a block. */
  private block: SiteNode | undefined;
  /**
   * In block mode: the dynamic positions of the site, in source order. An element with
   * dynamic attributes is its own position; for the root element that is this mount. A
   * position showing plain text is just its text node, and becomes a slot the first time it
   * receives markup.
   */
  private holes: Array<ElementMount | ContentSlot | Text> | undefined;
  /** In block mode: the select elements among the positions. */
  private selects: ElementMount[] | undefined;
  private cursor = 0;
  /** The last value applied in block mode; it describes the nodes when unblocking. */
  private placed: BlockPlacement | undefined;
  private readonly select: boolean;
  constructor(
    tag: string,
    parent: Node,
    before: Node | null,
    input: MarkupValue | undefined,
    private readonly report: ReportError,
    private readonly settlement: Settlement,
    adopted?: Element,
  ) {
    if (adopted || !input) {
      // An existing element of a cloned site.
      this.node = adopted!;
      this.select = adopted!.tagName === 'SELECT';
      return;
    }
    const svg = tag === 'svg' || svgChildren(parent);
    let value: MarkupPlacement;
    if (input instanceof BlockPlacement) {
      const site = input.site;
      const skeleton = siteSkeleton(site, svg);
      if (skeleton) {
        // Clone the site's static tree and bind only its dynamic positions.
        this.node = skeleton.cloneNode(true) as Element;
        this.select = tag === 'select';
        this.block = site;
        this.holes = [];
        this.placed = input;
        try {
          this.bindBlock(site, this.node, input, true);
        } catch (error) {
          this.disposed = true;
          detached(() => this.release());
          throw error;
        }
        parent.insertBefore(this.node, before);
        return;
      }
      value = expand(input, false);
    } else value = input;
    const template = value.still ? staticTemplate(tag, value, svg) : undefined;
    if (template) {
      this.node = template.cloneNode(true) as Element;
      this.select = false;
      this.attrs = value.attrs;
      this.applied = value.attrs ?? noAttributes;
      this.children = value.children;
      this.kind = Children.Static;
    } else {
      const doc = parent.ownerDocument ?? document;
      this.node = svg ? doc.createElementNS(svgNamespace, tag) : doc.createElement(tag);
      this.select = tag === 'select';
      try {
        this.applyAttributes(value.attrs ?? noAttributes);
        this.attrs = value.attrs;
        this.applyChildren(value.children, value.arity, value.sources?.children);
        this.children = value.children;
      } catch (error) {
        this.disposed = true;
        detached(() => this.release());
        throw locate(error, value.sources?.children);
      }
    }
    parent.insertBefore(this.node, before);
  }
  get start(): Node {
    return this.node;
  }
  get end(): Node {
    return this.node;
  }
  set(input: unknown) {
    if (this.disposed) return;
    let value: MarkupPlacement;
    if (input instanceof BlockPlacement) {
      if (input.site === this.block) {
        // The same call site: only its dynamic positions can differ.
        if (input !== this.placed) {
          this.updateBlock(input.values);
          this.placed = input;
        }
        return;
      }
      value = expand(input, false);
    } else value = input as MarkupPlacement;
    // Markup from another site reconciles element by element.
    if (this.block) this.unblock();
    this.updateAttributes(value.attrs);
    if (this.disposed) return;
    if (value.children !== this.children || this.childrenFailed) {
      const source = value.sources?.children;
      try {
        this.applyChildren(value.children, value.arity, source);
        this.children = value.children;
        this.childrenFailed = false;
      } catch (error) {
        this.childrenFailed = true;
        reportSafely(this.report, locate(error, source));
      }
      if (this.disposed) return;
    }
    if (this.select) this.reselect();
  }
  /** The selected value may stay equal while its options change on this publication. */
  private reselect() {
    const binding = this.bindings?.['value'];
    if (binding) binding.set(binding.value);
  }
  /** Bind the dynamic positions of a cloned site, in source order. */
  private bindBlock(site: SiteNode, node: Element, value: BlockPlacement, root: boolean) {
    const holes = this.holes!;
    const [, attrs, children] = site;
    const values = value.values;
    if (attrs === 0) {
      const mount = root
        ? this
        : new ElementMount('', node, null, undefined, this.report, this.settlement, node);
      holes.push(mount);
      if (mount.select) (this.selects ??= []).push(mount);
      const applied = values[this.cursor++] as MarkupAttributes;
      mount.applyAttributes(applied ?? noAttributes, true);
      mount.attrs = applied;
    } else if (root) {
      this.attrs = attrs;
      this.applied = attrs ?? noAttributes;
    }
    let dom = node.firstChild;
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (child === 1) {
        const position = this.cursor++;
        const shown = values[position];
        if (plain(shown)) {
          const text = plainText(shown);
          if (text !== '') (dom as Text).data = text;
          holes.push(dom as Text);
          dom = dom!.nextSibling;
          continue;
        }
        const slot = ContentSlot.anchored(
          dom as Text,
          this.report,
          this.settlement,
          value.sources?.[position],
        );
        holes.push(slot);
        slot.set(shown);
        dom = slot.end.nextSibling;
        continue;
      }
      if (typeof child !== 'string' && !(child instanceof MarkupPlacement))
        this.bindBlock(child as SiteNode, dom as Element, value, false);
      dom = dom!.nextSibling;
    }
  }
  /** Apply new values from the same site to its dynamic positions. */
  private updateBlock(values: readonly unknown[]) {
    const holes = this.holes!;
    const placed = this.placed!;
    const previous = placed.values;
    for (let index = 0; index < holes.length; index++) {
      const hole = holes[index]!;
      const next = values[index];
      if (hole instanceof ElementMount) hole.updateAttributes(next as MarkupAttributes);
      else if (hole instanceof ContentSlot) {
        try {
          hole.set(next);
        } catch (error) {
          reportSafely(this.report, error);
        }
      } else if (!Object.is(previous[index], next)) {
        if (plain(next)) {
          const text = plainText(next);
          if (hole.data !== text) hole.data = text;
        } else {
          // The position receives markup for the first time: it needs a slot from now on.
          const slot = ContentSlot.ofText(
            hole,
            previous[index],
            this.report,
            this.settlement,
            placed.sources?.[index],
          );
          holes[index] = slot;
          try {
            slot.set(next);
          } catch (error) {
            reportSafely(this.report, error);
          }
        }
      }
      if (this.disposed) return;
    }
    const selects = this.selects;
    if (selects) for (const select of selects) select.reselect();
  }
  /** Apply attributes, reporting a failure and retrying on the next publication. */
  private updateAttributes(attrs: MarkupAttributes) {
    if (attrs === this.attrs && !this.attrsFailed) return;
    try {
      this.applyAttributes(attrs ?? noAttributes);
      this.attrs = attrs;
      this.attrsFailed = false;
    } catch (error) {
      this.attrsFailed = true;
      reportSafely(this.report, error);
    }
  }
  /**
   * Turn the block back into ordinary per-element mounts over the same nodes, so markup from
   * another call site reconciles in place: elements, bindings and child state are all kept.
   */
  private unblock() {
    const site = this.block!;
    const tree = expand(this.placed!, true);
    this.block = undefined;
    // The root's own attributes are the first position when they are dynamic.
    this.cursor = site[1] === 0 ? 1 : 0;
    this.adoptChildren(this, site, tree);
    this.holes = undefined;
    this.selects = undefined;
    this.placed = undefined;
  }
  private adoptChildren(mount: ElementMount, site: SiteNode, value: MarkupPlacement) {
    const children = site[2];
    const node = mount.node;
    mount.children = value.children;
    if (children.length === 0) return;
    if (children.length === 1) {
      const child = children[0]!;
      if (child === 1) {
        mount.kind = Children.Single;
        mount.slot = this.adoptSlot(value.children);
      } else if (typeof child === 'string') {
        mount.kind = Children.Text;
        mount.textNode = node.firstChild as Text;
      } else {
        const placement = value.children as MarkupPlacement;
        mount.kind = Children.Single;
        mount.slot = ContentSlot.holding(
          node,
          placement,
          this.adoptElement(child, node.firstChild as Element, placement),
          this.report,
          this.settlement,
        );
      }
      return;
    }
    const items = value.children as readonly unknown[];
    const slots: ContentSlot[] = [];
    let dom = node.firstChild;
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (child === 1) {
        const slot = this.adoptSlot(items[index]);
        slots.push(slot);
        dom = slot.end.nextSibling;
        continue;
      }
      if (typeof child === 'string')
        slots.push(ContentSlot.ofText(dom as Text, items[index], this.report, this.settlement));
      else {
        const placement = items[index] as MarkupPlacement;
        slots.push(
          ContentSlot.holding(
            undefined,
            placement,
            this.adoptElement(child, dom as Element, placement),
            this.report,
            this.settlement,
          ),
        );
      }
      dom = dom!.nextSibling;
    }
    mount.kind = Children.Fixed;
    mount.slots = slots;
  }
  /** The slot of the next dynamic position, which shows `shown`. */
  private adoptSlot(shown: unknown): ContentSlot {
    const hole = this.holes![this.cursor++] as ContentSlot | Text;
    return hole instanceof ContentSlot
      ? hole
      : ContentSlot.ofText(hole, shown, this.report, this.settlement);
  }
  private adoptElement(
    child: SiteNode | CompiledContent,
    node: Element,
    placement: MarkupPlacement,
  ): ElementMount {
    if (child instanceof MarkupPlacement) {
      // A hoisted static element: its subtree stays an unmanaged clone.
      const fixed = new ElementMount('', node, null, undefined, this.report, this.settlement, node);
      fixed.attrs = placement.attrs;
      fixed.applied = placement.attrs ?? noAttributes;
      fixed.children = placement.children;
      fixed.kind = Children.Static;
      return fixed;
    }
    const shape = child as SiteNode;
    let mount: ElementMount;
    if (shape[1] === 0) mount = this.holes![this.cursor++] as ElementMount;
    else {
      mount = new ElementMount('', node, null, undefined, this.report, this.settlement, node);
      mount.attrs = placement.attrs;
      mount.applied = placement.attrs ?? noAttributes;
    }
    this.adoptChildren(mount, shape, placement);
    return mount;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const removedByAncestor = detaching;
    if (this.holes?.length || this.slots || this.slot || this.bindings)
      detached(() => this.release());
    if (!removedByAncestor) this.node.remove();
  }
  release() {
    let errors: unknown[] | undefined;
    const holes = this.holes;
    if (holes)
      for (let index = 0; index < holes.length; index++) {
        const hole = holes[index]!;
        if (hole === this) continue;
        try {
          if (hole instanceof ElementMount) hole.release();
          else if (hole instanceof ContentSlot) hole.dispose();
        } catch (error) {
          (errors ??= []).push(error);
        }
      }
    const slots = this.slots;
    if (slots)
      for (let index = 0; index < slots.length; index++) {
        try {
          slots[index]!.dispose();
        } catch (error) {
          (errors ??= []).push(error);
        }
      }
    if (this.slot) {
      try {
        this.slot.dispose();
      } catch (error) {
        (errors ??= []).push(error);
      }
    }
    const bindings = this.bindings;
    if (bindings) {
      // Bindings are released in reverse order of their creation.
      const names = Object.keys(bindings);
      this.bindings = undefined;
      for (let index = names.length - 1; index >= 0; index--) {
        try {
          bindings[names[index]!]?.dispose();
        } catch (error) {
          (errors ??= []).push(error);
        }
      }
    }
    if (errors) reportSafely(this.report, new AggregateError(errors, 'UI work failed'));
  }
  /**
   * Reconcile merged JSX attributes. Each host, event and control owns its cleanup. `fresh`
   * marks a cloned element that has no attributes of its own yet.
   */
  applyAttributes(next: Readonly<Record<string, unknown>>, fresh = false) {
    const element = this.node;
    const previous = this.applied;
    if (previous !== noAttributes)
      for (const name in previous) {
        if (name === 'children' || Object.hasOwn(next, name)) continue;
        const binding = this.bindings?.[name];
        if (binding) {
          binding.dispose();
          delete this.bindings![name];
        }
        if (name !== 'use' && !isEvent(name)) attribute(element, name, undefined);
      }
    // A control's value is constrained by its other attributes (type, min, max, step,
    // multiple), so controls are applied after everything else whatever order the markup uses.
    let controls: string[] | undefined;
    let constrained = false;
    for (const name in next) {
      // Children carried by a spread render as element content.
      if (name === 'children') continue;
      if (name === 'key' || name === 'ref' || name === 'innerHTML')
        throw new Error(
          `Spread attribute ${name} is unsupported. Use collections, DOM hosts, or JSX children.`,
        );
      if (isControl(element, name)) {
        (controls ??= []).push(name);
        continue;
      }
      const value = next[name];
      if (name === 'use' || isEvent(name)) {
        this.bind(name, value, false);
        continue;
      }
      if (fresh || !Object.hasOwn(previous, name) || !Object.is(previous[name], value)) {
        if (controlConstraints.has(name)) constrained = true;
        attribute(element, name, value, fresh);
      }
    }
    if (controls) for (const name of controls) this.bind(name, next[name], constrained);
    this.applied = next;
  }
  private bind(name: string, value: unknown, constrained: boolean) {
    const binding = this.bindings?.[name];
    if (binding) {
      // The browser may have clamped an unchanged value under the previous constraints.
      if (!Object.is(binding.value, value) || constrained) binding.set(value);
      return;
    }
    const bindings = (this.bindings ??= Object.create(null) as Record<string, Binding | undefined>);
    if (isEvent(name)) {
      bindings[name] = new EventBinding(this.node, name, value, this.report, this.settlement);
      return;
    }
    const owned = new Scope<unknown, never>(value, unboundSend, this.report, this.settlement);
    bindings[name] = owned;
    if (name === 'use')
      attach(
        owned,
        this.node,
        () => [owned.value],
        () => owned.value as DomMount | undefined,
      );
    else
      bindControl(
        owned,
        this.node,
        name,
        () => [owned.value],
        () => owned.value,
      );
  }
  /** Element content: plain text, one slot per fixed child, or one slot for a dynamic child. */
  private applyChildren(value: unknown, arity: number, source: BindingLocation | undefined) {
    const node = this.node;
    if (arity >= 0) {
      const items = value as readonly unknown[];
      if (this.kind === Children.Fixed && this.slots!.length === items.length) {
        const slots = this.slots!;
        for (let index = 0; index < items.length; index++) {
          try {
            slots[index]!.set(items[index]);
          } catch (error) {
            reportSafely(this.report, error);
          }
          if (this.disposed) return;
        }
        return;
      }
      // The child count changed at this position: replace the content in one step.
      this.clearChildren();
      const slots: ContentSlot[] = (this.slots = []);
      this.kind = Children.Fixed;
      try {
        for (const item of items) {
          const slot = new ContentSlot(node, null, this.report, this.settlement);
          slots.push(slot);
          slot.set(item);
        }
      } catch (error) {
        this.clearChildren();
        throw error;
      }
      return;
    }
    if (isContent(value) || Array.isArray(value) || this.kind === Children.Single) {
      if (this.kind !== Children.Single) {
        this.clearChildren();
        this.kind = Children.Single;
        this.slot = new ContentSlot(node, null, this.report, this.settlement, source, true);
      }
      this.slot!.set(value);
      return;
    }
    if (value != null && typeof value === 'object')
      throw new Error(foreignContent(value) ? foreignContentMessage : unsupportedContent);
    const next = value == null || typeof value === 'boolean' ? '' : scalar(value);
    if (this.kind === Children.Text) {
      if (this.textNode!.data !== next) this.textNode!.data = next;
      return;
    }
    if (next === '' && this.kind === Children.None) return;
    this.clearChildren();
    if (next === '') return;
    this.textNode = document.createTextNode(next);
    node.appendChild(this.textNode);
    this.kind = Children.Text;
  }
  private clearChildren() {
    const kind = this.kind;
    if (kind === Children.None) return;
    this.kind = Children.None;
    const slots = this.slots;
    const slot = this.slot;
    this.slots = undefined;
    this.slot = undefined;
    this.textNode = undefined;
    if (slots || slot)
      detached(() =>
        runAll(
          slots ? slots.map((item) => () => item.dispose()) : [() => slot!.dispose()],
          this.report,
        ),
      );
    this.node.replaceChildren();
  }
}

type ListValue<A> = {
  readonly rows: Rows<A> | readonly A[];
  readonly render: (item: A, index: number) => JSX.Element;
  /** The values an inline callback captures, recorded by the compiler. */
  readonly captured: readonly unknown[] | undefined;
  readonly indexUsed: boolean;
};
const listDefinition = contentDefinition<ListValue<unknown>>((scope, parent, before) =>
  keyedRows(
    scope,
    parent,
    before,
    () => scope.value.rows,
    // A callback is new on every render; the values it captures say whether it changed.
    () => scope.value.captured ?? [scope.value.render],
    // A render callback that never reads its index is not rerun when rows shift.
    () => scope.value.indexUsed,
    (item, index, fragment) => {
      // The explicit list operation owns callback evaluation and keyed row lifetimes.
      const row = new ListRow(scope, item, index, fragment);
      row.set(scope.value.render(item, index));
      return row;
    },
  ),
);
type Scalar = string | number | bigint | boolean | null | undefined;
/**
 * Render rows with stable identity. Pass `entities(rows)` or a collection's rows, or the array
 * with an inline identity: `list(rows, (row) => row.id, render)`. A plain array of scalars is
 * keyed by value, with repeated values told apart by their occurrence.
 */
export function list<A>(
  rows: Rows<A>,
  render: (item: A, index: number) => JSX.Element,
): JSX.Element;
export function list<A extends Scalar>(
  rows: readonly A[],
  render: (item: A, index: number) => JSX.Element,
): JSX.Element;
export function list<A>(
  rows: readonly A[],
  identity: (item: A, index: number) => Identity,
  render: (item: A, index: number) => JSX.Element,
): JSX.Element;
export function list<A>(
  rows: Rows<A> | readonly A[],
  second: ((item: A, index: number) => JSX.Element) | ((item: A, index: number) => Identity),
  third?: ((item: A, index: number) => JSX.Element) | readonly unknown[],
  fourth?: readonly unknown[] | boolean,
  fifth?: boolean,
): JSX.Element {
  // The compiler appends callback identity, captured values and index usage.
  if (typeof third === 'function')
    return new SlotPlacement(listDefinition, {
      rows: keyed(rows as readonly A[], second as (item: A, index: number) => Identity),
      render: third,
      captured: fourth,
      indexUsed: fifth ?? true,
    });
  return new SlotPlacement(listDefinition, {
    rows,
    render: second as (item: A, index: number) => JSX.Element,
    captured: third,
    indexUsed: typeof fourth === 'boolean' ? fourth : true,
  });
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
  const range = text(
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
  return range;
});

/** Render a declared source in its own subscribed region. No dependencies are inferred. */
export function observe<A>(source: Source<A>, render: (value: A) => JSX.Element): JSX.Element {
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
// While an ancestor removes a whole DOM range, nested content skips its own node removal and
// listener removal: the nodes leave the document together and are released with it.
let detaching = false;
function detached(work: () => void) {
  const outer = detaching;
  detaching = true;
  try {
    work();
  } finally {
    detaching = outer;
  }
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
  // Only detached build fragments carry a recorded context; elements answer for themselves.
  if (parent.nodeType === 11) return fragmentSvg.get(parent) ?? false;
  return (
    parent.nodeType === 1 &&
    (parent as Element).namespaceURI === svgNamespace &&
    (parent as Element).localName !== 'foreignObject'
  );
}
function buildFragment(parent: Node): DocumentFragment {
  const fragment = (parent.ownerDocument ?? document).createDocumentFragment();
  fragmentSvg.set(fragment, svgChildren(parent));
  return fragment;
}

export interface MountOptions {
  readonly onError?: ReportError;
}
export interface Mounted {
  readonly dispose: () => void;
  /** Remove the view and wait for its owned cleanup, including async finalizers. */
  readonly close: () => Effect.Effect<void>;
}
/** A program or any source with a `send`: the view's messages go to it. */
export function mount<M, E>(
  parent: Node,
  definition: View<M, E>,
  source: Source<M> & { readonly send: Send<E> },
  options?: MountOptions,
): Mounted;
export function mount<M>(
  parent: Node,
  definition: View<M, never>,
  source: Source<M>,
  options?: MountOptions,
): Mounted;
/** Fixed input, such as `{}` for a root that takes no props. */
export function mount<M>(
  parent: Node,
  definition: View<M, never>,
  props: M,
  options?: MountOptions,
): Mounted;
export function mount<M, E>(
  parent: Node,
  definition: View<M, E>,
  input: unknown,
  options: MountOptions = {},
): Mounted {
  return mountViewWithSettlement(
    parent,
    definition,
    mountSource(input) as Source<M>,
    { ...options, send: mountSend<E>(input) },
    new Settlement(),
  );
}
/** The dispatcher of a source that accepts messages, such as a program. Internal. */
export const mountSend = <E>(input: unknown): Send<E> =>
  (isSource(input) && (input as { send?: Send<E> }).send) || (unboundSend as Send<E>);

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
    const undelegate = delegationHost(parent);
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
      runAll(
        [unsubscribe, () => detached(() => scope.dispose()), () => remove(start, end), undelegate],
        scope.report,
      );
      throw error;
    }
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      const finish = settlement.begin();
      try {
        runAll(
          [
            unsubscribe,
            () => detached(() => scope.dispose()),
            () => remove(start, end),
            undelegate,
          ],
          scope.report,
        );
      } finally {
        finish();
      }
    };
    return {
      dispose,
      close: () =>
        Effect.suspend(() => {
          dispose();
          return scope.settlement.wait();
        }),
    };
  });
}
const classTokens = new WeakMap<Element, Set<string>>();
// CSS properties whose numbers are not lengths. Every other numeric style value gets `px`.
const unitlessStyles = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'columnCount',
  'columns',
  'flex',
  'flexGrow',
  'flexPositive',
  'flexShrink',
  'flexNegative',
  'flexOrder',
  'gridArea',
  'gridRow',
  'gridRowEnd',
  'gridRowSpan',
  'gridRowStart',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnSpan',
  'gridColumnStart',
  'fontWeight',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
  'fillOpacity',
  'floodOpacity',
  'stopOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
]);
function styleValue(property: string, value: unknown): string {
  if (typeof value === 'number' && value !== 0 && !property.startsWith('--')) {
    const name = property.includes('-')
      ? property.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())
      : property;
    if (!unitlessStyles.has(name)) return `${value}px`;
  }
  return scalar(value);
}
let booleanAttributes: Set<string> | undefined;
const styleProperties = new WeakMap<Element, Set<string>>();
/** Cloning copies CSS declarations but not the reconciliation metadata of the template. */
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
/** `fresh` marks a cloned element with no attributes yet: nothing to compare or remove. */
export function attribute(element: Element, name: string, value: unknown, fresh = false) {
  if (fresh && value == null) return;
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
          styleValue(property, value),
        ] as const,
    );
    const next = new Set(entries.map(([property]) => property));
    // An untracked element may carry the inline style of the template it was cloned from.
    const current =
      styleProperties.get(element) ?? (element.hasAttribute('style') ? Array.from(style) : []);
    for (const property of current) if (!next.has(property)) style.removeProperty(property);
    for (const [property, value] of entries) style.setProperty(property, value);
    styleProperties.set(element, next);
  } else if (name === 'value' && 'value' in element && element.localName !== 'option') {
    // An <option> gets its value as an attribute: before its text child exists its value property reads "", so a
    // property write of "" would be skipped and the option would later fall back to its text.
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
    if (fresh || element.getAttribute(key) !== next) element.setAttribute(key, next);
  }
  if (key === 'class' && !fresh)
    for (const token of classTokens.get(element) ?? []) element.classList.add(token);
  if (name === 'style' && (value == null || typeof value !== 'object')) {
    if (value == null) styleProperties.delete(element);
    else if ('style' in element)
      styleProperties.set(element, new Set(Array.from(element.style as CSSStyleDeclaration)));
  }
}

const controlConstraints = new Set([
  'type',
  'min',
  'max',
  'step',
  'multiple',
  'maxlength',
  'maxLength',
]);
const eventNames = new Map<string, boolean>();
const isEvent = (name: string) => {
  let event = eventNames.get(name);
  if (event === undefined)
    eventNames.set(name, (event = /^on[A-Z]/u.test(name) || name.startsWith('on:')));
  return event;
};
/** A controlled element's edit tracking, reached from the mount root's capture listeners. */
interface ControlState {
  handled(type: string, event: Event): void;
  edit(event: Event): void;
  start(): void;
  end(): void;
}
const controlStates = new WeakMap<EventTarget, Set<ControlState>>();
const controlEvents = ['input', 'compositionstart', 'compositionend'] as const;
// Nested roots see the same event; its control state is updated once.
const controlDispatched = new WeakSet<Event>();
function dispatchControl(event: Event) {
  if (controlDispatched.has(event)) return;
  controlDispatched.add(event);
  const states = event.target && controlStates.get(event.target);
  if (!states) return;
  for (const state of states) {
    if (event.type === 'input') state.edit(event);
    else if (event.type === 'compositionstart') state.start();
    else state.end();
  }
}

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
  // Changed constraints republish an equal value; see bindAttributes.
  if (!select) scope.jobs.push(apply);
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
      // An edit nobody handled arrived after this restore was scheduled: it is an
      // unfinished draft, and writing the model value now would erase it.
      handledClick = false;
      if (edited) {
        edited = false;
        return;
      }
      if (!scope.disposed) {
        try {
          apply();
        } catch (error) {
          reportSafely(scope.report, error);
        }
      }
    }, 0);
  };
  // The edit a pending restore answers, and whether a later unhandled edit superseded it.
  let handledEdit: Event | undefined;
  let handledClick = false;
  let edited = false;
  const edit = (event: Event) => {
    // A checkbox reports its handled click as an input event next; that is the same edit.
    if (handledClick) {
      handledClick = false;
      handledEdit = event;
      return;
    }
    if (pending !== undefined && handledEdit !== event) edited = true;
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
  const handled = (type: string, event: Event) => {
    // Clicking a text control must not commit its unfinished blur draft.
    if (type === 'click' && name !== 'checked') return;
    if (type === 'input' || type === 'change') {
      // This edit was handled, so the model value is its answer.
      handledEdit = event;
      edited = false;
    } else if (type === 'click') handledClick = true;
    restore();
  };
  const state: ControlState = { handled, edit, start, end };
  let states = controlStates.get(element);
  if (!states) controlStates.set(element, (states = new Set()));
  states.add(state);
  scope.cleanups.push(() => {
    clearTimeout(pending);
    states.delete(state);
    if (!states.size) controlStates.delete(element);
  });
}

const unsupportedContent =
  'Unsupported JSX content. Use compiled views or slots for markup, collections for entities, and an owned DOM host for native nodes.';
const unset = Symbol('unset');
/**
 * One position that renders any JSX value. Text is a single text node and mounted content is
 * its own nodes; no placeholder or marker is added. A position that is currently empty keeps
 * an empty text node as its anchor, unless it is the only content of its element.
 */
class ContentSlot implements ContentRange {
  disposed = false;
  private node: Text | undefined;
  private content: { definition: ContentDefinition; mounted: MountedContent } | undefined;
  private last: unknown = unset;
  constructor(
    private parent: Node | undefined,
    private before: Node | null,
    private readonly report: ReportError,
    private readonly settlement: Settlement,
    private readonly source?: BindingLocation,
    /** The slot is the whole content of `parent`, so an empty slot needs no anchor. */
    private readonly container = false,
  ) {}
  /** A slot whose position is an existing empty text node. */
  static anchored(
    node: Text,
    report: ReportError,
    settlement: Settlement,
    source?: BindingLocation,
  ): ContentSlot {
    const slot = new ContentSlot(undefined, null, report, settlement, source);
    slot.node = node;
    return slot;
  }
  /** A slot already showing `value` as the text node `node`. */
  static ofText(
    node: Text,
    value: unknown,
    report: ReportError,
    settlement: Settlement,
    source?: BindingLocation,
  ): ContentSlot {
    const slot = ContentSlot.anchored(node, report, settlement, source);
    slot.last = value;
    return slot;
  }
  /** A slot already showing `placement` through `mounted`; `container` is its sole parent. */
  static holding(
    container: Node | undefined,
    placement: ContentValue,
    mounted: MountedContent,
    report: ReportError,
    settlement: Settlement,
  ): ContentSlot {
    const slot = new ContentSlot(container, null, report, settlement, undefined, !!container);
    slot.content = { definition: placement.definition, mounted };
    slot.last = placement;
    return slot;
  }
  get start(): Node {
    return this.content ? this.content.mounted.start : this.node!;
  }
  get end(): Node {
    return this.content ? this.content.mounted.end : this.node!;
  }
  set(value: unknown) {
    if (this.disposed || Object.is(this.last, value)) return;
    try {
      this.apply(value);
      this.last = value;
    } catch (error) {
      // The next publication renders this position again, even with an equal value.
      this.last = unset;
      throw locate(error, this.source);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.content?.mounted.dispose();
  }
  /** Dispose the slot and take its nodes out of the document. */
  discard() {
    const first = this.content ? this.content.mounted.start : this.node;
    const last = this.content ? this.content.mounted.end : this.node;
    detached(() => this.dispose());
    if (first && last) remove(first, last);
  }
  private apply(input: unknown) {
    let value = input;
    if (Array.isArray(value)) {
      validateContent(value);
      value = new SlotPlacement(arrayContent, value);
    }
    if (isContent(value)) {
      const previous = this.content;
      if (previous?.definition === value.definition) {
        previous.mounted.set(value.value);
        return;
      }
      let parent: Node;
      let before: Node | null;
      if (previous) {
        const first = previous.mounted.start;
        const last = previous.mounted.end;
        parent = last.parentNode!;
        before = last.nextSibling;
        this.content = undefined;
        previous.mounted.dispose();
        // While an ancestor is detaching, content leaves its nodes for the ancestor to remove.
        if (first.parentNode === parent) remove(first, last);
        if (this.disposed) return;
      } else if (this.node) {
        parent = this.node.parentNode!;
        before = this.node;
      } else {
        parent = this.parent!;
        before = this.before;
      }
      let mounted: MountedContent;
      try {
        mounted = value.definition.mount(
          parent,
          before,
          value.value,
          locatedReport(this.report, this.source),
          this.settlement,
        );
      } catch (error) {
        // Keep an anchor so this position can render again.
        if (!this.node && !this.container) {
          this.node = document.createTextNode('');
          parent.insertBefore(this.node, before);
          this.parent = undefined;
        }
        throw error;
      }
      if (this.disposed) {
        mounted.dispose();
        return;
      }
      this.content = { definition: value.definition, mounted };
      if (this.node) {
        this.node.remove();
        this.node = undefined;
      }
      if (!this.container) this.parent = undefined;
      return;
    }
    if (value != null && typeof value === 'object')
      throw new Error(foreignContent(value) ? foreignContentMessage : unsupportedContent);
    const next = value == null || typeof value === 'boolean' ? '' : scalar(value);
    const previous = this.content;
    if (previous) {
      const first = previous.mounted.start;
      const last = previous.mounted.end;
      const parent = last.parentNode!;
      this.content = undefined;
      if (!(this.container && next === '')) {
        this.node = document.createTextNode(next);
        parent.insertBefore(this.node, last.nextSibling);
      }
      previous.mounted.dispose();
      if (first.parentNode === parent) remove(first, last);
      return;
    }
    if (this.node) {
      if (this.node.data !== next) this.node.data = next;
      return;
    }
    if (this.container && next === '') return;
    this.node = document.createTextNode(next);
    this.parent!.insertBefore(this.node, this.before);
    if (!this.container) this.parent = undefined;
  }
}
/** One row of `list`: the content slot rendered by the list's current callback. */
class ListRow<A> extends ContentSlot implements Row<A> {
  readonly range: ContentRange = this;
  constructor(
    private readonly owner: Scope<ListValue<A>, never>,
    public item: A,
    public index: number,
    fragment: DocumentFragment,
  ) {
    super(fragment, null, owner.report, owner.settlement);
  }
  update(item: A, index: number) {
    this.item = item;
    this.index = index;
    try {
      this.set(this.owner.value.render(item, index));
    } catch (error) {
      reportSafely(this.owner.report, error);
    }
  }
}

/** Render a JSX value at one position and keep it current; returns the position's range. */
export function text<M, E>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  dependencies: Dependencies,
  read: () => JSX.Element,
  source?: BindingLocation,
): ContentRange {
  const slot = new ContentSlot(parent, before, scope.report, scope.settlement, source);
  scope.cleanups.push(() => slot.dispose());
  scope.watch(dependencies, () => slot.set(read()), source);
  return slot;
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
      foreignContent(value)
        ? foreignContentMessage
        : 'Unsupported JSX content. Use an owned DOM host for native nodes and compiled views for objects.',
    );
  }
}

const arrayContent: ContentDefinition = {
  mount: (parent, before, value, report, settlement) =>
    mountArray(parent, before, value as readonly JSX.Element[], report, settlement),
};

/** Runtime content arrays are positional; domain lists retain the explicit collection contract. */
function mountArray(
  parent: Node,
  before: Node | null,
  initial: readonly JSX.Element[],
  report: ReportError,
  settlement: Settlement,
): MountedContent {
  // An empty array still needs a position; one marker ends the array's range.
  const end = document.createComment('');
  parent.insertBefore(end, before);
  const cells: ContentSlot[] = [];
  let disposed = false;
  const set = (input: unknown) => {
    if (disposed) return;
    const values = input as readonly JSX.Element[];
    while (cells.length > values.length) {
      cells.pop()!.discard();
      if (disposed) return;
    }
    // New cells are built detached: their setup may remove this array before they are placed.
    let fragment: DocumentFragment | undefined;
    try {
      for (let index = 0; index < values.length; index++) {
        const cell = cells[index];
        if (cell) {
          try {
            cell.set(values[index]);
          } catch (error) {
            reportSafely(report, error);
          }
          if (disposed) return;
          continue;
        }
        fragment ??= buildFragment(end.parentNode ?? parent);
        const created = new ContentSlot(fragment, null, report, settlement);
        try {
          created.set(values[index]);
        } catch (error) {
          created.discard();
          throw error;
        }
        if (disposed) {
          created.discard();
          return;
        }
        cells.push(created);
      }
    } finally {
      if (fragment?.firstChild && !disposed && end.parentNode)
        end.parentNode.insertBefore(fragment, end);
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const removedByAncestor = detaching;
    for (const cell of cells.splice(0)) cell.discard();
    if (!removedByAncestor) end.remove();
  };
  try {
    set(initial);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    get start() {
      return cells.length ? cells[0]!.start : end;
    },
    end,
    set,
    dispose,
  };
}

const restoringEvents = new Set(['input', 'change', 'blur', 'focusout', 'click']);
/** The DOM event type and phase an event attribute names. */
function eventTarget(name: string): readonly [type: string, capture: boolean] {
  // `on:exactName` listens for a custom event with that exact name and case.
  const custom = name.startsWith('on:');
  const capture =
    !custom &&
    name.endsWith('Capture') &&
    name !== 'onGotPointerCapture' &&
    name !== 'onLostPointerCapture';
  const nativeName = name.slice(custom ? 3 : 2, capture ? -7 : undefined);
  return [
    custom
      ? nativeName
      : nativeName === 'Begin' || nativeName === 'End' || nativeName === 'Repeat'
        ? `${nativeName.toLowerCase()}Event`
        : nativeName.toLowerCase(),
    capture,
  ];
}
const eventTargets = new Map<string, readonly [string, boolean]>();

// Event delegation. Handlers for these bubbling events are stored on their elements and
// invoked by one listener per type on each mount root and portal host, in bubble order.
// Roots are the mount containers rather than the document, so a handler that stops
// propagation still shields listeners on the document and window. Capturing, custom and
// non-bubbling events keep their own listeners, and so do touchstart and touchmove: a
// container listener that may cancel them would stop the browser scrolling the whole view
// without waiting for script.
const delegatedEvents = new Set([
  'beforeinput',
  'click',
  'dblclick',
  'contextmenu',
  'focusin',
  'focusout',
  'input',
  'change',
  'keydown',
  'keyup',
  'mousedown',
  'mousemove',
  'mouseout',
  'mouseover',
  'mouseup',
  'pointerdown',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
  'touchend',
]);
// A disabled control receives no clicks or presses of its own; a press on its content still
// bubbles through it. Movement and focus events reach disabled controls as usual.
const disabledEvents = new Set(['click', 'dblclick', 'mousedown', 'mouseup']);
type Delegating = Node & { disabled?: boolean };
const delegatedHandlers = (node: Node) =>
  node as unknown as Record<string, EventBinding | undefined>;
const delegateKeys = new Map<string, string>();
const delegateKey = (type: string) => {
  let key = delegateKeys.get(type);
  if (key === undefined) delegateKeys.set(type, (key = `$ew:${type}`));
  return key;
};
const delegatedTypes = new Set<string>();
const delegationHosts = new Map<Node, number>();
// A root nested inside another root has already run the handlers below it.
const delegatedThrough = new WeakMap<Event, Node>();
function dispatchDelegated(event: Event) {
  if (!event.bubbles) return;
  const host = event.currentTarget as Node;
  const key = delegateKey(event.type);
  const reached = delegatedThrough.get(event);
  const path = event.composedPath();
  const start = reached ? path.indexOf(reached) + 1 : 0;
  const end = path.indexOf(host);
  delegatedThrough.set(event, host);
  const origin = path[0];
  const skipDisabled = disabledEvents.has(event.type);
  let current: Node = host;
  // Handlers see the element they are written on, in the phase its own listener would see.
  Object.defineProperty(event, 'currentTarget', { configurable: true, get: () => current });
  Object.defineProperty(event, 'eventPhase', {
    configurable: true,
    get: () => (current === origin ? 2 : 3),
  });
  try {
    for (let index = start; index <= end; index++) {
      const node = path[index] as Delegating;
      const binding = delegatedHandlers(node)[key];
      if (binding && !(skipDisabled && node.disabled)) {
        current = node;
        binding.handleEvent(event);
        if (event.cancelBubble) break;
      }
    }
  } finally {
    delete (event as { currentTarget?: unknown }).currentTarget;
    delete (event as { eventPhase?: unknown }).eventPhase;
  }
}
const armedKey = (type: string) => `$ew:armed:${type}`;
/**
 * A delegated type dispatched without bubbling (a synthetic `new Event('click')`) never
 * reaches the root's bubble listener. Its target gets a one-shot listener while the event is
 * still capturing, so the handler runs at the target in its native order.
 */
const armedFlags = (node: EventTarget) => node as unknown as Record<string, boolean | undefined>;
function armNonBubbling(event: Event) {
  const target = event.target;
  if (!target || !delegatedHandlers(target as Node)[delegateKey(event.type)]) return;
  const armed = armedKey(event.type);
  if (armedFlags(target)[armed]) return;
  armedFlags(target)[armed] = true;
  target.addEventListener(event.type, dispatchNonBubblingOnce, { once: true });
}
function dispatchNonBubblingOnce(event: Event) {
  armedFlags(event.currentTarget!)[armedKey(event.type)] = false;
  dispatchNonBubbling(event);
}
/** Reset progress once per dispatch, including redispatch of the same Event. */
function beginDelegatedDispatch(event: Event) {
  if (!event.bubbles) armNonBubbling(event);
  const path = event.composedPath();
  for (let index = path.length - 1; index >= 0; index--) {
    if (delegationHosts.has(path[index] as Node)) {
      if (event.currentTarget === path[index]) delegatedThrough.delete(event);
      break;
    }
  }
}
/** Non-bubbling events must run at their native target, after capture listeners. */
function dispatchNonBubbling(event: Event) {
  if (event.bubbles) return;
  const target = event.currentTarget as Delegating;
  if (target.disabled && disabledEvents.has(event.type)) return;
  delegatedHandlers(target)[delegateKey(event.type)]?.handleEvent(event);
}
function listenAt(host: Node, type: string) {
  host.addEventListener(type, dispatchDelegated);
  host.addEventListener(type, beginDelegatedDispatch, true);
}
function delegate(type: string) {
  if (delegatedTypes.has(type)) return;
  delegatedTypes.add(type);
  for (const host of delegationHosts.keys()) listenAt(host, type);
}
/** Route delegated events that reach `host` to the handlers of the elements below it. */
function delegationHost(host: Node): () => void {
  const count = delegationHosts.get(host) ?? 0;
  delegationHosts.set(host, count + 1);
  if (!count) {
    for (const type of delegatedTypes) listenAt(host, type);
    for (const type of controlEvents) host.addEventListener(type, dispatchControl, true);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (delegationHosts.get(host) ?? 1) - 1;
    if (remaining > 0) {
      delegationHosts.set(host, remaining);
      return;
    }
    delegationHosts.delete(host);
    for (const type of delegatedTypes) {
      host.removeEventListener(type, dispatchDelegated);
      host.removeEventListener(type, beginDelegatedDispatch, true);
    }
    for (const type of controlEvents) host.removeEventListener(type, dispatchControl, true);
  };
}
/**
 * One element event attribute. The binding is its own listener object, so a handler costs a
 * single allocation; its callback can be replaced without touching the listener, and Effects
 * it returns are owned until the handler or the element goes away.
 */
class EventBinding implements Binding {
  private effects: ReturnType<typeof eventEffects> | undefined;
  private listening = false;
  private disposed = false;
  private readonly type: string;
  private readonly capture: boolean;
  /** Whether the handler is reached through its mount root instead of its own listener. */
  private readonly delegated: boolean;
  constructor(
    private readonly element: Element,
    name: string,
    public value: unknown,
    private readonly report: ReportError,
    private readonly settlement: Settlement,
  ) {
    let target = eventTargets.get(name);
    if (!target) eventTargets.set(name, (target = eventTarget(name)));
    this.type = target[0];
    this.capture = target[1];
    this.delegated = !this.capture && !name.startsWith('on:') && delegatedEvents.has(this.type);
    if (value) this.listen();
  }
  handleEvent(event: Event) {
    if (this.disposed) return;
    try {
      const result = (this.value as ((event: Event) => JSX.EventResult) | undefined)?.(event);
      if (Effect.isEffect(result) && !this.disposed) {
        this.effects ??= eventEffects(this.report, this.settlement);
        this.effects.accept(result);
      }
    } catch (error) {
      reportSafely(this.report, error);
    } finally {
      // Restore only after an application handler commits or rejects an edit.
      // The target also covers handlers delegated to an ancestor.
      if (event.target && restoringEvents.has(this.type)) {
        const states = controlStates.get(event.target);
        if (states) for (const state of states) state.handled(this.type, event);
      }
    }
  }
  set(next: unknown) {
    this.value = next;
    if (next && !this.listening) this.listen();
    else if (!next && this.listening) this.stop();
  }
  dispose() {
    this.disposed = true;
    this.stop();
  }
  private listen() {
    this.listening = true;
    if (this.delegated) {
      delegatedHandlers(this.element)[delegateKey(this.type)] = this;
      delegate(this.type);
    } else this.element.addEventListener(this.type, this, this.capture);
  }
  private stop() {
    if (this.listening) {
      this.listening = false;
      if (this.delegated) delegatedHandlers(this.element)[delegateKey(this.type)] = undefined;
      else if (!detaching) this.element.removeEventListener(this.type, this, this.capture);
    }
    this.effects?.dispose();
    this.effects = undefined;
  }
}
/** Per-attribute state owned by an element: a value, its replacement and its release. */
interface Binding {
  readonly value: unknown;
  set(value: unknown): void;
  dispose(): void;
}

/** One keyed row: what it currently shows, where it is, and how to refresh and release it. */
export interface Row<A> {
  item: A;
  index: number;
  /** The row's nodes; left undefined by a row whose content does not report its range. */
  range: ContentRange | undefined;
  update(item: A, index: number): void;
  dispose(): void;
}
/**
 * Keyed rows before `before`. `create` builds one row into the detached fragment it is given;
 * rows keep their identity, DOM and state across edits, filtering and reordering. Internal:
 * exported for the renderer's own tests.
 */
export function keyedRows<M, E, A>(
  scope: Scope<M, E>,
  parent: Node,
  before: Node | null,
  read: () => Rows<A> | readonly A[],
  outer: Dependencies,
  indexUsed: boolean | (() => boolean),
  create: (item: A, index: number, fragment: DocumentFragment) => Row<A>,
): ContentRange {
  const end = document.createComment('');
  parent.insertBefore(end, before);
  const rows = new Map<A | Identity, Row<A>>();
  let previousList: Rows<A> | readonly A[] | undefined;
  let previousOuter: readonly unknown[] = [];
  let previousIdentities: readonly (A | Identity)[] = [];
  /** The rows in document order, parallel to `previousIdentities`. */
  let ordered: Row<A>[] = [];
  // Plain arrays are keyed by value. Repeated values (tags, lines) are told apart by
  // their occurrence, so the second "a" stays the second "a".
  const repeats = new Map<A, A[]>();
  const valueIdentities = (items: readonly A[]) => {
    const seen = new Map<A, number>();
    const identities = items.map((item) => {
      const count = seen.get(item) ?? 0;
      seen.set(item, count + 1);
      if (!count) return item;
      let tokens = repeats.get(item);
      if (!tokens) repeats.set(item, (tokens = []));
      // An opaque token stands in for the repeated value in the row map.
      return (tokens[count - 1] ??= Symbol('repeated row') as A);
    });
    for (const item of repeats.keys()) if (!seen.has(item)) repeats.delete(item);
    return identities;
  };
  const update = () => {
    if (scope.disposed) return;
    const target = end.parentNode!;
    const next = read();
    const nextOuter = outer();
    const outerChanged = !equal(previousOuter, nextOuter);
    if (next === previousList) {
      if (outerChanged) for (const row of rows.values()) row.update(row.item, row.index);
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
      target.firstChild === ordered[0]?.range!.start &&
      target.lastChild === end
    ) {
      detached(() => {
        for (const row of rows.values()) {
          row.dispose();
          if (scope.disposed) break;
        }
      });
      if (scope.disposed) return;
      target.replaceChildren(end);
      rows.clear();
      previousList = next;
      previousOuter = nextOuter;
      previousIdentities = [];
      ordered = [];
      return;
    }
    // Rows of a collection were validated when the collection produced them.
    const identities: readonly (A | Identity)[] = collection
      ? collection.validated
        ? Array.from(items, (item, index) => collection.identity(item, index))
        : validateIdentities(items, (item, index) => collection.identity(item, index))
      : valueIdentities(items);
    const tracksIndex = typeof indexUsed === 'function' ? indexUsed() : indexUsed;
    // The same rows in the same order: an edit, with nothing to add, remove or move.
    if (identities.length === previousIdentities.length) {
      let same = true;
      for (let index = 0; index < identities.length; index++)
        if (identities[index] !== previousIdentities[index]) {
          same = false;
          break;
        }
      if (same) {
        for (let index = 0; index < items.length; index++) {
          const row = ordered[index]!;
          const item = items[index]!;
          if (outerChanged || row.item !== item) {
            row.update(item, index);
            if (scope.disposed) return;
          }
        }
        previousList = next;
        previousOuter = nextOuter;
        previousIdentities = identities;
        return;
      }
    }
    if (rows.size) {
      const keep = new Set(identities);
      let survivor = false;
      for (const key of rows.keys())
        if (keep.has(key)) {
          survivor = true;
          break;
        }
      if (
        !survivor &&
        target instanceof Element &&
        target.firstChild === ordered[0]!.range!.start &&
        target.lastChild === end
      ) {
        // Every row is replaced and the list fills its container: clear it in one operation.
        detached(() => {
          for (const row of rows.values()) {
            row.dispose();
            if (scope.disposed) break;
          }
        });
        if (scope.disposed) return;
        target.replaceChildren(end);
        rows.clear();
        previousIdentities = [];
        ordered = [];
      } else
        for (const [key, row] of rows) {
          if (keep.has(key)) continue;
          const first = row.range!.start;
          const last = row.range!.end;
          detached(() => row.dispose());
          if (scope.disposed) return;
          remove(first, last);
          rows.delete(key);
        }
    }
    // New rows are built into one detached fragment and enter the document together.
    let fragment: DocumentFragment | undefined;
    const nextOrdered: Row<A>[] = [];
    try {
      for (let index = 0; index < items.length; index++) {
        const key = identities[index]!;
        const row = rows.get(key);
        const item = items[index]!;
        if (!row) {
          fragment ??= buildFragment(target);
          const mark = fragment.lastChild;
          let created: Row<A>;
          try {
            created = create(item, index, fragment);
          } catch (error) {
            while (fragment.lastChild && fragment.lastChild !== mark)
              fragment.removeChild(fragment.lastChild);
            throw error;
          }
          if (scope.disposed) {
            created.dispose();
            return;
          }
          created.range ??= boundRange(fragment, mark);
          rows.set(key, created);
          nextOrdered[index] = created;
        } else if (outerChanged || row.item !== item || (tracksIndex && row.index !== index)) {
          nextOrdered[index] = row;
          row.update(item, index);
          if (scope.disposed) return;
        } else {
          // Positions still change when the current renderer does not read them.
          row.index = index;
          nextOrdered[index] = row;
        }
      }
    } finally {
      if (fragment?.firstChild && !scope.disposed) target.insertBefore(fragment, end);
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
        const first = row.range!.start;
        const last = row.range!.end;
        if (!stationary.has(index) && last.nextSibling !== anchor) {
          const focused =
            document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
          let node: Node | null = first;
          while (node) {
            const following: Node | null = node.nextSibling;
            const move = Reflect.get(target, 'moveBefore');
            if (typeof move === 'function' && target.isConnected && node.isConnected)
              move.call(target, node, anchor);
            else target.insertBefore(node, anchor);
            if (node === last) break;
            node = following;
          }
          if (focused?.isConnected && document.activeElement !== focused)
            focused.focus({ preventScroll: true });
        }
        anchor = first;
      }
    }
    previousList = next;
    previousOuter = nextOuter;
    previousIdentities = identities;
    ordered = nextOrdered;
  };
  scope.jobs.push(update);
  scope.cleanups.push(() => {
    detached(() => {
      for (const row of rows.values()) row.dispose();
    });
    rows.clear();
    ordered = [];
  });
  update();
  return {
    get start() {
      const first = ordered[0];
      return first ? first.range!.start : end;
    },
    end,
  };
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
  const range = definition.build(child, parent, before);
  scope.watch(dependencies, () => {
    const next = model();
    if (!Object.is(child.value, next)) child.set(next);
  });
  return range;
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
    const previous = active;
    if (previous) detached(() => previous.dispose());
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
      if (previous) detached(() => previous.dispose());
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
  // Portal content is outside its mount root, so its host routes delegated events itself.
  let undelegate: (() => void) | undefined;
  scope.cleanups.push(() => {
    const previous = child;
    if (previous) detached(() => previous.dispose());
    host?.remove();
    undelegate?.();
  });
  const update = () => {
    const target = mount() ?? document.body;
    const svg = svgChildren(target);
    if (!host || (host.namespaceURI === svgNamespace) !== svg) {
      const previous = child;
      if (previous) detached(() => previous.dispose());
      host?.remove();
      undelegate?.();
      undelegate = undefined;
      if (scope.disposed) return;
      host = svg
        ? target.ownerDocument.createElementNS(svgNamespace, 'g')
        : target.ownerDocument.createElement('div');
      host.style.display = 'contents';
      undelegate = delegationHost(host);
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
