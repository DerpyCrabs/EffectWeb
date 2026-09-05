# Query ownership and controller tasks

Version 0.2.0 incorporates the changes from the three-consumer audit.

Query notifications now serialize callback-driven changes and stop delivering a superseded result. Subscription setup checks whether selection changed before taking ownership of its cleanup. Reset, disposal, and throwing callbacks have regression coverage. Constructing a query observer no longer invokes application callbacks before the observer has been returned.

The legacy `resource`, `pagedResource`, and `makePagedResource` exports are removed without aliases. Cached selections use query definitions and `queryResource` or `observeQuery`. Pagination uses one reducer, with `pages(definition).create(props)` for controller ownership. Equivalent inputs retain the existing model. Components can still compose the reducer with their own messages.

TeleVecha's wallpaper, chat appearance, wallpaper bytes and bot commands use typed query definitions. Its member list uses controller pagination and clears immediately when the application cache resets. A consumer regression covers clearing successful pages while a continuation is pending, interruption of that continuation, and rejection of its late result.

`defineTasks(owner, definitions)` binds controller actions to the existing owner's task runner. It infers arguments and required Effect services, defers producers until accepted, and preserves shared slots and replace/drop/parallel policies. LocalChat replaces 27 repeated wrappers with declarations. Component task definitions keep their existing interface and inferred result state. The controller overload creates no additional model or lifetime.

This batch does not replace TeleVecha's entire Promise-based UI orchestration. Its remaining composer and application workflows need a separate migration with their optimistic restoration and persistence contracts intact. It also leaves entity-aware sharing and compiler dependency grouping for a measured performance experiment.

Local verification of the framework passed formatting, Oxlint/types, Clippy, 156 unit tests, nine Rust tests, browser type checks, 28 browser tests, and clean packed consumption including the compiler lint plugin and Lucide exports. The bundle budgets pass. LocalChat passed 28 unit and 23 browser tests with 13 existing skips. Inbox passed 21 unit and 37 browser tests in an isolated copy, preserving the live assets.

Summed production JavaScript gzip bytes, measured with Node's default gzip level:

| App       | Before this batch |   After |
| --------- | ----------------: | ------: |
| LocalChat |           100,773 | 100,918 |
| Inbox     |           185,473 | 185,587 |
| TeleVecha |           422,324 | 422,044 |

These small changes are bundle measurements, not rendering-performance claims. The release workflow builds native artifacts on all five supported platforms and publishes through npm trusted publishing. Consumers must install matching 0.2.0 versions after publication; local tarballs are only a pre-release verification step.
