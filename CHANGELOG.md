# Changelog

## 0.4.0 — unreleased

### Breaking changes

- Views execute ordinary JavaScript for each immutable model publication. The compiler lowers JSX syntax without dependency inference, render memoization, or reinterpretation of callbacks and collection methods.
- Keyed rendering uses `list(rows, render)`. Ordinary `.map` output renders by position; explicit collections declare domain identity.
- Slots are called explicitly, including `Slot<void>`. Reusable DOM acquisitions need stable functions or `domBinding` inputs across view evaluations.
- Awaitable lifecycle and keyed-task results return Effects. Execute `close`, idle/stopped waits, task outcomes, and drains with Effect; owned resource close methods follow the same contract.
- Removed compiler-only intrinsics, implicit slot compilation, collection-identity diagnostics, and the `whole-model-dependency` lint rule. Render-safety lint is optional and separate from compilation.

See the [migration guide](docs/migration-0.4.0.md) for examples and ownership details.

### Rendering and ownership fixes

- Preserve current inputs and release acquired work when setup, updates, or cleanup reenter rendering or dispose the parent.
- Preserve exact row values and stable DOM identity; validate sparse-array positions and duplicate identities.
- Keep active event work across callback updates and report interrupted finalizer defects before settlement.
- Release sessions after subscription setup failures and expose awaitable close through the program test driver.
- Preserve JSX evaluation order, intrinsic tag classification, `__proto__` props, and source locations across JavaScript line endings.
- Avoid unnecessary text and attribute writes for unchanged presentation values.

### Packages and tooling

- Functional automatic JSX runtime alongside native JSX lowering.
- Effect subpath imports reduce development dependency loading. Lucide keeps production tree shaking and supports per-icon development imports.
- Clean-package checks cover JSX contracts, native loading, tree shaking, and the complete Lucide catalogue.
- Effect remains a peer dependency pinned to `4.0.0-rc.112`; all EffectWeb runtime, compiler, native, and Lucide packages advance together.
