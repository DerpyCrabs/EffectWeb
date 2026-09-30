# @effectweb/compiler

Native Rust/Oxc compiler for EffectWeb snapshot JSX.

```ts
import { defineConfig } from 'vite';
import { effectweb } from '@effectweb/compiler/vite';

export default defineConfig({ plugins: [effectweb()] });
```

Install `effectweb` and its required Effect version in the application. Set TypeScript `jsx` to `preserve` and `jsxImportSource` to `effectweb`.

For direct compilation, import `compile` from `@effectweb/compiler`; the result contains generated code, a source map, and diagnostics. The Vite plugin reports syntax diagnostics and enables development instrumentation during serve.

The compiler lowers JSX syntax. Calls, callbacks, local variables, control flow, and JSX helpers retain ordinary JavaScript behavior. Each intrinsic element becomes a call with its attributes and its children as separate arguments, so an element keeps one binding per child. Attribute objects whose values are all literals, and elements whose attributes and children are all literals, are hoisted to module scope: their identity is stable, so the renderer skips them on every publication. Production builds share one factory per tag within a module; development builds keep a factory per call site that carries source metadata. Components are called directly as functions. `view` is an executable runtime function; the compiler does not prove render purity, infer model dependencies, memoize helpers, or reinterpret `.map` as keyed rendering. Use the runtime's explicit `list(rows, render)` operation for keyed lists.

Every file containing JSX is compiled unless a `@jsxImportSource` pragma names another runtime, which leaves the file to that runtime. Files without JSX are linted when they import `effectweb`, one of its subpaths or an `@effectweb/*` package. `compile` returns other files unchanged. `importSource` and `runtimeModule` options customize these module names. The package also supports the standard automatic JSX transform through `effectweb/jsx-runtime`; the native compiler adds source metadata in development.

Requires Node.js 22.14+. Optional packages provide binaries for glibc Linux x64/arm64, macOS x64/arm64, and Windows x64. Keep optional dependencies enabled. Installation does not compile Rust. Framework contributors build from source using Rust 1.96+.

See [EffectWeb](https://github.com/DerpyCrabs/EffectWeb) for authoring and development instructions.

For editor and CI diagnostics, add `@effectweb/compiler/oxlint` to Oxlint's `jsPlugins`. `effectweb/valid-view` checks supported JSX syntax, and `diagnose` exposes the same structured diagnostics without emitting code. Parser failures throw.

`effectweb/render-safety` is an optional heuristic lint rule for suspicious render work and captures. The separate `lint` API exposes these checks. They never participate in compilation or change generated code, and they are not a proof of purity. The former `whole-model-dependency` rule and collection-identity inference have been removed.

The runtime freezes published plain objects and arrays in every build without changing their identity or introducing proxies. Opaque mutable resources retain their own lifecycle. Development instrumentation labels actual text and attribute expressions and their evaluated values; production builds omit that metadata. It does not derive model-field dependency paths.

Diagnostics include `code`, `category`, `severity`, source `file`/`line`/`column` (one-based UTF-16 columns), and an actionable `remedy`:

| Code   | Category              | Meaning and remedy                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EW1000 | correctness           | Lint could not parse the file or load the native compiler. Fix syntax or installation.                                                                                                                                                                                                                                                                                                                              |
| EW1001 | correctness           | Unsupported intrinsic JSX syntax, such as `key`, `ref`, or `innerHTML`. Use explicit lists or owned DOM bindings.                                                                                                                                                                                                                                                                                                   |
| EW1003 | correctness           | Optional render-safety lint found potentially impure work. Review it and move side effects into owned work.                                                                                                                                                                                                                                                                                                         |
| EW2001 | unprovable-dependency | Optional render-safety lint found a potentially mutable capture. Review its ownership; compilation itself accepts ordinary JavaScript captures.                                                                                                                                                                                                                                                                     |
| EW2002 | unprovable-dependency | Query-key lint found a custom `key`. Remove it; every request argument participates in cache identity. The public query types and runtime also reject custom keys.                                                                                                                                                                                                                                                  |
| EW3001 | identity              | Identity lint found `.map(...)` rows containing components or form controls. Their identity is positional, so removing or reordering rows moves state, focus and running work to another row. Use `list(entities(rows), render)` or `list(collection(identity).from(rows), render)`. Literal option arrays are exempt.                                                                                              |
| EW3002 | identity              | Identity lint found `domMount(fn)` or `domBinding(data, fn)` with a function created during render. The function is the binding identity, so the resource is released and acquired on every update. Declare it once outside the view.                                                                                                                                                                               |
| EW3003 | identity              | Identity lint found `commandSlot(...)` created inside a function and passed straight to `run`/`effectCommand`, or held in a local that the same call runs once. Every call gets a new slot, so `replace`/`drop` never apply and stale requests race newer ones. Declare slots once, or use `commandSlots(name)(key)`.                                                                                               |
| EW3004 | identity              | Identity lint found `mapSource(...)`, `clock(...)`, `collection(...)` or `commandSlots(...)` called inside a view. The result is new on every render, so the observation resubscribes, the row cache is lost, or the slot family forgets its work. Create it once outside the view, or use `list(rows, identity, render)`.                                                                                          |
| EW3005 | identity              | Identity lint found `list(sequence(rows), render)` whose rows hold editable form controls, or whose rows are selected with `.filter(...)`/`.slice(n)` and contain components. Positions shift when rows are removed, so drafts, focus and component state move to another row. Key the rows with `entities` or `collection`. Disabled and read-only controls, literal arrays and `slice(0, n)` prefixes are exempt. |
| EW3007 | identity              | `no-hook-names` found a function or constant named `useX`. EffectWeb has no hooks; name it after what it is or creates (`createX`, `xController`, a noun).                                                                                                                                                                                                                                                          |
| EW3006 | identity              | Identity lint found `collection((row, index) => ...)` or `list(rows, (row, index) => ..., render)` deriving identity from the index. Use a domain identity, or `sequence(rows)` for purely positional rows. An index used only as a `\|\|`/`??` fallback is exempt.                                                                                                                                                 |

`effectweb/query-key` recognizes imported `query` definitions, including aliases and `effectweb/query`, with literal custom keys. Types and the runtime cover definitions assembled outside that lint analysis. Supply service instances through the Effect environment.

The preset enables every rule (`valid-view`, `query-key`, `identity`, `render-safety`, `no-hook-names`) and restricts imports of the implementation modules:

```json
{ "extends": ["./node_modules/@effectweb/compiler/dist/oxlint-preset.json"] }
```

JavaScript configurations spread `effectwebLint` from `@effectweb/compiler/lint-preset`. Every rule is an error: agents and CI treat warnings as noise, and each finding names a concrete fix.

`effectweb/identity` reports row, DOM-binding and command-slot identity mistakes the compiler cannot reject (EW3001–EW3006); like render safety, it never changes generated code. Remove `effectweb/render-safety` when heuristic advice is not wanted. TypeScript checks props, snapshots, and Effect service/error contracts; the compiler does not load or check the consumer's TypeScript project.
