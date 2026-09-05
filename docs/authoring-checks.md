# Authoring checks, September 5, 2026

This batch adds compiler diagnostics to Oxlint, makes published model fields readonly, and checks plain-data immutability during development. It does not change the renderer's dependency model or query sharing algorithm.

## Compiler and Effect diagnostics

`@effectweb/compiler/oxlint` exposes `effectweb/valid-view` and optional `effectweb/whole-model-dependency` advice. Both call the same native analysis used during compilation. Diagnostics use source locations, handle aliased/custom imports, continue after invalid views, and refresh when editor content changes. Oxlint suppression affects lint only; compilation still rejects unsupported code.

The clean-package test loads the packaged export layout through Oxlint, verifies that an invalid view fails, checks line suppression, and builds/runs valid JSX. Native binary loading remains covered. The lint integration stays in the compiler package and adds no runtime dependency.

EffectWeb, TeleVecha, LocalChat, and Inbox all reject a deliberately discarded Effect through their normal lint configuration. Inbox now installs and patches Effect-aware Oxlint. The other projects retain their existing Effect lint setup. LocalChat retains nine existing advisory warnings; required correctness checks pass.

## Snapshot protection

Published model fields and subscriber/reducer inputs are readonly. Field edits receive readonly values and may return them unchanged. Nested domain types remain the application's responsibility; this is not a recursive conversion of arbitrary service types.

Development publication freezes plain objects and arrays, including nested and symbol fields and retained input references. Staged transaction reads are protected. The checks reuse weakly tracked shared branches. They do not clone data, execute getters, or freeze class instances. Successful data inside Effect `AsyncResult`, including retained success after a failed refresh, is checked without freezing the Effect wrapper.

Browser tests verify automatic enablement during Vite development; the packed production consumer verifies automatic disablement. Explicit `checkSnapshots` supports tests outside Vite. Mutable internals of opaque objects remain outside this contract.

## Issues caught in consumers

- Inbox's browser and CLI request helpers spread `RequestInit.headers` into plain objects. That loses `Headers` instances and mishandles tuple arrays. They now normalize through `Headers`; tests cover records, tuple arrays, existing `Headers`, and default content types.
- Inbox's new type-aware checks also exposed unchecked provider text stringification, unnecessary `void` wrappers, and missing definitive exits from never-ending Effects. Provider text now requires a string; malformed-event behavior is tested.
- LocalChat's duplicated workflow interface required mutable array inputs. It now reuses `ModelOwner` types, and selected skill IDs are readonly.
- TeleVecha's fixture transport mutated a message already returned to callers. Snapshot checks made the outgoing-edit browser test fail consistently. Editing, pinning, and reactions now replace records immutably. A regression checks each operation against frozen prior results.

## Bundle impact

Summed JavaScript gzip bytes, using Node's default gzip level:

| App       |  Before |   After | Increase |
| --------- | ------: | ------: | -------: |
| LocalChat | 100,645 | 100,773 |      128 |
| Inbox     | 185,318 | 185,473 |      155 |
| TeleVecha | 422,167 | 422,324 |      157 |

The static-view fixture remains 2,101 gzip bytes. Owner/program fixtures add approximately 0.24 KB gzip. These are production builds, where automatic snapshot traversal is disabled; explicit test/debug overrides remain supported. Bundle budgets and unused-view tree shaking pass.

## Validation

Framework formatting, lint, types, Clippy, 150 unit tests, nine Rust tests, 28 browser tests, and clean package consumption pass. Inbox has 21 passing unit tests and 37 browser tests with snapshot checks forced on. LocalChat has 28 passing unit tests and 23 browser tests with 13 existing skips. TeleVecha has 300 passing unit tests and all 302 browser tests pass in the final run.

All three production builds pass. Inbox builds and browser tests use temporary output and fixture storage, preserving its live deployment. The consumer changes remain uncommitted, and the locally installed framework packages remain unpublished. Updated consumers require a coordinated framework release before clean installation.
