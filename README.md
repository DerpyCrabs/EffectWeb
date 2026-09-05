# EffectWeb

Immutable Effect models and JSX compiled to direct DOM updates. No virtual DOM, signals, or reactive proxies.

EffectWeb separates state transitions and scoped Effect work from pure snapshot views. Its Rust/Oxc compiler caches view derivations and emits granular DOM bindings. Collections declare domain identity once, and immutable structural sharing lets unchanged rows and bindings stay untouched.

Extracted from [TeleVecha](https://github.com/DerpyCrabs/TeleVecha), where it renders the complete application. This is an early framework with real application coverage, not yet a stable API. The runtime stays `effectweb`; compiler tooling and integrations use the `@effectweb` npm scope. All packages share one release version.

## Packages

- `effectweb`: views, immutable programs, tasks, async presentation, query cache, DOM lifetimes, and test helpers.
- `@effectweb/compiler`: Rust/Oxc compiler and the `@effectweb/compiler/vite` plugin. Native binaries install as optional platform dependencies; application developers do not need Rust.
- [`@effectweb/lucide`](packages/lucide): precompiled Lucide views, per-icon imports, optional Effect-based lazy loading, and raw SVG builders.

The runtime currently requires **Effect 4.0.0-rc.112**. Compiler tooling requires Node.js 22.14+. The release workflow builds glibc Linux x64/arm64, macOS x64/arm64, and Windows x64 binaries. musl Linux and other architectures have no prebuilt package.

## Vite setup

Install the runtime and compiler:

```sh
npm install effectweb effect@4.0.0-rc.112
npm install --save-dev @effectweb/compiler vite typescript
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { effectweb } from '@effectweb/compiler/vite';

export default defineConfig({ plugins: [effectweb()] });
```

Use `"jsx": "preserve"`, `"jsxImportSource": "effectweb"`, and `"moduleResolution": "Bundler"` in TypeScript. The plugin handles JSX before Vite transforms TypeScript and deduplicates Effect across linked packages.

```tsx
import { defineActions, mountView, program, view } from 'effectweb';

const actions = defineActions<{ count: number }>()({
  Increment: (model) => ({ model: { count: model.count + 1 } }),
});
const counter = program({ initial: { count: 0 }, update: actions.update });
const Counter = view((model: { count: number }, send: typeof counter.send) => {
  const dispatch = actions.bind(send);
  return <button onClick={() => dispatch.Increment()}>Count: {model.count}</button>;
});
mountView(document.getElementById('app')!, Counter, counter);
```

Read the [authoring guide](docs/authoring.md) for async tasks, services, slots, forms, queries, and testing. The [reading-list example](examples/reading-list) uses the packages with both IndexedDB and synchronous Effect storage.

## Design boundaries

Views read ordinary immutable values; messages update models. Effects belong to program, component, or DOM-listener scopes. Changing a loader from synchronous Effect to asynchronous Effect does not change its view contract. Promise APIs are adapted explicitly with `fromPromise`.

The compiler handles dependency checks and DOM updates, but cannot infer domain identity or make arbitrary work cheap. Declare entity identity with `collection`, preserve unchanged references, and keep view derivations pure. Development snapshot checks reject in-place mutation of published plain data. Production code must still preserve immutable updates; opaque mutable objects remain outside those checks. Query caching is in memory; persistence, optimistic domain transactions, multi-tab coordination, and service acquisition remain application responsibilities.

This package is a client-side renderer. It does not provide SSR, hydration, routing, or a stable ecosystem comparable to established UI frameworks. Runtime and compiler releases currently advance together.

## Development

Requires Rust 1.96+ with Cargo, rustfmt and Clippy, plus Node.js 22.14+.

```sh
npm ci
npm run build
npm run check
npm run check:browser
npm test
npm run test:compiler
npx playwright install chromium
npm run test:browser
npm run test:package
npm run dev:example
```

`npm run fmt` uses Oxfmt and rustfmt. `npm run check` includes Oxlint, Effect diagnostics, TypeScript, and Clippy. Rebuild after changing runtime/compiler source; examples and browser tests deliberately consume built packages. Unit tests exercise source modules.

`test:package` packs a real release, installs it into a clean temporary project with install scripts disabled, checks exported files and TypeScript, builds with standard Vite, and drives a browser interaction. It verifies the native loader without relying on workspace links or a consumer Rust build.

CI runs the checks above. The [release guide](docs/releasing.md) covers native packages, the first npm publication, and subsequent trusted publishing through GitHub Actions.

For the isolated renderer benchmark, run `npm run build:benchmark` and then `node scripts/benchmark-snapshot.mjs dist-benchmark /tmp/effectweb-benchmark.json`.

## License

[MIT](LICENSE).

Use `entities(items)` for immutable arrays with an `id` field; it also accepts `undefined` while data is unavailable. Use `collection(identity)` for custom keys and `sequence(items)` for positional lists. A read-only view can omit its dispatch parameter: `view((model) => <h1>{model.title}</h1>)`.

Run `npm run measure:bundles` after a build to check the static-renderer size budget and unused-view elimination. The report includes raw/gzip sizes and the retained module contributions for views, programs and queries.
