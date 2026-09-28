# @effectweb/json-render

EffectWeb rendering adapter for `@json-render/core`. Applications define their catalog with upstream `defineCatalog` and `@effectweb/json-render/schema`, then supply component implementations through `defineRegistry(catalog, { components })`.

```tsx
import { Renderer } from '@effectweb/json-render';

<Renderer
  spec={model.spec}
  state={model.state}
  registry={registry}
  dispatch={(action) => send({ type: 'Action', action })}
/>;
```

Registry components receive `props`, `element`, `key`, `children`, `bindings`, `loading`, and `emit(event, extraParams?)`. The adapter resolves upstream prop expressions, visibility, binding paths, and event parameters. Unknown component types use the optional `fallback`; missing elements and cycles are skipped, allowing partial streamed specs.

The host EffectWeb program owns immutable state and action execution, including confirmation, chaining, validation, and cancellation. Action dispatch preserves the original binding metadata. `getPointer` and immutable `setPointer` help update host state. There is no built-in component catalog, CSS, Markdown renderer, image storage convention, or application action policy. Repeat scopes and state watchers are not implemented.

The catalog/registry separation follows the upstream React, Vue, and Solid adapters: https://json-render.dev/docs/registry.
