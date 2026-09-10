# EffectWeb Lucide

Lucide icons compiled to direct DOM views. The build generates the complete catalogue from pinned official `@lucide/icons` data using EffectWeb's Oxc compiler. Each mounted icon owns its SVG and updates it in place.

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

Named imports such as `import { Camera } from '@effectweb/lucide'` are tree-shaken in production builds. Prefer the per-icon paths above for development: prebundling the root entry preserves the full catalogue's exports and source maps. Do not force the whole catalogue into Vite's `optimizeDeps.include` for a fixed icon set. Upstream aliases, including `AlarmCheck` / `AlarmClockCheck`, and `Icon`-suffixed named exports share the same view identity. Per-icon and lazy imports also support aliases. `LucideIcon` and `LucideProps` are exported types.

## Props

- `size`: number or CSS length, default `24`; `width` and `height` override it individually.
- `color`: default `currentColor`; `strokeWidth`: default `2`. Native `stroke` and `stroke-width` attributes take precedence.
- `absoluteStrokeWidth`: adds `vector-effect="non-scaling-stroke"` to geometry, including with CSS dimensions.
- `class`, `className`, `classList`, `style`, native SVG attributes, `data-*`, and `aria-*`.
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

This entry also exports `iconNames`, the `IconName` union, and `dynamicIconImports`, a low-level Promise-based module map. Importing the registry makes the full catalogue available as lazy chunks. Prefer named imports, per-icon imports, or a small application-owned import map for a fixed set of icons. The registry is absent from ordinary icon bundles.

## Raw SVG and data

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
