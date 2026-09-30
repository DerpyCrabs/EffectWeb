// Specialized APIs for adapter authors, large controllers, and performance tuning.
// Application code should normally use the root `effectweb` exports; see AUTHORING.md.

// Adapter building blocks
export { projectionSource } from './source.js';
export { protectSnapshot } from './snapshot.js';
export { shareValue, type ShareFields } from './share.js';

// Explicit rendering optimizations
export { memoView, listView } from './dom.js';
export { lazyView, type LazyViewOptions } from './lazy.js';

// Program composition
export { programView } from './component.js';
export { patchModel } from './state.js';
export { defineActions, type ActionMessage } from './actions.js';

// Sessions and projections for large controllers
export { projectionCache, sessionGroup } from './session.js';
