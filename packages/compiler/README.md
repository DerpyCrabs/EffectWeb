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
