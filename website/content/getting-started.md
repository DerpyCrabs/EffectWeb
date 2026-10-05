EffectWeb is a UI framework for browser applications written in TypeScript with [Effect](https://effect.website). You write views in JSX. A native compiler turns them into direct DOM updates.

You need Node.js 22.14 or later, TypeScript 5.4 or later, and Effect 4.

## 1. Install

```bash
mkdir my-app && cd my-app
npm init -y
npm install effectweb effect@4.0.0
npm install --save-dev @effectweb/compiler vite typescript
```

Keep `effectweb`, `@effectweb/compiler` and any other `@effectweb/*` packages on the same version; the adapter packages require the exact matching `effectweb` version, so npm reports a mismatch.

## 2. Configure Vite and TypeScript

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { effectweb } from '@effectweb/compiler/vite';

export default defineConfig({ plugins: [effectweb()] });
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "jsxImportSource": "effectweb",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`"jsx": "preserve"` leaves JSX for the EffectWeb compiler, which runs inside the Vite plugin.

## 3. Write the app

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My app</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx check
import { modelOwner, mount, view } from 'effectweb';

const owner = modelOwner({ count: 0 });

const Counter = view<{ readonly count: number }>((model) => (
  <button onClick={() => owner.patch({ count: model.count + 1 })}>Count: {model.count}</button>
));

mount(document.getElementById('app')!, Counter, owner.source);
```

What each part does:

- `modelOwner` holds the state, `{ count: 0 }`.
- `view` describes the screen for a given state. It runs again whenever the state changes.
- The click handler calls `owner.patch` to publish a new state.
- `mount` puts the view on the page.

Once Effects in the app need services, such as an API client, the app runs as an Effect instead; [App setup](/docs/services/#mount-the-app) shows the few lines that changes.

## 4. Run it

```bash
npx vite          # development server
npx vite build    # production build in dist/
```

The build is a static client-side app. EffectWeb does not do server rendering or hydration.

## 5. Turn on the lint rules

The lint preset catches the most common mistakes, such as rows without a key or Effects started during rendering.

```bash
npm install --save-dev oxlint
```

`.oxlintrc.json`:

```json
{ "extends": ["./node_modules/@effectweb/compiler/dist/oxlint-preset.json"] }
```

Run `npx oxlint`. Each error has a code; [Compiler and lint](/docs/compiler/#diagnostic-codes) lists them with fixes.

## Next steps

- Read [Core concepts](/docs/concepts/). It is short and explains the rules every other page relies on.
- Use [Which API to use](/docs/choosing-apis/) when you know what you want to build.
- These pages, including the API reference, are installed with the package as Markdown in `node_modules/effectweb/docs`, matching the installed version. Point a coding agent's instructions at `node_modules/effectweb/docs/README.md`.

The compiler ships prebuilt binaries for Linux (x64 and arm64, glibc), macOS (x64 and arm64) and Windows x64 as optional dependencies, so you do not need Rust. musl Linux is not supported yet.
