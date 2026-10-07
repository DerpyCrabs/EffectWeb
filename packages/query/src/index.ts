// Server data for EffectWeb: shared query caches observed by controllers and views.
export {
  query,
  queryGroup,
  type Query,
  type QueryKey,
  type QueryGroup,
  type QueryEncoding,
} from './query.js';
export { queryCache, type QueryCache, type QueryCacheOptions } from './cache.js';
export { observeQuery, querySource, type QueryResource } from './observe.js';
export {
  infiniteQuery,
  infiniteResource,
  fetchNextPage,
  type InfiniteData,
  type InfiniteQuery,
  type InfiniteResource,
} from './infinite-query.js';
