# Performance regression contracts

Run `npm run test:performance` (Chromium must be installed). Set
`EFFECTWEB_PERFORMANCE_PORT` when the default browser-test port is occupied.
The dedicated command runs a production build; ordinary browser CI runs the
same contracts in development. Both commands are CI gates.

The gates count work, rather than assert machine-dependent millisecond limits:

- 100 equivalent style snapshots: zero CSS property reads/writes after the
  aggregate inline-style check. One changed window-position field: one write. The snapshot
  shortcut still repairs externally changed styles and priorities.
- Repeated class lists: zero redundant additions.
- A small owner patch on a 10,000-field protected record: zero repeated property
  descriptor inspections of that record. Changed nested values still freeze;
  accessor models retain the full traversal.
- Deep snapshot protection: one bookkeeping visit per nested record, preventing
  wide-state optimizations from adding a second traversal/metadata entry per leaf.
- 1, 48, 192 keyed windows: unrelated publications render zero windows;
  100 single-window moves render exactly 100 windows, retain DOM identity,
  and dispose all mounted content.
- 48 windows and 100 focus changes: named snapshot getters, narrow inline getter captures and snapshot
  props render only the 199 affected children. Opaque whole-model helpers remain a
  conservative control (4,800 child renders). Stable
  per-window selected sources also avoid all list-row callbacks, while still
  running 4,800 constant-time projections. Every variant verifies changed data,
  the latest event handler, retained DOM, and disposal. Create selected sources
  outside views; creating them during render defeats their subscription lifetime.
- 48 selected subscribers, with 100 or 10,000 retained records: one shared
  projection per publication, zero notifications for unrelated progress,
  no retained subscriptions after disposal. A whole-state subscriber is an
  intentional positive control: it receives every progress update.

Browser tests attach elapsed update time as JSON for trend inspection. The
production report is saved to `artifacts/performance-results.json` and uploaded
as the `performance-contracts` CI artifact. Do not
compare times from parallel CI workers or treat these synchronous fixture times
as frame latency. For a timing comparison, use the same browser/machine, one
worker, repeated alternating baseline/candidate runs, and no concurrent builds
or tests. Production application measurements remain a separate check: these
contracts deliberately contain no application-specific caches or selectors.

The style semantics test compares transitions against unconditional CSS
application, including overlapping declarations, ordering, removals and invalid
values. Skipping work must preserve those semantics, not just lower counters.
