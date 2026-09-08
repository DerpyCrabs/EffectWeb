# @effectweb/compiler

Native Rust/Oxc compiler for EffectWeb snapshot JSX.

```ts
import { defineConfig } from 'vite';
import { effectweb } from '@effectweb/compiler/vite';

export default defineConfig({ plugins: [effectweb()] });
```

Install `effectweb` and its required Effect version in the application. Set TypeScript `jsx` to `preserve` and `jsxImportSource` to `effectweb`.

For direct compilation, import `compile` from `@effectweb/compiler`; the result contains generated code, a source map, and diagnostics. The Vite plugin reports diagnostics and enables development instrumentation during serve.

Requires Node.js 22.14+. Optional packages provide binaries for glibc Linux x64/arm64, macOS x64/arm64, and Windows x64. Keep optional dependencies enabled. Installation does not compile Rust. Framework contributors build from source using Rust 1.96+.

See [EffectWeb](https://github.com/DerpyCrabs/EffectWeb) for authoring and development instructions.

For editor and CI diagnostics, add `@effectweb/compiler/oxlint` to Oxlint's `jsPlugins` and enable `effectweb/valid-view` as an error. The optional `effectweb/whole-model-dependency` rule reports coarse dependencies. Both use the compiler's Rust analysis; no second purity implementation is maintained. `diagnose` exposes the same structured view diagnostics for other tooling. Invalid syntax still throws and is handled by the host parser.

The runtime freezes published plain objects and arrays in every build without changing their identity or introducing proxies. Opaque mutable resources retain their own lifecycle. The Vite plugin adds source-dependency instrumentation during development; production builds omit that metadata.

Diagnostics include `code`, `category`, `severity`, source `file`/`line`/`column` (one-based UTF-16 columns), and an actionable `remedy`:

| Code   | Category              | Meaning and remedy                                                                                                                                                |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EW1000 | correctness           | Lint could not parse/analyze the file; fix syntax or the native compiler installation.                                                                            |
| EW1001 | correctness           | Invalid view syntax or impure render work; the message identifies the supported form or command boundary.                                                         |
| EW1002 | correctness           | A known raw object array is rendered with `.map`; use `entities(items)`, a declared `collection(identity).from(items)`, or explicit positional `sequence(items)`. |
| EW2001 | unprovable-dependency | A mutable capture is outside snapshot dependencies; pass immutable data through the model. Compilation rejects this.                                              |
| EW2002 | unprovable-dependency | A query declares a custom `key`; remove it. Every request argument already participates in cache identity. This is a compilation error.                           |
| EW3001 | performance           | A helper depends on the entire model; optionally pass the individual fields it uses.                                                                              |

`effectweb/valid-view` reports compilation errors; `effectweb/whole-model-dependency` is optional performance advice. `effectweb/query-key` reports rejected custom query keys in `.ts` and `.tsx`. Configure these rules as follows:

```json
{
  "jsPlugins": ["@effectweb/compiler/oxlint"],
  "rules": {
    "effectweb/valid-view": "error",
    "effectweb/query-key": "error",
    "effectweb/whole-model-dependency": "warn"
  }
}
```

Identity checks use conservative same-file evidence: object array literals, typed variables or parameters, explicit `view<Model>`, local non-generic aliases/interfaces, `Array`/`ReadonlyArray`/`readonly` annotations, and common `filter`/`slice` operations. They do not run a TypeScript project checker, resolve imported types, or infer domain keys. Unknown types remain subject to runtime identity checks. Collections validate identities when constructed or shared, including unchanged-array paths; duplicate errors report both zero-based positions.

Query checks recognize imported `query` (including aliases and `effectweb/query`) and reject literal definitions containing `key`. TypeScript and the runtime also reject custom keys, including definitions assembled outside the compiler's static analysis. Pass all request data as arguments and supply services through the Effect environment.
