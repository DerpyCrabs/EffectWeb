# EffectWeb

Immutable Effect models and JSX with direct DOM rendering.

EffectWeb separates state transitions and scoped Effect work from snapshot views. A view executes ordinary JavaScript on each model publication. The Rust/Oxc compiler lowers JSX syntax; the renderer reconciles its output with existing DOM nodes. Explicit `list(...)` calls preserve row identity across edits, filtering, and reordering.

The runtime is `effectweb`; compiler tooling and integrations use the `@effectweb` npm scope. All packages share one release version.

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
import { Effect, SubscriptionRef } from 'effect';
import { fromSubscriptionRef, mount, view } from 'effectweb';

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const count = yield* SubscriptionRef.make(0);
      const source = yield* fromSubscriptionRef(count);
      const Counter = view<number>((value) => (
        <button onClick={() => SubscriptionRef.update(count, (n) => n + 1)}>Count: {value}</button>
      ));
      yield* mount(document.getElementById('app')!, Counter, source);
      return yield* Effect.never;
    }),
  ),
);
```

The [reading-list example](examples/reading-list) uses the packages with both IndexedDB and synchronous Effect storage.

See the [GitHub releases](https://github.com/DerpyCrabs/EffectWeb/releases) for release changes.

## Design boundaries

Views read immutable sources; programs can update them through messages, and Effect references or atoms can supply existing state. Effects belong to program, component, or DOM-listener scopes. Changing a loader from synchronous Effect to asynchronous Effect does not change its view contract. Promise APIs are adapted explicitly with `fromPromise`.

The compiler preserves calls, callbacks, locals, and control flow. It does not infer render dependencies or memoize helpers. Declare entity identity with `collection` or `entities`, render it with `list`, and keep expensive projections at an explicit application boundary. Ordinary `.map(...)` produces an ordinary array whose rendered children have positional identity. Published plain objects and arrays are frozen in every build, and `Snapshot<T>` exposes recursively readonly data. Opaque mutable resources keep their own lifecycle. Query identity includes every request argument; services belong in the Effect environment. Query caching is in memory; persistence, optimistic domain transactions, multi-tab coordination, and service acquisition remain application responsibilities.

`dispose()` starts synchronous teardown and interrupts owned work. Execute the Effect returned by `close()` when teardown must wait for asynchronous finalizers before closing dependencies. DOM integrations use a stable acquisition function: declare `domMount` once, or pass changing data through `domBinding(data, acquire)`.

This package is a client-side renderer without SSR, hydration, or built-in routing. Runtime and compiler releases advance together.

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

CI runs the checks above. The release workflow builds native packages for all five supported platforms. Manual workflow runs default to `publish: false` for release validation; pushing a `v*` tag or explicitly enabling publishing performs the npm release.

For the isolated renderer benchmark, run `npm run build:benchmark` and then `node scripts/benchmark-snapshot.mjs dist-benchmark /tmp/effectweb-benchmark.json`.

## License

[MIT](LICENSE).
