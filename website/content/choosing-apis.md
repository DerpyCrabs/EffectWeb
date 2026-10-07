Find what you want to do, then follow the link for an example. Everything here is imported from `effectweb` unless another package is named.

## Showing data

| I want to…                                | Use                                      | Guide                                          |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Show some props                           | `view((props) => …)`                     | [Views](/docs/views/)                          |
| Accept children or a render callback      | a `children` prop, a function prop       | [Views](/docs/views/#props-and-children)       |
| Render rows that can change or hold state | `list(entities(rows), render)`           | [Lists](/docs/lists/)                          |
| Render strings or numbers                 | `list(values, render)`                   | [Lists](/docs/lists/#choosing-a-key)           |
| Show loading and error states             | `available`, `resourceError`, `.waiting` | [Server data](/docs/queries/#show-the-result)  |
| Render into another element (overlays)    | `<Portal mount={element}>`               | [DOM](/docs/dom/#render-elsewhere-with-portal) |

## Holding state

| I want to…                                    | Use                                     | Guide                                                             |
| --------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Keep a toggle, draft or tab for one placement | `component({ init }, view)`             | [Components](/docs/components/#local-fields)                      |
| Save or load from a component, with status    | `component({ init }, owner => view(…))` | [Components](/docs/components/#running-effects)                   |
| Write logic as named messages                 | `component({ init, update }, view)`     | [Components](/docs/components/#named-messages)                    |
| Share state between several views             | `modelOwner` with `run` and `task`      | [Controllers](/docs/controllers/)                                 |
| Create a controller from a view's props       | `controllerView({ controller }, view)`  | [Controllers](/docs/controllers/#create-a-controller-from-a-view) |
| Run an app as a reducer with commands         | `program({ initial, update })`          | [Components](/docs/components/#named-messages)                    |

## Running async work

| I want to…                             | Use                             | Guide                                                  |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| Run an Effect when a button is clicked | return it from the handler      | [Async work](/docs/tasks/#run-an-effect-from-an-event) |
| Search as the user types               | a key with the `replace` policy | [Async work](/docs/tasks/#search-as-you-type)          |
| Prevent a double submit                | the `drop` policy               | [Forms](/docs/forms/)                                  |
| Autosave the latest draft              | the `latest-queued` policy      | [Async work](/docs/tasks/#policies)                    |
| Run separate work for each row         | `['name', rowId]`               | [Async work](/docs/tasks/#one-key-per-row)             |
| Call a Promise-based API               | `Effect.tryPromise`             | [Async work](/docs/tasks/#call-a-promise-api)          |

## Server data and forms

| I want to…                         | Use                                               | Guide                                               |
| ---------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| Load and cache server data         | `query` and `querySource` from `@effectweb/query` | [Server data](/docs/queries/)                       |
| Refresh data after saving          | `cache.invalidateQuery`, `queryGroup`             | [Server data](/docs/queries/#refresh-after-a-write) |
| Load more pages                    | `infiniteQuery`, `fetchNextPage`                  | [Server data](/docs/queries/#load-more-pages)       |
| Build a small form                 | controlled inputs and `owner.task`                | [Forms](/docs/forms/)                               |
| Build a large form with validation | `@effectweb/tanstack-form`                        | [Forms](/docs/forms/#large-forms)                   |

## The DOM, the app and tests

| I want to…                                    | Use                                                       | Guide                                               |
| --------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Focus an input or attach a chart library      | `use={domMount(setup)}`, `domBinding`                     | [DOM](/docs/dom/)                                   |
| Let a controller scroll or measure an element | a `domMount` that stores the element                      | [DOM](/docs/dom/#give-a-controller-an-element)      |
| Start the app and provide services            | `makeMount`, a `context` option                           | [App setup](/docs/services/)                        |
| Catch a rendering error                       | `errorBoundary(view, { fallback })`                       | [App setup](/docs/services/#catch-rendering-errors) |
| Add routing                                   | `@effectweb/tanstack-router`                              | [Integrations](/docs/integrations/#routing)         |
| Test a view or a request race                 | `renderView`, `controlledEffect` from `effectweb/testing` | [Testing](/docs/testing/)                           |

## Import paths

- `effectweb`: everything an application normally needs.
- `effectweb/advanced`: building adapters (`projectionSource`, `shareValue`) and custom render comparison (`memoView`) and views loaded on demand (`lazyView`). Use it only when nothing in `effectweb` fits.
- `effectweb/testing`: test helpers.
- `effectweb/dom` is the compiler's output target. Do not import it.
