// Use upstream JSON Pointer semantics; state writes remain immutable for EffectWeb snapshots.
export { getByPath as getPointer } from '@json-render/core';
export { immutableSetByPath as setPointer } from '@json-render/core/store-utils';
