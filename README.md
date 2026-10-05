# EffectWeb

Immutable Effect models and JSX with direct DOM rendering.

EffectWeb separates state transitions and scoped Effect work from snapshot views. A view executes ordinary JavaScript on each model publication. The Rust/Oxc compiler lowers JSX syntax; the renderer reconciles its output with existing DOM nodes. Explicit `list(...)` calls preserve row identity across edits, filtering, and reordering.

The runtime is `effectweb`; compiler tooling and integrations use the `@effectweb` npm scope. All packages share one release version.

**Start with the [guides](website/content/getting-started.md).** They and the API reference ship inside the `effectweb` package as Markdown (`node_modules/effectweb/docs/README.md`), matching the installed version, so point your agent instructions there.

Render every JSX row with `list(scalars, render)`, `list(entities(rows), render)` or `list(rows, identity, render)`; JSX-returning `.map` callbacks are lint errors. Owned work uses structural keys such as `['folder-hover', id]`. `owner.run(key, effect, policy)` starts immediately and returns a handle whose `await` Effect yields the run's `Exit`; `owner.task(field, effect, policy)` does the same and publishes the work's `AsyncResult` in `model[field]`. A controller placement is `controllerView({ controller, identity }, view)`; it remains separate from `component` to keep type errors useful. See the [GitHub releases](https://github.com/DerpyCrabs/EffectWeb/releases) for migration notes.

## Website and documentation

Run `npm run dev:site` to open the landing page, guides, recipes, and API reference at `http://localhost:4310`. The guides are `website/content/*.md`; the reference is generated from the current workspace declarations. `npm run build` also writes both as Markdown into `packages/runtime/docs`.

`npm run test:docs` checks standalone examples, `npm run build:site` produces a static site in `website/dist`, and `npm run test:site` validates its pages and links. See [website/README.md](website/README.md) for maintenance and hosting details.

## Packages

- `effectweb`: views, keyed lists, one `component(definition, view)` for local fields or messages, controllers that run owned work with `run` and `task`, async presentation and DOM lifetimes. `effectweb/advanced` holds adapter-building (`projectionSource`, `shareValue`) and rendering-optimization (`memoView`, `lazyView`) APIs; `effectweb/testing` holds test helpers.
- `@effectweb/compiler`: Rust/Oxc compiler and the `@effectweb/compiler/vite` plugin. Native binaries install as optional platform dependencies; application developers do not need Rust.
- [`@effectweb/query`](packages/query): cached server data. Queries identified by all their arguments, observed by views (`querySource`) or controllers (`observeQuery`), with infinite pages, invalidation groups and scoped caches.
- [`@effectweb/lucide`](packages/lucide): precompiled Lucide views, per-icon imports, optional Effect-based lazy loading, and raw SVG builders.
- Adapters: [`@effectweb/tanstack-router`](packages/tanstack-router) (typed `<Link>`), [`@effectweb/tanstack-form`](packages/tanstack-form), [`@effectweb/tanstack-table`](packages/tanstack-table), [`@effectweb/keycloak`](packages/keycloak), [`@effectweb/json-render`](packages/json-render) and [`@effectweb/antd-icons`](packages/antd-icons).

The runtime currently requires **Effect 4.0.0** and TypeScript 5.4 or newer. Compiler tooling requires Node.js 22.14+. The release workflow builds glibc Linux x64/arm64, macOS x64/arm64, and Windows x64 binaries. musl Linux and other architectures have no prebuilt package.

## Vite setup

Install the runtime and compiler:

```sh
npm install effectweb effect@4.0.0
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
import { modelOwner, mount, view } from 'effectweb';

const owner = modelOwner({ count: 0 });

const Counter = view<{ readonly count: number }>((model) => (
  <button onClick={() => owner.patch({ count: model.count + 1 })}>Count: {model.count}</button>
));

mount(document.getElementById('app')!, Counter, owner.source);
```

An app whose Effects need services runs as an Effect and mounts with `makeMount`; see [App setup](website/content/services.md).

See the [GitHub releases](https://github.com/DerpyCrabs/EffectWeb/releases) for release changes.

## Design boundaries

Views read immutable sources; owners and programs update them through patches or messages. Effects belong to an owner, a program, a component or a DOM listener. Changing a loader from synchronous Effect to asynchronous Effect does not change its view contract. External Promise APIs are adapted at their integration boundary with `Effect.tryPromise`.

The compiler preserves calls, callbacks, locals, and control flow. It does not infer render dependencies or memoize helpers; a view boundary skips its render when the same model object arrives again, so copying only changed branches is the whole optimization story. Declare entity identity with `collection` or `entities`, render it with `list` (`list(rows, identity, render)` for other keys; plain arrays only for scalars), and keep expensive projections at an explicit application boundary. The identity lint requires `list` for JSX-returning `.map(...)` callbacks; ordinary arrays remain valid JSX content, including compiled fragments. Published plain objects and arrays are frozen in every build, and `Snapshot<T>` exposes recursively readonly data. Opaque mutable resources keep their own lifecycle. In `@effectweb/query`, query identity includes every request argument; services belong in the Effect environment. Query caching is in memory; persistence, optimistic domain transactions, multi-tab coordination, and service acquisition remain application responsibilities.

`dispose()` starts synchronous teardown and interrupts owned work. Execute the Effect returned by `close()` when teardown must wait for asynchronous finalizers before closing dependencies. Inside an Effect, scope an owner or cache with `Effect.acquireRelease(Effect.sync(() => modelOwner(initial)), (owner) => owner.close())`. DOM integrations use a stable acquisition function: declare `domMount` once, or pass changing data through `domBinding(data, acquire)`. Numeric `style` values get `px` except for unitless properties, and `on:eventName` listens for a custom element's event by its exact name.

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
npm run dev:site
```

`npm run fmt` uses Oxfmt and rustfmt. `npm run check` includes Oxlint, Effect diagnostics, TypeScript, and Clippy. Compiler behavior is tested from `packages/compiler/src/*.test.ts` against the built native binary; `test:compiler` runs the crate's own unit tests, which cover only source maps. Rebuild after changing runtime/compiler source; browser tests deliberately consume built packages. Unit tests exercise source modules in Node; a test file that renders starts with `// @vitest-environment happy-dom`. Renderer contract tests in `tests/unit` run the compiled fixtures under happy-dom; only behavior that needs a real browser (focus, input editing, layout, mutation records) stays in `tests/browser`, where tests run in parallel, each in its own page.

`test:package` packs a real release, installs it into a clean temporary project with install scripts disabled, checks exported files and TypeScript, builds with standard Vite, and drives a browser interaction. It verifies the native loader without relying on workspace links or a consumer Rust build.

CI runs the checks above. The release workflow builds native packages for all five supported platforms. Manual workflow runs default to `publish: false` for release validation; pushing a `v*` tag or explicitly enabling publishing performs the npm release.

For the isolated renderer benchmark, run `npm run build:benchmark` and then `node scripts/benchmark-snapshot.mjs dist-benchmark /tmp/effectweb-benchmark.json`.

## License

[MIT](LICENSE).
