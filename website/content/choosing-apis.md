Four questions decide which API a piece of code needs: how the screen is described, where its state lives, who owns the work it starts, and where its data comes from. Answer the question, then follow the link for the example. Everything here is imported from `effectweb` unless another package is named.

## Describing the screen

| The code…                                                   | Use                                                         | Guide                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Turns inputs into markup and holds no state of its own      | `view((props) => …)`                                        | [Views](/docs/views/)                                       |
| Reports an action to the view that placed it                | a function prop, or `view<Model, Message>` and `send`       | [Views](/docs/views/#telling-the-parent-something-happened) |
| Renders rows that can move, be filtered or hold state       | `list(entities(rows), render)`, `collection` for other keys | [Lists](/docs/lists/)                                       |
| Renders plain values in a fixed order                       | `list(values, render)`                                      | [Lists](/docs/lists/#choosing-a-key)                        |
| Shows a value that changes on its own                       | `observe(source, render)`                                   | [Views](/docs/views/#rendering-from-inputs)                 |
| Shows the state of a request                                | `available`, `resourceError`, `.waiting`                    | [Server data](/docs/queries/#show-the-result)               |
| Must render outside its own element, such as a dialog layer | `<Portal>`                                                  | [DOM](/docs/dom/#render-elsewhere-with-portal)              |

## Where state lives

State belongs to one place on the page when it should disappear with that place. It belongs to a controller when several views read it, when it outlives any one view, or when the logic deserves its own module.

| The state…                                              | Use                                     | Guide                                                             |
| ------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Belongs to one place and changes by writing fields      | `component({ init }, view)`             | [Components](/docs/components/#local-fields)                      |
| Belongs to one place and changes through named messages | `component({ init, update }, view)`     | [Components](/docs/components/#named-messages)                    |
| Is shared by several views or has its own module        | a controller: `modelOwner` plus methods | [Controllers](/docs/controllers/)                                 |
| Is shared, but only while one view is on the page       | `controllerView({ controller }, view)`  | [Controllers](/docs/controllers/#create-a-controller-from-a-view) |
| Is the whole app, as one reducer with commands          | `program({ initial, update })`          | [Components](/docs/components/#named-messages)                    |

## Who owns the work

Work started by a view must belong to something that outlives the event and can interrupt it. The choice depends on what should happen when the same work is started again while it runs, and on whether the view shows its progress.

| The work…                                  | Use                                        | Guide                                                  |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| Is a one-off action and may overlap freely | return the Effect from the event handler   | [Async work](/docs/tasks/#run-an-effect-from-an-event) |
| May be started again while it runs         | `owner.run(key, effect, policy)`           | [Async work](/docs/tasks/#policies)                    |
| Has progress the view shows                | `owner.task(field, effect, policy)`        | [Async work](/docs/tasks/#show-the-status-of-work)     |
| Is started by a pure transition            | commands returned from `update`            | [Components](/docs/components/#named-messages)         |
| Runs separately for each item of a list    | a composite key, `['name', id]`            | [Async work](/docs/tasks/#one-key-per-row)             |
| Must be stopped, or waited for             | `owner.cancel`, `owner.awaitIdle`, `close` | [Async work](/docs/tasks/#wait-for-work-to-finish)     |

## Where data comes from

| The data…                                                  | Use                                               | Guide                                                     |
| ---------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Comes from a server and is read in several places          | `query` and `querySource` from `@effectweb/query` | [Server data](/docs/queries/)                             |
| Comes from a server and a controller follows its arguments | `observeQuery(owner, cache, query, field)`        | [Server data](/docs/queries/#use-a-query-in-a-controller) |
| Must be reloaded after a write                             | `cache.invalidateQuery`, `queryGroup`             | [Server data](/docs/queries/#refresh-after-a-write)       |
| Arrives in pages                                           | `infiniteQuery`, `fetchNextPage`                  | [Server data](/docs/queries/#load-more-pages)             |
| Is behind a Promise-based API                              | `Effect.tryPromise`                               | [Async work](/docs/tasks/#call-a-promise-api)             |
| Is an element, available once it is on the page            | `use={domMount(setup)}`                           | [DOM](/docs/dom/)                                         |
| Flows into a third-party widget and changes over time      | `domBinding(data, setup)`                         | [DOM](/docs/dom/#pass-data-to-a-widget)                   |
| Is an element a controller reads or scrolls                | a `domMount` that stores the element              | [DOM](/docs/dom/#give-a-controller-an-element)            |

## The edges of the app

| Situation                                           | Use                                                       | Guide                                               |
| --------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Starting the app                                    | `makeMount` inside an Effect, `mount` outside one         | [App setup](/docs/services/)                        |
| Effects that need services                          | a `context` option                                        | [App setup](/docs/services/#provide-services)       |
| A view that throws must not take the page down      | `errorBoundary(view, { fallback })`                       | [App setup](/docs/services/#catch-rendering-errors) |
| Testing a view, a transition or a request race      | `renderView`, `controlledEffect` from `effectweb/testing` | [Testing](/docs/testing/)                           |
| Routing, large forms, tables, authentication, icons | the `@effectweb/*` adapter packages                       | [Integrations](/docs/integrations/)                 |

## Import paths

- `effectweb`: everything an application normally needs.
- `effectweb/advanced`: building adapters (`projectionSource`, `shareValue`), custom render comparison (`memoView`) and views loaded on demand (`lazyView`). Use it only when nothing in `effectweb` fits.
- `effectweb/testing`: test helpers.
- `effectweb/dom` is the compiler's output target. Do not import it.
