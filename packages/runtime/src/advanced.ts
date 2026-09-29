// Specialized APIs for adapter authors, large controllers, and performance tuning.
// Application code should normally use the root `effectweb` exports; see AUTHORING.md.

// Adapter building blocks
export { projectionSource, fromStream, fromAtom, fromSubscriptionRef } from './source.js';
export { shareValue, type ShareFields } from './share.js';
export { makeDomMount, makeDomBinding } from './mount.js';
export { makeEffectHandler } from './effectEvent.js';

// Explicit rendering optimizations
export { memoView, listView } from './dom.js';
export { lazyView, type LazyViewOptions } from './lazy.js';

// Program composition
export { programView } from './component.js';
export { mapTransition, mapCommand } from './program.js';
export { patchModel } from './state.js';
export {
  pages,
  type PagesMessage,
  type PagesRequest,
  type PagesModel,
  type PagesProgram,
  type Pagination,
} from './pages.js';
export type { UiPage } from './load.js';
export { defineActions, type ActionMessage } from './actions.js';

// Sessions, projections and caches for large controllers
export { projectionCache, sessionGroup } from './session.js';
export { scopedQueryCache } from './cache.js';

// Draft fields with owned validation
export {
  defineField,
  type FieldResult,
  type FieldState,
  type FieldMessage,
  type FieldController,
} from './form.js';

// Development diagnostics
export {
  observeBindings,
  inspectBindings,
  mountBindingInspector,
  observePrograms,
  type BindingInspector,
  type BindingInspection,
  type BindingUpdate,
  type ProgramUpdate,
} from './diagnostics.js';
