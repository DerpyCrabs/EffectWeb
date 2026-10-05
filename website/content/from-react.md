EffectWeb uses JSX, but views are plain functions of their input: state and work live in components or controllers rather than hooks. This table maps common React code to its EffectWeb equivalent.

| In React                                 | In EffectWeb                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `useState`                               | [`component({ init }, view((model, patch) => …))`](/docs/components/#local-fields)                                                      |
| `useReducer`                             | [`component({ init, update }, view)`](/docs/components/#named-messages)                                                                 |
| `useEffect` to load data                 | [`query` and `querySource`](/docs/queries/), or a [task](/docs/components/#running-effects)                                             |
| `useEffect` for subscriptions or the DOM | [`use={domMount(setup)}`](/docs/dom/) on the element, or a controller that owns the resource                                            |
| `useMemo`, `useCallback`                 | Compute values in the view; move expensive work into a controller. The compiler can compare dependencies of analyzable inline callbacks |
| `useRef` for an element                  | [`domHandle()`](/docs/dom/#give-a-controller-an-element) with `use={handle.mount}`                                                      |
| `key` on `.map` rows                     | [`list(entities(rows), render)`](/docs/lists/)                                                                                          |
| Context providers                        | Effect services as a [`context` option](/docs/services/#provide-services); plain values through props                                   |
| `<Suspense>`                             | [`available`, `resourceError` and `.waiting`](/docs/queries/#show-the-result)                                                           |
| Error boundaries                         | [`errorBoundary(view, { fallback })`](/docs/services/#catch-rendering-errors)                                                           |
| `dangerouslySetInnerHTML`                | Write to the element in a `domMount`                                                                                                    |
| `className`, `htmlFor`                   | `class`, `for`                                                                                                                          |
| `onChange` on a text input               | `onInput`, reading `event.currentTarget.value`                                                                                          |
| `style={{ width: 10 }}`                  | The same; numbers get `px` except unitless properties such as `opacity`                                                                 |
| Custom hooks (`useSomething`)            | A plain function or a controller. Names starting with `use` are reported by the lint rules                                              |

In EffectWeb, keeping unchanged data as the same object lets child views skip rendering. Inline callbacks can also be compared by their captured values when the compiler can analyze them. See [Core concepts](/docs/concepts/#when-a-view-runs-again) for the rules and limits.
