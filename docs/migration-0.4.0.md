# Migrating to EffectWeb 0.4.0

0.4.0 changes rendering and asynchronous lifecycle contracts. Upgrade `effectweb`, `@effectweb/compiler`, and `@effectweb/lucide` together, and rebuild any libraries that ship compiled EffectWeb JSX. Keep the Effect peer at `4.0.0-rc.112`. Do not mix 0.3.x compiler output with the 0.4.0 runtime.

## Ordinary view execution

`view(render)` now executes its callback as ordinary JavaScript for each immutable model publication. The compiler lowers JSX syntax and preserves calls, callbacks, local variables, loops, conditionals, and finite recursion. It does not infer a helper's dependencies, memoize results, or rewrite collection methods.

The renderer reconciles the returned content against existing DOM. Rerunning a view does not by itself replace its elements or mounted components. Helpers run again even when only an unrelated model field changes, so move expensive cached projections to an explicit owner boundary. Keep renders free of side effects; use owners, commands, event handlers, and DOM lifetimes for work.

Published plain objects and arrays remain frozen, and `Snapshot<T>` stays recursively readonly. Pass a new immutable value when data changes. Keep external mutable resources in their own lifetime and publish observations into the model.

## Render keyed rows explicitly

Replace JSX-producing `rows.map(render)` calls with `list(rows, render)` wherever rows must keep their identity through filtering, insertion, removal, or reordering:

```tsx
import { collection, list, view } from 'effectweb';

type Todo = { id: string; title: string; done: boolean };
const todos = collection<Todo>((todo) => todo.id);

export const TodoList = view<{ todos: Todo[]; hideDone: boolean }>((model) => {
  const visible = todos.from(model.todos).filter((todo) => !model.hideDone || !todo.done);
  return (
    <ul>
      {list(visible, (todo) => (
        <li>{todo.title}</li>
      ))}
    </ul>
  );
});
```

| Input                              | Identity used by `list`                   |
| ---------------------------------- | ----------------------------------------- |
| `entities(items)`                  | Each item's `id`                          |
| `collection(identity).from(items)` | The declared string or number identity    |
| `sequence(items)`                  | The current position                      |
| An ordinary array                  | The item value or object reference itself |

Duplicate identities throw with their positions. Raw arrays containing repeated primitives or repeated object references need an explicit collection or positional identity. The render callback receives the exact current item; sharing deeply equal replacement objects is an explicit `collection.share` decision at the data owner. Its result is readonly.

Ordinary `Array.map` and `Rows.map` still work as JavaScript operations. They produce arrays whose rendered children are positional. Leave them unchanged for data transformations or intentionally positional presentation. JSX `key` is unsupported on intrinsic elements.

## Call slots and bind child dispatch

`slot(render)` is a typed callback. Invoke it to create content:

```tsx
import { slot, view } from 'effectweb';

export const Panel = view<{ title: string }>((model) => {
  const footer = slot(() => <small>{model.title}</small>);
  return <section>{footer()}</section>;
});
```

`Slot<void>` no longer renders implicitly as `{footer}`. Helpers can return JSX normally; they do not need compiler recognition.

Ordinary component props retain their names and meaning. Use `<ViewBinding view={Child} model={childModel} send={send} />` to supply a reducer view's dispatcher explicitly. Compatible view expressions and aliases work. Define reusable stateful component types outside render callbacks so their identity survives parent updates.

## Keep DOM acquisitions stable

Every view invocation creates fresh inline functions. Because the acquisition function identifies a DOM lifetime, creating `domMount((element) => ...)` inside a view replaces that lifetime on each render. Hoist a fixed mount or use `domBinding(data, acquire)` with a stable acquisition function:

```tsx
import { domBinding, view, type Snapshot } from 'effectweb';

type Props = { onWidth: (width: number) => void };
function observeWidth(element: HTMLElement, input: () => Snapshot<Props>) {
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) input().onWidth(entry.contentRect.width);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

export const Measured = view<Props>((props) => (
  <section use={domBinding(props, observeWidth)}>Content</section>
));
```

The callback reads current input without reacquiring the observer. For integrations that must apply new data immediately, return `{ update, dispose }` from acquisition; the update callback can compare the specific input that controls the resource. An Effect acquisition should stay active for the lifetime and release its resources through finalizers. Return a disposer even for a synchronous acquisition.

Fresh event callbacks also read current data. Changing a callback does not cancel an already running Effect event; a new event with the `replace` policy, removal of the handler, or unmounting does.

## Execute lifecycle Effects

The following former Promise results now use Effect:

- Program `close()`, `awaitIdle()`, and `awaitStopped()`.
- Model owner `close()` and `awaitIdle()`, query cache `close()`, and mounted view `close()`.
- Keyed task `handle.outcome` and `drain()`.
- `close()` on a resource registered with `owner.own(...)`.

Use `yield*` inside Effect code. At an existing Promise boundary, replace `await owner.close()` with `await Effect.runPromise(owner.close())`. JavaScript `await` does not execute an Effect. Creating a close Effect is also lazy; execute it to start closing.

`dispose()` remains synchronous and starts cancellation. `close()` waits for interrupted work and its finalizers before owned dependencies close. `awaitIdle()` waits for work without disposing the owner. Closing a mounted view joins its DOM-owned work; the program supplied to `mountView` remains separately owned.

For a third-party resource with a Promise-based close method, register a disposer and adapt its close explicitly with `fromPromise` or `Effect.tryPromise`. Keep `Effect.runPromise` at the outer integration boundary instead of returning Promises from EffectWeb lifecycle implementations. Queries and loaders already use Effect; `fromPromise` remains available for external libraries.

## Update tooling and build output

Keep `effectweb/valid-view` for JSX syntax diagnostics and `effectweb/query-key` for invalid custom query keys. Remove `effectweb/whole-model-dependency`. Optional `effectweb/render-safety` provides heuristic advice, independently of compilation. `diagnose` reports syntax diagnostics; the separate `lint` API adds optional analysis. The compiler does not prove render purity or reject an otherwise supported JavaScript helper because its behavior is unknown.

The binding inspector reports source expressions and evaluated binding changes. It no longer describes inferred model-field dependencies or cached derivations. Its counts measure binding evaluations, not DOM mutations or the complete cost of a view.

Prefer `@effectweb/lucide/icons/name` imports for fixed icon sets during development. Named root imports still tree-shake in production, but forcing the complete catalogue into Vite's dependency prebundle loads every export and its source maps. Effect subpath imports such as `import * as Effect from 'effect/Effect'` similarly avoid loading the entire root export surface in development.

Rebuild compiled dependencies after upgrading. If a development server retains old optimized output, restart it with Vite's `--force` option. Production bundles use tree shaking; development transfer sizes include additional exports and source maps.
