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

The Vite plugin enables plain-data snapshot freezing during development and disables it for production builds. This catches accidental mutation without changing object identity or introducing proxies. Published snapshots must remain immutable; opaque mutable objects are outside these checks.

Diagnostics include `code`, `category`, `severity`, source `file`/`line`/`column` (one-based UTF-16 columns), and an actionable `remedy`:

| Code   | Category              | Meaning and remedy                                                                                                                                                |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EW1000 | correctness           | Lint could not parse/analyze the file; fix syntax or the native compiler installation.                                                                            |
| EW1001 | correctness           | Invalid view syntax or impure render work; the message identifies the supported form or command boundary.                                                         |
| EW1002 | correctness           | A known raw object array is rendered with `.map`; use `entities(items)`, a declared `collection(identity).from(items)`, or explicit positional `sequence(items)`. |
| EW2001 | unprovable-dependency | A mutable capture is outside snapshot dependencies; pass immutable data through the model. Compilation rejects this.                                              |
| EW2002 | unprovable-dependency | A query load reads argument fields absent from its key; include every load-relevant argument in cache identity. This is a warning for review.                     |
| EW3001 | performance           | A helper depends on the entire model; optionally pass the individual fields it uses.                                                                              |

`effectweb/valid-view` reports compilation errors; `effectweb/whole-model-dependency` is optional performance advice. Enable `effectweb/query-key` to warn about query key omissions in `.ts` and `.tsx`. Configure severities independently:

```json
{
  "jsPlugins": ["@effectweb/compiler/oxlint"],
  "rules": {
    "effectweb/valid-view": "error",
    "effectweb/query-key": "warn",
    "effectweb/whole-model-dependency": "warn"
  }
}
```

Identity checks use conservative same-file evidence: object array literals, typed variables or parameters, explicit `view<Model>`, local non-generic aliases/interfaces, `Array`/`ReadonlyArray`/`readonly` annotations, and common `filter`/`slice` operations. They do not run a TypeScript project checker, resolve imported types, or infer domain keys. Unknown types remain subject to runtime identity checks. Collections validate identities when constructed or shared, including unchanged-array paths; duplicate errors report both zero-based positions.

Query checks recognize imported `query` (including aliases and `effectweb/query`), literal definitions, and inline `key`/`load` arrows reading named fields or simple destructured parameters. For example, `key: args => [args.account]` with `load: args => api(args.account, args.page)` reports `page`. Whole-argument keys, dynamic property access, rest/spread definitions, and external key helpers are left for review. A silent result does not prove cache identity is complete.
