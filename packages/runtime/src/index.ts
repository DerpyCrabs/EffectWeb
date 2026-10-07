// The recommended authoring surface. See docs/choosing-apis.md for which API to use when.
// Adapter-building and specialized APIs live in `effectweb/advanced`;
// test helpers live in `effectweb/testing`.

// Immutable data
export type { Snapshot, SnapshotOpaque, snapshotOpaque } from './snapshot.js';

// Views and rendering
export {
  view,
  list,
  observe,
  ViewBinding,
  mount,
  type View,
  type Mounted,
  type Slot,
  type CompiledContent,
} from './dom.js';
export { makeMount } from './render.js';
export type { JSX } from './jsx.js';
export {
  Portal,
  domBinding,
  domMount,
  domHandle,
  type DomMount,
  type DomHandle,
  type PortalProps,
} from './mount.js';
export { available, resourceError } from './result.js';
export { errorBoundary } from './boundary.js';

// Row identity for list(...)
export { collection, entities, sequence, type Rows, type Collection } from './collection.js';

// Component state
export {
  component,
  controllerView,
  ownerOf,
  type ComponentOwner,
  type FieldsPatch,
  type ViewController,
  type ControllerModel,
} from './component.js';

// Controllers and programs
export {
  modelOwner,
  type ModelOwner,
  type DisposableOwner,
  type OwnedRun,
  type Ownable,
  type RunPolicy,
} from './owner.js';
export {
  program,
  type RunKey,
  type Command,
  type Program,
  type RunningProgram,
  type Send,
  type Transition,
} from './program.js';

// Sources
export { mapSource, clock, type Source } from './source.js';

// Form events
export { submit } from './form.js';
