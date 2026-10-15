# @effectweb/shadcn

shadcn/ui components as EffectWeb views and components over native elements, styled with the upstream base-nova Tailwind v4 classes. No React primitive layer.

## Install the npm package

In an EffectWeb app:

```sh
npm install @effectweb/shadcn tailwindcss
```

Configure Tailwind v4 in your build. In your app stylesheet:

```css
@import 'tailwindcss';
@import '@effectweb/shadcn/theme.css';
@source "../node_modules/@effectweb/shadcn/dist";
```

Adjust the source path relative to the stylesheet, then import the stylesheet from your app entry point. Add `.dark` to an ancestor for dark mode.

### Copy source with the shadcn CLI

Alternatively, copy editable components into an existing EffectWeb + Vite + Tailwind v4 app. Keep `effectweb`, `effect`, and `@effectweb/compiler` installed and configure the EffectWeb and Tailwind Vite plugins. No React dependency is required. Add `components.json` at your project root:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": { "@effectweb": "https://effectweb.netlify.app/r/{name}.json" }
}
```

Set `compilerOptions.paths` to `{ "@/*": ["./src/*"] }` in `tsconfig.json` and configure the matching `@` alias to `src` in Vite. Use `jsx: "react-jsx"` and `jsxImportSource: "effectweb"` for TypeScript; the EffectWeb Vite plugin compiles the views. Do not add `baseUrl` (removed in TypeScript 6).

```bash
npx shadcn add @effectweb/button
npx shadcn add @effectweb/theme
```

The CLI copies component source into `src/components/ui` and shared helpers into `src/lib`, and installs their npm dependencies. Import `Button` from `@/components/ui/button` and edit the copied file. Headless primitives and icons remain npm packages (`@effectweb/base-ui` and `@effectweb/lucide`, pinned to the registry's tested versions). `effectweb` remains the app's peer dependency. The npm package mode above continues to support barrel and family imports.

The theme is a complete file, not `cssVars`: custom variants, the animation import, and unlayered native overlay rules need to stay intact. Its `~/styles/effectweb-shadcn-theme.css` target is relative to the project root. In `src/styles.css`, import it after Tailwind:

```css
@import 'tailwindcss';
@import '../styles/effectweb-shadcn-theme.css';
```

Tailwind scans the copied source in your app; the npm package's `@source` directive is unnecessary for this mode. The theme item installs `tw-animate-css`. Add `.dark` to an ancestor for dark mode.

### Registry items and local development

Shared items are `utils` (only `cn`), `types`, `adapter`, `placement`, and `theme`. Variant helpers are imported directly from `class-variance-authority`. The 48 UI families are:

`accordion`, `alert-dialog`, `alert`, `aspect-ratio`, `avatar`, `badge`, `breadcrumb`, `button`, `card`, `checkbox`, `collapsible`, `combobox`, `context-menu`, `dialog`, `drawer`, `dropdown-menu`, `empty`, `field`, `hover-card`, `input`, `item`, `kbd`, `label`, `menubar`, `native-select`, `navigation-menu`, `number-field`, `pagination`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `sonner`, `spinner`, `switch`, `table`, `tabs`, `textarea`, `toggle-group`, `toggle`, `toolbar`, `tooltip`.

From the EffectWeb checkout:

```bash
npm run registry:build
npm run registry:check
npm run registry:serve
# Optional alternate port:
npm run registry:serve -- --port 4519
npm run test:registry
```

For local installation, set the `@effectweb` registry URL to `http://127.0.0.1:4517/{name}.json` in the consumer's `components.json`. Generated JSON lives in `packages/shadcn/registry`; edit the TypeScript/CSS sources and regenerate, never edit JSON by hand. `npm run check` rejects drift. The website build copies the checked JSON to `/r/`. There is one base (EffectWeb Base UI), no `{style}` URL level, and no hook items.

## Use the npm package

```tsx
import { component, view } from 'effectweb';
import { Button, Dialog } from '@effectweb/shadcn';

export const Example = component(
  { init: () => ({ open: false }) },
  view((model, patch) => (
    <>
      <Button onClick={() => patch({ open: true })}>Open</Button>
      <Dialog
        open={model.open}
        onOpenChange={(open) => patch({ open })}
        title="Example"
        aria-label="Example"
      >
        <p>A native modal dialog.</p>
      </Dialog>
    </>
  )),
);
```

Per-family imports such as `@effectweb/shadcn/button` are also available. See [the guide](https://effectweb.netlify.app/docs/shadcn/) for all families, composition, controlled state and theming.

## Upstream and license

Upstream: shadcn/ui, base-nova style, from the registry at `https://ui.shadcn.com/r/styles/base-nova/<family>.json` as of 2026-10-10.

MIT. The port's notice is in [LICENSE](./LICENSE); upstream shadcn/ui is Copyright (c) 2023 shadcn, with its MIT text in [LICENSE.upstream](./LICENSE.upstream). See the [upstream license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).
