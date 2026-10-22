Start the existing Vite development command with `EFFECTWEB_PROFILE=1` during an investigation; no application edits are needed. Alternatively enable `effectweb({ profile: true })` in its Vite plugin. An explicit `profile: false` overrides the environment switch. This installs `globalThis.__EFFECTWEB_PROFILE__` in development. Production builds disable the hooks and omit the browser API even when this option is set. No capture runs until requested. Navigate with `?effectweb-profile=1` to start before the application mounts; otherwise use the existing browser automation's evaluate tool:

```js
// Start before the action. DOM API instrumentation is optional and intrusive.
globalThis.__EFFECTWEB_PROFILE__.start({ maxEntries: 500, maxEvents: 2000, dom: true });
```

Perform one realistic action through the application's UI. Then return the report as structured data:

```js
globalThis.__EFFECTWEB_PROFILE__.stop();
```

`snapshot()` reads a detached report without stopping. `run('action name', () => synchronousWork())` adds a named synchronous parent span. It does not track asynchronous work across awaits. Capture a whole interaction using start/stop around browser actions instead. There is one active capture per runtime; starting another throws rather than silently losing the earlier capture. Stop restores DOM instrumentation. Starting again resets aggregates.

## Read the report

`schemaVersion: 1` is the machine-readable contract. `entries` are sorted by synchronous self time and include a site ID, kind, compiler location (file/line/column/expression), calls, errors, unchanged projection outputs, self/inclusive milliseconds, selected DOM API read/write counts, and binding acquisitions/releases. `events` retain spans in entry order, preserving parent ancestry when capped; `complete` distinguishes finished spans from snapshots taken during execution. They link synchronous spans to their parent and name the cause: initial render, changed input fields, source notification, projection input, or binding/measurement lifecycle phase.

- High projection time with many unchanged outputs: select narrower stable inputs before expensive computation. An equality function cannot avoid work already performed.
- Many view updates after one input field changes: inspect the field/captured prop and keyed collection's update boundary. Preserved DOM identity does not guarantee cheap evaluation.
- Many geometry reads after unrelated scrolling: inspect event relevance and owner-scoped measurements.
- Repeated binding acquire/dispose: inspect setup function identity. More acquisitions than releases during a capture is not by itself a leak; the UI may remain mounted, and resources acquired before the capture are excluded.
- Check `droppedEntries` and `droppedEvents` before interpreting missing spans. Limits cap retained aggregates/events; aggregate counts continue when only the event limit is reached. Shorten the scenario or raise limits explicitly (maximum 100000 each).

The profiler stores no models, callback arguments, DOM nodes, or source values. Field-change explanations contain names only and do not invoke getters. Reports still contain source filenames/expressions; treat them like source code when sharing.

## Measurement limits

Development timings include instrumentation and snapshot protection; rerun production benchmarks before claiming a speedup. Inclusive times overlap; self times exclude instrumented child spans. Asynchronous callbacks have no guessed causal parent. A reused callback function aggregates under its first registered source location; it does not distinguish each use of that same function. Unlocated anonymous callbacks are grouped, so use compiler metadata or a named explicit action when attribution is incomplete.

With `dom: true`, counters wrap selected geometry/attribute/style/tree APIs in the current Window. They count calls, including no-op writes and nested implementation calls, not actual mutations, forced layouts, paint or GPU work. Text/property writes and other Windows are not a complete census. Calls outside a synchronous span are reported as unattributed. The profiler leaves a later third-party wrapper intact when stopping instead of overwriting it.

The API is also available from `effectweb/profiling` for custom development harnesses. `startProfile`, `profileSnapshot`, and `stopProfile` return the same contract. Custom bundlers must define `__EFFECTWEB_PROFILE_ENABLED__` as `false` for production, as the Vite plugin does.
