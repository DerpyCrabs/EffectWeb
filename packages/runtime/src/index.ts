// The recommended authoring surface. See AUTHORING.md for which API to use when.
// Adapter-building and specialized APIs live in `effectweb/advanced`;
// test helpers live in `effectweb/testing`.

// Immutable data
export type { Snapshot, SnapshotOpaque, snapshotOpaque } from './snapshot.js';

// Views and rendering
export {
  view,
  list,
  observe,
  slot,
  ViewBinding,
  mountView,
  type View,
  type Mounted,
  type Slot,
  type CompiledContent,
} from './dom.js';
export { mount } from './render.js';
export type { JSX } from './jsx.js';
export { Portal, domBinding, domMount, type DomMount, type PortalProps } from './mount.js';
export { AsyncContent, type AsyncContentProps } from './AsyncContent.js';
export { errorBoundary } from './boundary.js';

// Row identity for list(...)
export { collection, entities, sequence, type Rows, type Collection } from './collection.js';

// Component state
export { component, localComponent } from './component.js';
export {
  defineTasks,
  type TaskDefinition,
  type TasksModel,
  type TasksMessage,
  type TaskResults,
} from './tasks.js';

// Controllers and programs
export {
  modelOwner,
  makeModelOwner,
  type ModelOwner,
  type DisposableOwner,
  type TaskPolicy,
} from './owner.js';
export {
  program,
  makeProgram,
  actionCommand,
  effectCommand,
  commandSlot,
  commandSlots,
  type CommandSlot,
  type Command,
  type Program,
  type RunningProgram,
  type Send,
  type Transition,
} from './program.js';
export { effectEvent } from './effectEvent.js';
export { uiRuntime, makeUiRuntime, type UiRuntime } from './runtime.js';

// Sources
export { mapSource, clock, type Source } from './source.js';

// Async data
export {
  query,
  queryGroup,
  type Query,
  type QueryKey,
  type QueryGroup,
  type QueryEncoding,
} from './query.js';
export { makeQueryCache, type QueryCache, type QueryCacheOptions } from './cache.js';
export { observeQuery, lifetime, type QueryResource } from './session.js';
export {
  available,
  resourceComponent,
  resourceError,
  type ResourceMessage,
  type ResourceModel,
} from './resource.js';
export { fromPromise } from './load.js';
export {
  infiniteQuery,
  infiniteResource,
  type InfiniteData,
  type InfiniteQuery,
  type InfiniteResource,
} from './infinite-query.js';

// Form events
export { submit } from './form.js';
