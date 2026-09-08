# Authoring audit fixes — 2026-09-08

Implemented the correctness fixes and authoring recommendations from the audit, with framework regressions and direct consumer validation. Packages are local 0.2.3 candidates; nothing was published. Consumer manifests and lockfiles retain their original bytes.

## Changes

- **Readonly collection sharing:** the mutable overload now requires both input arrays to be mutable. Sharing a published readonly array returns a readonly result, including its nested snapshot data. Compile-time negative tests prevent the mutation escape; runtime tests preserve sharing identity and borrowed ownership with snapshot checks enabled and disabled. LocalChat's message reconciliation now exposes the readonly result and tests frozen input.
- **Explicit child dispatch:** ordinary `model` and `send` attributes are always props. The imported `ViewBinding` marker explicitly supplies a child view, its model, and its dispatcher. Import aliases work; invalid model and message types fail checking. SparkSwarm's nine dispatch bindings and the framework fixture use the new syntax.
- **JSX spreads:** component and intrinsic spreads preserve overwrite order and snapshot dependencies. Removed DOM attributes are cleared, controlled inputs release their restoration hooks, replaced event handlers cancel their owned work, and hosts update/dispose through the existing lifecycle API. Direct event callbacks in spread literals retain their deferred boundary; eager factories and nested non-event data remain checked. Explicit JSX children override a component spread's `children` prop.
- **Accessor-safe sharing:** structural sharing detects getter/setter descriptors and retains the next object without executing accessors. Regressions cover throwing getters, nested records, and array accessors.
- **TeleVecha publication ownership:** a local `projectionPublication` helper owns subscriptions, microtask batching, invalidation, sharing, listeners, and disposal. Tests cover equality, changes during refresh/project, reentrant listeners, and disposal. The controller retains domain reconciliation and session ownership. This deliberately stays local instead of introducing a generic framework controller abstraction without a second matching caller.
- **Precise authoring contracts:** the guide documents reference capture for queued arguments and shows how to submit owned immutable request data. A queue test distinguishes copied data from shared references. It also documents existing safe paths for declaration order, const locals, and recursive compiled views; model destructuring and ordinary union narrowing already work. These conservative compiler boundaries were not silently relaxed.
- **Reproducible local packages:** `pack-release --local` now stages the current built native compiler automatically. Package smoke tests compare installed and built binary bytes, check the new compiler forms, and exercise ordinary props, explicit dispatch, spread updates, and disposal in a production browser build.

## Migration

```tsx
import { ViewBinding } from 'effectweb';

// Reducer dispatch uses an explicit marker:
<ViewBinding view={Counter} model={count} send={send} />;

// Ordinary domain props keep their meaning:
<Conversation model={selectedModelName} send={submitMessage} />;
```

Borrow `collection.share()` results as readonly when either input is readonly. Construct an owned array for an insertion or removal; do not cast a published array back to mutable.

The complete contracts and examples are in [the authoring guide](authoring.md).

## Validation

| Project                | Validation                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EffectWeb              | 296 unit tests, 9 Rust tests, 49 browser tests; formatting, lint, type checks, browser types, build, clean package consumer, and bundle budgets pass.           |
| TeleVecha              | 346 unit tests, 304 browser tests; formatting, lint, types, E2E types, and build pass.                                                                          |
| LocalChat              | 42 unit tests / 182 assertions, 29 browser tests with 13 existing intentional skips; lint, types, and build pass. Lint reports Effect style warnings.           |
| Inbox                  | 31 unit tests, 37 browser tests; checks and build pass.                                                                                                         |
| SparkSwarm             | 31 unit tests, 9 browser tests; types and build pass.                                                                                                           |
| js-framework-benchmark | Types/build, keyed create/remove/swap checks, and all 13 smoke workloads pass. Smoke uses `WRITE_RESULTS=false`; existing benchmark result files are preserved. |

The last compiler change only adds deferred callback recognition for direct spread literals. All 108 development/production compiler outputs checked across the consumers were byte-identical before and after that change, with no compilation errors.

Two validation setup problems were corrected without weakening tests: an older staged native binary was initially packed, and an install that ignored the lockfile upgraded TeleVecha's Playwright from 1.62.1 to 1.63.0. Local packing now stages the right binary; installation honors the original lockfile. The two TeleVecha cases that failed on the newer browser both passed three consecutive runs after restoring its locked toolchain, followed by a clean 304-test full run.

Final native compiler SHA-256: `2d506b2cfa00df0436ee9abae4442e4fac69a6ae38a7a7e99d9b031e7366316d`. The built binary, staged package, and all five installed consumers match. Runtime and compiler package versions are 0.2.3; reinstalling from the consumers' unchanged manifests restores their declared dependencies.
