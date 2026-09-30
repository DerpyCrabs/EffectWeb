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
export {
  Portal,
  domBinding,
  domMount,
  domHandle,
  type DomMount,
  type DomHandle,
  type PortalProps,
} from './mount.js';
export { AsyncContent, type AsyncContentProps } from './AsyncContent.js';
export { available, resourceError } from './result.js';
export { errorBoundary } from './boundary.js';

// Row identity for list(...)
export { collection, entities, sequence, type Rows, type Collection } from './collection.js';

// Component state
export { component, localComponent, controllerView, type ViewController } from './component.js';
export {
  defineTasks,
  ownedTasks,
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

// Owning resources in controllers without a model
export { lifetime } from './session.js';

// Form events
export { submit } from './form.js';
