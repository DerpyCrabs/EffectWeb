/** Opt-in synchronous attribution. No models, DOM nodes or callback arguments are retained. */
declare const __EFFECTWEB_PROFILE_ENABLED__: boolean | undefined;
export const profiling =
  typeof __EFFECTWEB_PROFILE_ENABLED__ === 'boolean' ? __EFFECTWEB_PROFILE_ENABLED__ : true;
export interface ProfileLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly expression: string;
}
export type ProfileKind =
  | 'view'
  | 'projection'
  | 'publication'
  | 'binding'
  | 'measurement'
  | 'action';
export interface ProfileEntry {
  id: number;
  kind: ProfileKind;
  name: string;
  location?: ProfileLocation;
  calls: number;
  errors: number;
  unchanged: number;
  inclusiveMs: number;
  selfMs: number;
  domReads: number;
  domWrites: number;
  acquired: number;
  released: number;
}
export interface ProfileEvent {
  id: number;
  entry: number;
  parent?: number;
  cause: string;
  durationMs: number;
  complete: boolean;
}
export interface ProfileReport {
  schemaVersion: 1;
  active: boolean;
  elapsedMs: number;
  droppedEntries: number;
  droppedEvents: number;
  unattributedDomReads: number;
  unattributedDomWrites: number;
  entries: ProfileEntry[];
  events: ProfileEvent[];
  limitations: readonly string[];
}
export interface ProfileOptions {
  /** Maximum distinct sites, default 500. */
  maxEntries?: number;
  /** First N synchronous spans, default 2000; aggregates continue after the limit. */
  maxEvents?: number;
  /** Intrusive browser DOM API counters. Calls are not mutations or forced layouts. */
  dom?: boolean;
}
const locations = new WeakMap<object, ProfileLocation>();
/** Compiler metadata; exposed through the compiler runtime, not the authoring surface. */
export function profileFunction<F extends object>(value: F, location: ProfileLocation): F {
  if (profiling && !locations.has(value)) locations.set(value, location);
  return value;
}
interface Frame {
  event: number;
  entry: ProfileEntry;
  childMs: number;
}
interface Session {
  start: number;
  end?: number;
  maxEntries: number;
  maxEvents: number;
  entries: Map<string, ProfileEntry>;
  events: ProfileEvent[];
  sequence: number;
  droppedEntries: number;
  droppedEvents: number;
  reads: number;
  writes: number;
  frame?: Frame | undefined;
  restore: Array<() => void>;
}
let session: Session | undefined;
const now = () => performance.now();
function limit(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000)
    throw new RangeError('Profile limits must be integers between 0 and 100000');
  return value;
}
function entryFor(s: Session, target: object | string, kind: ProfileKind) {
  const location = typeof target === 'string' ? undefined : locations.get(target);
  const name =
    typeof target === 'string'
      ? target
      : typeof target === 'function'
        ? target.name || '(anonymous)'
        : '(source)';
  const key = JSON.stringify([kind, location ?? name]);
  let entry = s.entries.get(key);
  if (!entry && s.entries.size < s.maxEntries) {
    entry = {
      id: s.entries.size + 1,
      kind,
      name,
      ...(location ? { location } : {}),
      calls: 0,
      errors: 0,
      unchanged: 0,
      inclusiveMs: 0,
      selfMs: 0,
      domReads: 0,
      domWrites: 0,
      acquired: 0,
      released: 0,
    };
    s.entries.set(key, entry);
  }
  if (!entry) s.droppedEntries++;
  return entry;
}
/** Async work deliberately does not inherit this stack. */
export function profileCall<A>(
  target: object | string,
  kind: ProfileKind,
  cause: string,
  run: () => A,
): A {
  const s = session;
  if (!s || s.end !== undefined) return run();
  const entry = entryFor(s, target, kind);
  if (!entry) return run();
  const parent = s.frame,
    frame = { event: ++s.sequence, entry, childMs: 0 };
  s.frame = frame;
  entry.calls++;
  const start = now();
  const event: ProfileEvent | undefined =
    s.events.length < s.maxEvents
      ? {
          id: frame.event,
          entry: entry.id,
          ...(parent ? { parent: parent.event } : {}),
          cause,
          durationMs: 0,
          complete: false,
        }
      : undefined;
  if (event) s.events.push(event);
  else s.droppedEvents++;
  try {
    return run();
  } catch (error) {
    entry.errors++;
    throw error;
  } finally {
    const duration = Math.max(0, (s.end ?? now()) - start);
    entry.inclusiveMs += duration;
    entry.selfMs += Math.max(0, duration - frame.childMs);
    if (parent) parent.childMs += duration;
    if (event) {
      event.durationMs = duration;
      event.complete = s.end === undefined;
    }
    s.frame = parent;
  }
}
export function profileUnchanged() {
  if (session?.end === undefined && session?.frame) session.frame.entry.unchanged++;
}
export function profileResource(target: object): () => void {
  const s = session;
  const entry = s && s.end === undefined ? entryFor(s, target, 'binding') : undefined;
  if (entry) entry.acquired++;
  let released = false;
  return () => {
    if (!released && entry && s?.end === undefined) entry.released++;
    released = true;
  };
}
function countDom(write: boolean) {
  const s = session;
  if (!s || s.end !== undefined) return;
  if (s.frame) {
    if (write) s.frame.entry.domWrites++;
    else s.frame.entry.domReads++;
  } else if (write) s.writes++;
  else s.reads++;
}
function instrumentDom(s: Session) {
  if (typeof window === 'undefined') return;
  const patch = (prototype: object, key: string, write: boolean, getter = false) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor?.configurable) return;
    // oxlint-disable-next-line typescript/unbound-method -- Invoked with its original receiver through Reflect.apply.
    const method: unknown = getter ? descriptor.get : descriptor.value;
    if (typeof method !== 'function') return;
    const wrapper = function (this: unknown, ...args: unknown[]) {
      countDom(write);
      return Reflect.apply(method as (...values: unknown[]) => unknown, this, args);
    };
    Object.defineProperty(prototype, key, {
      ...descriptor,
      ...(getter ? { get: wrapper } : { value: wrapper }),
    });
    s.restore.push(() => {
      const current = Object.getOwnPropertyDescriptor(prototype, key);
      // oxlint-disable-next-line typescript/unbound-method -- Identity comparison, never an unbound call.
      if ((getter ? current?.get : current?.value) === wrapper)
        Object.defineProperty(prototype, key, descriptor);
    });
  };
  for (const key of ['getBoundingClientRect', 'getClientRects', 'getAttribute'])
    patch(window.Element.prototype, key, false);
  for (const key of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'])
    patch(window.Element.prototype, key, false, true);
  for (const key of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft'])
    patch(window.HTMLElement.prototype, key, false, true);
  for (const key of ['setAttribute', 'removeAttribute', 'toggleAttribute'])
    patch(window.Element.prototype, key, true);
  for (const key of ['appendChild', 'insertBefore', 'removeChild', 'replaceChild'])
    patch(window.Node.prototype, key, true);
  for (const key of ['setProperty', 'removeProperty'])
    patch(window.CSSStyleDeclaration.prototype, key, true);
  patch(window.CSSStyleDeclaration.prototype, 'cssText', false, true);
}
/** Overlapping captures are rejected rather than silently replaced. */
export function startProfile(options: ProfileOptions = {}): void {
  if (!profiling)
    throw new Error(
      'EffectWeb profiling is disabled; enable effectweb({ profile: true }) in a development server',
    );
  if (session && session.end === undefined)
    throw new Error('An EffectWeb profile is already active; stop it first');
  const maxEntries = limit(options.maxEntries, 500),
    maxEvents = limit(options.maxEvents, 2000);
  session = {
    start: now(),
    maxEntries,
    maxEvents,
    entries: new Map(),
    events: [],
    sequence: 0,
    droppedEntries: 0,
    droppedEvents: 0,
    reads: 0,
    writes: 0,
    restore: [],
  };
  if (options.dom) instrumentDom(session);
}
/** JSON-safe detached report sorted by synchronous self time. */
export function profileSnapshot(): ProfileReport {
  const s = session;
  return {
    schemaVersion: 1,
    active: !!s && s.end === undefined,
    elapsedMs: s ? (s.end ?? now()) - s.start : 0,
    droppedEntries: s?.droppedEntries ?? 0,
    droppedEvents: s?.droppedEvents ?? 0,
    unattributedDomReads: s?.reads ?? 0,
    unattributedDomWrites: s?.writes ?? 0,
    entries: s
      ? [...s.entries.values()]
          .map((e) => ({ ...e, ...(e.location ? { location: { ...e.location } } : {}) }))
          .sort((a, b) => b.selfMs - a.selfMs || a.id - b.id)
      : [],
    events: s?.events.map((e) => ({ ...e })) ?? [],
    limitations: [
      'Synchronous attribution only; async callbacks start new causes.',
      'DOM counters cover selected API calls, not actual mutations, layout, paint or GPU time.',
      'Unlocated anonymous sites are grouped; enable compiler development metadata for precise sites.',
      'Resources count acquisitions during this capture, not a heap or leak census.',
      'Instrumentation affects timing; validate production performance separately.',
    ],
  };
}
export function stopProfile(): ProfileReport {
  const s = session;
  if (s && s.end === undefined) {
    s.end = now();
    for (const restore of s.restore.splice(0).reverse()) restore();
  }
  return profileSnapshot();
}
/** Browser automation surface installed only by the opt-in development plugin. */
export function installProfiler() {
  const api = {
    start: startProfile,
    snapshot: profileSnapshot,
    stop: stopProfile,
    run: <A>(name: string, work: () => A): A =>
      profileCall(name, 'action', 'explicit action', work),
  };
  Object.defineProperty(globalThis, '__EFFECTWEB_PROFILE__', { configurable: true, value: api });
  return api;
}

/** Field names only; do not invoke property getters or retain either input. */
export function profileInputChange(previous: unknown, next: unknown): string {
  if (Object.is(previous, next)) return 'same input identity';
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object')
    return 'input identity changed';
  try {
    if (
      Object.getPrototypeOf(previous) !== Object.prototype ||
      Object.getPrototypeOf(next) !== Object.prototype
    )
      return 'input identity changed';
    const changed: string[] = [];
    let scanned = 0;
    for (const key in next) {
      if (++scanned > 64) return `changed fields (scan capped): ${changed.join(', ')}`;
      const a = Object.getOwnPropertyDescriptor(previous, key),
        b = Object.getOwnPropertyDescriptor(next, key);
      if (!a || !b || !Object.is(a.value, b.value) || a.get !== b.get || a.set !== b.set)
        changed.push(key.slice(0, 80));
      if (changed.length === 8) return `changed fields (capped): ${changed.join(', ')}`;
    }
    for (const key in previous) {
      if (++scanned > 128) break;
      if (!Object.hasOwn(next, key)) changed.push(key.slice(0, 80));
      if (changed.length === 8) break;
    }
    return changed.length
      ? `changed fields: ${changed.join(', ')}`
      : 'input identity changed; inspected fields equal';
  } catch {
    return 'input identity changed; fields unavailable';
  }
}

const inputCauses = new WeakMap<object, string>();
export function profileSetInput(target: object, previous: unknown, next: unknown) {
  if (session && session.end === undefined)
    inputCauses.set(target, profileInputChange(previous, next));
}
export function profileCause(target: object): string {
  return inputCauses.get(target) ?? 'input identity changed';
}
