// Specialized APIs for adapter authors and explicit rendering optimizations.
// Application code should normally use the root `effectweb` exports; see docs/choosing-apis.md.

// Adapter building blocks
export { projectionSource, type ProjectionSource } from './source.js';
export { protectSnapshot } from './snapshot.js';
export { shareValue, type ShareFields } from './share.js';

// Explicit rendering optimizations
export { memoView } from './dom.js';
export { lazyView, type LazyViewOptions } from './lazy.js';
