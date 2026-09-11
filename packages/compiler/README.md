# @effectweb/compiler

Native Rust/Oxc compiler for EffectWeb snapshot JSX.

```ts
import { defineConfig } from 'vite';
import { effectweb } from '@effectweb/compiler/vite';

export default defineConfig({ plugins: [effectweb()] });
```

Install `effectweb` and its required Effect version in the application. Set TypeScript `jsx` to `preserve` and `jsxImportSource` to `effectweb`.

For direct compilation, import `compile` from `@effectweb/compiler`; the result contains generated code, a source map, and diagnostics. The Vite plugin reports syntax diagnostics and enables development instrumentation during serve.

The compiler lowers JSX syntax. Calls, callbacks, local variables, control flow, and JSX helpers retain ordinary JavaScript behavior. `view` is an executable runtime function; the compiler does not prove render purity, infer model dependencies, memoize helpers, or reinterpret `.map` as keyed rendering. Use the runtime's explicit `list(rows, render)` operation for keyed lists.

Files opt in by importing `effectweb` or one of its subpaths, or by declaring `/** @jsxImportSource effectweb */`. A different `@jsxImportSource` pragma leaves the file to its chosen JSX runtime. `compile` returns other files unchanged. `importSource` and `runtimeModule` options customize these module names. The package also supports the standard automatic JSX transform through `effectweb/jsx-runtime`; the native compiler adds source metadata in development.

Requires Node.js 22.14+. Optional packages provide binaries for glibc Linux x64/arm64, macOS x64/arm64, and Windows x64. Keep optional dependencies enabled. Installation does not compile Rust. Framework contributors build from source using Rust 1.96+.

See [EffectWeb](https://github.com/DerpyCrabs/EffectWeb) for authoring and development instructions.

For editor and CI diagnostics, add `@effectweb/compiler/oxlint` to Oxlint's `jsPlugins`. `effectweb/valid-view` checks supported JSX syntax, and `diagnose` exposes the same structured diagnostics without emitting code. Parser failures throw.

`effectweb/render-safety` is an optional heuristic lint rule for suspicious render work and captures. The separate `lint` API exposes these checks. They never participate in compilation or change generated code, and they are not a proof of purity. The former `whole-model-dependency` rule and collection-identity inference have been removed.

The runtime freezes published plain objects and arrays in every build without changing their identity or introducing proxies. Opaque mutable resources retain their own lifecycle. Development instrumentation labels actual text and attribute expressions and their evaluated values; production builds omit that metadata. It does not derive model-field dependency paths.

Diagnostics include `code`, `category`, `severity`, source `file`/`line`/`column` (one-based UTF-16 columns), and an actionable `remedy`:

| Code   | Category              | Meaning and remedy                                                                                                                                                 |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EW1000 | correctness           | Lint could not parse the file or load the native compiler. Fix syntax or installation.                                                                             |
| EW1001 | correctness           | Unsupported intrinsic JSX syntax, such as `key`, `ref`, or `innerHTML`. Use explicit lists or owned DOM bindings.                                                  |
| EW1003 | correctness           | Optional render-safety lint found potentially impure work. Review it and move side effects into owned work.                                                        |
| EW2001 | unprovable-dependency | Optional render-safety lint found a potentially mutable capture. Review its ownership; compilation itself accepts ordinary JavaScript captures.                    |
| EW2002 | unprovable-dependency | Query-key lint found a custom `key`. Remove it; every request argument participates in cache identity. The public query types and runtime also reject custom keys. |

`effectweb/query-key` recognizes imported `query` definitions, including aliases and `effectweb/query`, with literal custom keys. Types and the runtime cover definitions assembled outside that lint analysis. Supply service instances through the Effect environment. For example:

```json
{
  "jsPlugins": ["@effectweb/compiler/oxlint"],
  "rules": {
    "effectweb/valid-view": "error",
    "effectweb/query-key": "error",
    "effectweb/render-safety": "warn"
  }
}
```

Remove `effectweb/render-safety` when heuristic advice is not wanted. TypeScript checks props, snapshots, and Effect service/error contracts; the compiler does not load or check the consumer's TypeScript project.
