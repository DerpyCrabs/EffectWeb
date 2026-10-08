export const reasons = {
  Source:
    'The observation contract: read the current immutable model and subscribe to publications. Adapters implement this so views do not need to understand their mutable stores.',
  ModelFields:
    'The model an owner, component or program publishes for the state it was given: a result field declared with AsyncResult.initial<Value, Error>() holds every outcome, so later successes and failures fit without a type annotation.',
  ModelOwner:
    'The controller contract for immutable reads, field updates, task keys, owned resources, and teardown. Its methods keep work and publication at the same ownership boundary.',
  QueryCache:
    'The cache contract for prefetching, reading, writing, invalidating, canceling and resetting queries. Methods below expose argument-based identity; close waits for teardown.',
  RunPolicy:
    'Choose what a new request does to work already running in its key: replace, drop, queue, latest-queued, or parallel. See the task guide for policy tradeoffs.',
  View: 'A reusable presentation definition with model and message types. A view with a message type is the root of a component, program or mount; a child that needs the dispatcher takes send as a prop.',
  JSX: 'The TypeScript namespace describing renderable elements, intrinsic attributes, native events, and component placement. Use JSX.Element when accepting children.',
  view: 'Define presentation as a pure function of an immutable model and an optional message dispatcher. Use it for reusable UI without allocating state or work during rendering.',
  list: 'Give rows a stable identity so focus, local component state, DOM resources, and running tasks follow the right entity through edits and reordering. Use entities for id fields, an explicit identity function for other keys, or sequence for positional content.',
  observe:
    'Place a Source inside a view and let the renderer own the subscription. Use it for clocks, query results, and projected external state; observations are released when their placement disappears.',
  mount:
    'Attach a view to a DOM parent with its input: a program or other Source (its send receives the view’s messages), or fixed props. Dispose the returned mount; choose makeMount inside an Effect scope.',
  makeMount:
    'Attach a view and register its teardown with the surrounding Effect scope. Use it in an application entry point so interruption also unmounts the UI.',
  Portal:
    'Render children into another DOM element while retaining the originating view lifetime. Use it for overlays or UI that must escape an ancestor’s layout.',
  domMount:
    'Own imperative element setup and cleanup with the element. Declare the setup once outside a view; replacing its identity replaces its lifetime.',
  domBinding:
    'Keep a stable DOM resource while its immutable input changes. The setup receives an input getter; return an update method when a widget needs explicit updates.',
  available:
    'Read the latest successful value, including data retained during a refresh or after a failed refresh. Render it next to resourceError and result.waiting, so old data stays visible.',
  resourceError:
    'Turn a failed AsyncResult into a display message. Use the full Cause when error recovery needs typed detail.',
  errorBoundary:
    'Contain a rendering failure to a view region, report it, and show a fallback. A changed reset value permits a new attempt. Request failures belong in AsyncResult presentation.',
  collection:
    'Declare domain identity once for rows that also need structural sharing or keyed transformations. For a one-off list with a custom key, use list(rows, identity, render).',
  entities:
    'Create keyed rows from values with an id. Use it for editable, reorderable, or filterable entity lists.',
  sequence:
    'Declare that row identity is positional. Use for static or append-only presentation; editable and filtered entity rows need a domain key.',
  component:
    'Own state per UI placement. Pass an owner factory for local fields and Effects, or define pure message transitions.',
  ComponentOwner:
    'The owner passed to a fields component’s view factory: read, patch, run, task, cancel, awaitIdle and own, typed by its local fields. It is a DisposableOwner, so observeQuery and other owned resources work inside a component.',
  controllerView:
    'Create a controller from props, expose its methods as model.actions, and dispose it with the placement. Use when one feature needs named actions, services, and state beyond a local component.',
  modelOwner:
    'Own an immutable model, keyed work, and resources behind named controller methods. Use patch and edit to publish data, run for work and task for work whose AsyncResult the view shows, and dispose or close at the boundary.',
  program:
    'Run a pure message-to-transition function with owned commands. Use when transitions benefit from exhaustive message unions and direct unit tests; pass context when commands require services. Without commands, use modelOwner.',
  mapSource:
    'Derive an observable snapshot from an existing Source. Construct it once outside rendering to preserve subscription identity.',
  clock:
    'Publish time as observable model data. Observe it instead of reading Date.now() while rendering, because a view has no hidden clock dependency.',
  projectionSource:
    'Bridge a mutable external store into immutable snapshots. Project cloneable data, reconcile it if needed, notify changes, and dispose subscriptions with the adapter.',
  protectSnapshot:
    'Freeze adapter-produced data as the runtime freezes published models: in development builds a later mutation throws, production builds return the value unchanged. Copy mutable library-owned objects first; freezing them directly would freeze the upstream store.',
  shareValue:
    'Restore referential identity for unchanged branches in freshly received data. Use at ingestion boundaries when repeated server payloads would otherwise rerender unchanged views.',
  memoView:
    'Supply an explicit equality comparison at a view boundary. Use only when the default identity and shallow-prop comparison does not express the relevant rendering inputs.',
  lazyView:
    'Load a view module through an owned Effect. Use for code splitting with explicit pending and failure presentation; interrupting the wait cannot cancel a browser module download.',
  controlledEffect:
    'Create a request that tests settle explicitly with succeed, fail, or die. Its pending and canceled counters make request races and lifetime behavior observable.',
  renderView:
    'Mount a view for a test with fixed input, publish replacement input, and inspect sent messages. Dispose it after the assertion; use a real browser for focus and layout behavior.',
  query:
    'Define a cached Effect request whose identity contains every argument. Supply services through the cache context so dependency objects cannot become accidental cache keys.',
  queryGroup:
    'Name a family of queries that must become stale together after a write. This makes cross-query invalidation explicit without partial key matching.',
  queryCache:
    'Own shared cached requests, freshness, retention, writes, and invalidation. Pass the Effect Context its loaders need; reuse one cache across related views and close it when its application or session lifetime ends.',
  querySource:
    'Observe a cached query from a view. Equal arguments share the live source and cached result; observing owns the request subscription.',
  observeQuery:
    'Follow query arguments from a controller and publish the AsyncResult into one model field. select changes the request; the owner releases the observation.',
  infiniteQuery:
    'Define paginated cached data with an initial cursor and a next-page rule. Use when page requests share one logical identity and aggregate result.',
  infiniteResource:
    'Give a controller an owned handle to a paginated query. Use its resource operations when loading and retrying pages belongs to named controller actions.',
  fetchNextPage:
    'Extend an infinite query through the cache, keeping page identity and in-flight work coordinated with other observers.',
  compile:
    'Lower JSX to EffectWeb runtime calls and return code, source maps, and diagnostics. Use for build-tool integration; application projects normally use the Vite plugin.',
  diagnose:
    'Inspect compiler correctness diagnostics without emitting code. Parser failures throw; returned diagnostics include locations and remedies.',
  lint: 'Run heuristic authoring diagnostics separately from compilation. These checks suggest safer identity and render patterns without changing JavaScript semantics.',
  effectweb:
    'Integrate the native compiler into Vite before TypeScript JSX transforms and deduplicate the linked runtime and Effect dependency. No Rust installation is needed when a supported native package is available.',
  effectwebLint:
    'Enable the five EffectWeb lint rules as errors and block authored imports of compiler implementation modules. Spread this preset in a JavaScript Oxlint configuration.',
  default:
    'Default plugin or preset entry consumed by the tool named in this module’s import path. Application views do not call it directly.',
  createRouter:
    'Create a TanStack router whose mutable stores publish through the adapter. Matching, route inference, loaders, and search validation remain TanStack responsibilities.',
  mountRouter:
    'Initialize and observe the router in an Effect scope. The returned source provides detached state; closing the scope releases subscriptions and owned history.',
  createLink:
    'Create a typed JSX link for a route tree. The resulting anchor preserves href, middle-click, copy-link, and keyboard semantics while handling ordinary navigation in place.',
  linkTarget:
    'Resolve typed route options to a link target using the same router contract as createLink. Use for custom link presentation that still needs correct route resolution.',
  createForm:
    'Own a TanStack form with immutable values, touched/dirty fields, cancellable async validation and submission status. Validation and submission return Effects.',
  createTable:
    'Own subscriptions to TanStack Table v9 and publish a cloneable data projection. Keep Table, Row, Column, and store instances outside snapshots.',
  mountKeycloak:
    'Initialize an existing Keycloak client and own token-refresh work in an Effect scope. Tokens stay in the SDK; views receive identity, roles, and refresh errors.',
  Renderer:
    'Interpret a JSON UI spec against an application-defined component registry. The application owns state, styling, permissions, and action execution.',
  defineRegistry:
    'Bind catalog component names to typed EffectWeb implementations. This separates the allowed schema from how the application renders and dispatches events.',
  getPointer:
    'Read a value at an upstream JSON pointer path. Use it when interpreting catalog bindings against host-owned state.',
  setPointer:
    'Return an immutable state update at a JSON pointer path. This lets JSON-render actions obey the same snapshot boundary as handwritten views.',
  schema:
    'Define the shape understood by the EffectWeb JSON renderer for upstream catalog construction. Use with defineCatalog before binding components through defineRegistry.',
  isIconName:
    'Validate a dynamic string against the pinned Lucide catalog before choosing an icon to load.',
  loadIcon:
    'Load an icon view as an Effect with a typed IconLoadError. Run it in an existing task lifetime; static per-icon imports are simpler for a fixed toolbar.',
  iconNames:
    'Expose the names in the pinned generated Lucide catalog for validation or an application-owned picker.',
  dynamicIconImports:
    'Expose the low-level lazy import map. Prefer loadIcon for owned Effect error handling; importing this registry makes the full catalog available as lazy chunks.',
  IconLoadError:
    'Carry the failed icon name and original cause through the Effect error channel so the caller can choose a fallback.',
};

Object.assign(reasons, {
  Mounted:
    'The handle returned by a mount. dispose removes the view now; close removes it and waits for owned cleanup, including async finalizers.',
  DomMount:
    'An element-owned acquisition contract with stable identity and current input. Construct it through domMount or domBinding instead of implementing internal acquisition behavior in views.',
  PortalProps:
    'The destination and children contract for Portal. The destination controls physical placement while the originating view retains lifecycle ownership.',
  Rows: 'A row sequence carrying explicit identity. list consumes this contract to preserve resources when entity positions change.',
  Collection:
    'A reusable identity strategy and its row and structural-sharing operations. Use when several transformations must agree on what counts as the same entity.',
  ControllerLifetime:
    'What a placement releases with its controller: the owner it created, or any object with dispose and an optional awaited close. A placement calls dispose on removal and waits for close during awaited teardown.',
  ViewController:
    'The shape of a controller: a source, a lifetime, optional prop reception, and methods. controllerView passes its methods to the view as model.actions, so mutable methods stay out of snapshots.',
  ControllerModel:
    'Infer the model controllerView renders for a controller or factory: its snapshot plus its methods as actions. Use it to type a separately declared presentation view.',
  FieldsPatch:
    'A partial local-state update that excludes the runtime-owned props field. patch updates data; it does not replace parent props.',
  DisposableOwner:
    'The minimal resource-ownership contract: whether the owner is disposed and an own method for attaching resources. Use for helpers that need ownership but not model access.',
  Ownable:
    'A disposable resource or cleanup function accepted by own. It allows subscriptions, caches, and widgets to share one teardown boundary.',
  RunKey:
    'A string, number, or readonly array of those values, compared structurally within one owner or program. Use composite keys such as ["folder-hover", id] for independent work per entity.',
  Command:
    'Owned Effect work returned from a transition: { key, policy, effect }. The Effect succeeds with the next message (build it with Effect.matchCause) or with nothing; its error channel is never. Transitions return commands instead of executing side effects themselves.',
  Program:
    'An observable model with a typed message dispatcher and disposal. Views read the source while events submit messages to its pure update function.',
  RunningProgram:
    'A program with awaited teardown and settlement. Use awaitIdle and close at controller and test boundaries.',
  Send: 'The typed message dispatcher accepted by a view. A message union makes permitted interactions explicit and allows exhaustive update handling.',
  Transition:
    'The output of a pure update: the next model plus optional commands and cancellation requests. This makes state transitions independently testable.',
  OwnedRun:
    "The handle of work an owner has started. Its await Effect yields the run's Exit, as Fiber.await does; ignoring the handle is safe because the work is already running.",
  ProjectionSource:
    'A Source with publication and lifecycle operations for adapter authors. changed schedules projection; start initializes observation; dispose releases the adapter boundary.',
  ShareFields:
    'Per-field structural-sharing strategies for shareValue. Use when a model mixes ordinary immutable fields with collections needing domain-aware reconciliation.',
  LazyViewOptions:
    'The pending and failure views of a deferred view. The lazy placement owns its loading lifetime; the loader runs with the services captured by makeMount.',
  RenderedView:
    'A mounted test view that accepts replacement input and records emitted messages. Dispose it after a test to release DOM resources and event work.',
  Query:
    'An opaque request definition carrying argument, success, error, and service types. It represents a reusable request identity, not one running fetch.',
  QueryKey:
    'The canonical data allowed in query identity: finite scalar values, dense arrays, and plain data objects. Services and mutable SDK objects do not belong here.',
  QueryGroup:
    'A stable group identity shared by related query definitions. Invalidating it marks that family of cached data stale after a mutation.',
  QueryEncoding:
    'The argument-encoding contract for a query. Encoding is optional for plain supported data and required for other representations; it must preserve every identity-relevant argument.',
  QueryCacheOptions:
    'Defaults for unobserved data retention and in-flight request behavior. Per-query unused settings can override the cache-wide choice.',
  QueryResource:
    'A controller-owned query observation. Its methods switch arguments, inspect current results, and refresh data without placing subscriptions inside views.',
  InfiniteData:
    'The immutable aggregate of loaded pages, each with its cursor, plus the next cursor. An undefined next value signals that pagination is complete.',
  InfiniteQuery:
    'A paginated definition tying an aggregate request to page requests and cursor encoding. The shared contract keeps page loads and refreshes consistent.',
  InfiniteResource:
    'A controller query resource extended with loading and seeding pages. It keeps pagination operations under the same owner as selection.',
  LintOptions:
    'Module naming options for authoring checks. Lint is separate from compilation and does not change emitted JavaScript.',
  CompilerOptions:
    'Configure authoring and runtime module names, development instrumentation, and diagnostic reporting. Defaults target the published EffectWeb runtime.',
  CompilerResult:
    'Generated JavaScript, an optional source map, and structured diagnostics. Build tools should surface diagnostics rather than silently discarding them.',
  Diagnostic:
    'An actionable compiler or lint finding with a code, category, severity, source location, and remedy. Locations use one-based lines and UTF-16 columns.',
  EffectwebLint:
    'The shape of the JavaScript Oxlint preset. It includes plugin registration, the five authoring rules, and restricted implementation imports.',
  Route:
    'The upstream route constructor, re-exported as Route. Use it to describe typed params, validated search, loaders, and child routes without creating a second matcher.',
  RootRoute:
    'The upstream root-route constructor. It anchors a TanStack route tree and its shared routing context.',
  redirect:
    'The upstream redirect helper for routing and loader control flow. Its behavior is defined by TanStack Router.',
  notFound:
    'The upstream not-found helper for route and loader control flow. Application code still owns how unmatched or failed route state is presented.',
  createBrowserHistory:
    'Create history connected to the browser address bar through TanStack History. Mount it under the router lifetime so subscriptions are released.',
  createMemoryHistory:
    'Create an in-memory history for isolated navigation and tests. It shares the router contract without reading or changing the browser URL.',
  LinkProps:
    'The route-tree-derived props accepted by createLink. Typed destinations, params, and search values preserve route inference; active controls current-page accessibility.',
  FieldErrors:
    'Map typed deep field paths to validation messages. Returning this from validate connects whole-form validation to individual control presentation.',
  FieldState:
    'A field’s touched and dirty flags and current error. Dirty means edited since reset; absent fields are untouched and pristine.',
  FormSnapshot:
    'Detached values, field errors and touched/dirty metadata, plus validation and submission status. Mutable FormApi state stays inside the adapter.',
  FormOptions:
    'Default values, synchronous and optional Effect-based asynchronous whole-draft validation, an Effect-returning submission, and error presentation.',
  FormController:
    'The form adapter boundary for reading and editing fields, resetting, submitting, and disposing. submit returns an Effect that should run in an application-owned key.',
  TableController:
    'The upstream table API alongside its immutable projected source and disposer. Keep table methods in the controller and render only projected snapshot data.',
  AuthSnapshot:
    'The authentication data safe for views: identity, roles, authenticated state, and refresh errors. Tokens deliberately remain in the SDK.',
  KeycloakClient:
    'The subset of the Keycloak SDK consumed by the adapter. This contract also lets tests supply a controlled client without a real identity server.',
  ActionEvent:
    'An action request emitted by JSON-rendered UI, retaining binding metadata. The host uses it to apply authorization, confirmation, and owned action execution.',
  ComponentRenderProps:
    'Resolved catalog props, children, bindings, loading state, and event emission passed to a registry component. Use it to build typed catalog implementations.',
  ComponentRenderer:
    'The callable presentation contract for one registry component. It renders catalog data through EffectWeb without introducing a separate state system.',
  ComponentRegistry:
    'The mapping from catalog component names to their implementations. Keep this stable and application-owned so allowed UI is explicit.',
  RendererProps:
    'The host contract for rendering a spec: immutable state, registry, dispatch, and optional fallback behavior. The host remains responsible for executing actions.',
  Spec: 'The upstream JSON UI specification contract. Validate or constrain generated specifications against your catalog before giving them application capabilities.',
  UIElement:
    'An upstream element record in a JSON UI spec. The registry resolves its type to an application-provided implementation.',
  LucideIcon:
    'The common callable view type for generated Lucide icons. Use it when accepting an icon view as a prop or storing a loaded view outside model data.',
  LucideProps:
    'The shared Lucide view props: dimensions, strokes, accessibility, native SVG attributes, events, children, and DOM lifetimes.',
  IconName:
    'The exact name union of the pinned generated Lucide catalog, including aliases. isIconName narrows runtime strings to this union.',
  AntDesignIconProps:
    'Shared native SVG and accessibility props for outlined and filled Ant Design icon views. size defaults to 1em.',
  AntDesignIcon:
    'The common view type of generated Ant Design icons. Use it when a component accepts an icon implementation rather than one fixed import.',
  IconNode:
    'The readonly SVG node representation consumed by the Ant Design icon factory. It carries geometry, not a mutable mounted DOM element.',
});
