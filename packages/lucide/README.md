# EffectWeb Lucide

Lucide icons as direct DOM views. The build generates the complete catalogue from pinned official `@lucide/icons` data; each icon module holds only its geometry, and a shared factory builds the SVG markup once per icon. Each mounted icon owns its SVG and updates it in place.

Install `@effectweb/lucide` alongside `effectweb` and its declared Effect peer. For local use, run `npm run build` and `npm run test:package` from the repository root, then install the generated `artifacts/packages/effectweb-lucide-VERSION.tgz`.

```tsx
import { view } from 'effectweb';
import Camera from '@effectweb/lucide/icons/camera';
import Check from '@effectweb/lucide/icons/check';

export const Toolbar = view<{ busy: boolean }, never>((model, _send) => (
  <button disabled={model.busy}>
    <Camera size={18} /> Save photo <Check />
  </button>
));
```

The package intentionally has **no root entry or icon barrel**. `import { Camera } from '@effectweb/lucide'` fails package resolution and TypeScript checking. Use the direct icon paths above: development servers load only the selected icons, without relying on production tree-shaking. Aliases such as `alarm-check` and `alarm-clock-check` share the same view identity.

Import shared types with `import type { LucideIcon, LucideProps } from '@effectweb/lucide/types'`.

## Props

- `size`: number or CSS length, default `24`; `width` and `height` override it individually.
- `color`: default `currentColor`; `strokeWidth`: default `2`. Native `stroke` and `stroke-width` attributes take precedence.
- `absoluteStrokeWidth`: adds `vector-effect="non-scaling-stroke"` to geometry, including with CSS dimensions.
- `class`, `classList`, `style`, native SVG attributes, `data-*`, and `aria-*`.
- Native events, capture handlers, EffectWeb event effects, `use` lifetimes, and compiled JSX children follow the normal EffectWeb contracts.
- `title`: an SVG `<title>` that updates with the model.

Icons are decorative (`aria-hidden="true"`) by default. A `title`, `aria-label`, or `aria-labelledby` makes the icon an image; explicit `role` and `aria-hidden` take precedence. Label icon-only **buttons**, leaving their icons decorative.

Updates preserve the SVG and its geometry; equal props cause no DOM writes. Use immutable props. For shared defaults, use CSS or an application view; there is no separate provider or reactive state system.

## Lazy imports

```ts
import { isIconName, loadIcon } from '@effectweb/lucide/dynamic';

const name = isIconName(storedName) ? storedName : 'circle-help';
const load = loadIcon(name); // Effect<LucideIcon, IconLoadError>
```

Run the Effect in an existing task/resource lifecycle and use the returned view. Module imports cache the view without creating DOM. `IconLoadError` carries `iconName` and the original `cause`; invalid untyped names also fail in the Effect error channel. Interrupting the Effect stops waiting, but cannot abort a browser module download.

This entry also exports `iconNames`, the `IconName` union, and `dynamicIconImports`, a low-level Promise-based module map. Importing the registry makes the full catalogue available as lazy chunks. Prefer per-icon imports or a small application-owned import map for a fixed set of icons. The registry is absent from ordinary icon bundles.

## Raw SVG and data

Each direct icon module also exports `iconNode` (readonly SVG shape tuples, without
upstream reconciliation keys) and `viewBox`. These are the same geometry used by
the default view, so consumers that serialize icons for favicons can share their
data with rendered icons. Alias modules re-export the same geometry identity.
Treat the geometry as immutable; serialization should escape attribute values.

```ts
import { Camera } from '@effectweb/lucide/data';
import { buildLucideSvg, buildLucideDataUri } from '@effectweb/lucide/build';

const svg = buildLucideSvg(Camera, { size: 32, color: '#2563eb' });
const favicon = buildLucideDataUri(Camera, { size: 32 });
```

These separate entries re-export official Lucide APIs. `buildLucideIconNode` and `buildLucideIconElement` are available too. Raw builders retain upstream semantics, without the component accessibility defaults.

## Maintenance

Update the exact `@lucide/icons` dependency in both root and package manifests and rebuild to update the catalogue. Generated icons stay in `dist`; source SVG copies are not maintained. Builds validate the upstream version. `npm run test:package` installs tarballs into a clean consumer, checks JSX types and tree-shaking, compares every canonical icon's browser DOM with Lucide's official builder, and verifies aliases, import paths, updates, accessibility, events, and cleanup.

Lucide geometry is ISC-licensed, with Feather-derived icons under MIT. Complete upstream notices are included in [LICENSE](LICENSE).
