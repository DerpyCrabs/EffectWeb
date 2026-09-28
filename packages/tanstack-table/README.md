# @effectweb/tanstack-table

EffectWeb lifecycle and observation adapter for `@tanstack/table-core` **v9**. Configure normal TanStack features and options, then call `createTable(options, project)`.

The result exposes `table`, an EffectWeb `source`, and `dispose`. The adapter supplies store reactivity, coalesces publications, copies the projection before protecting it, and releases subscriptions on disposal. Existing snapshots remain immutable while TanStack internals remain mutable.

`project(table)` must return cloneable data only: rows, IDs, primitive cell values and selected state. Never return Table/Row/Column instances, callbacks or stores. Applications keep their APIs, permissions, column/filter descriptions, templates and styles outside this package. TanStack core exports are re-exported for feature configuration; rendering is owned by EffectWeb.
