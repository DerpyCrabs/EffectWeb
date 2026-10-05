A view turns data into JSX. Declare it once with `view` and use it like any JSX component.

```tsx check
import { view } from 'effectweb';

export const Greeting = view<{ readonly name: string }>((props) => <p>Hello, {props.name}</p>);

export const Page = view<{}>(() => <Greeting name="Ada" />);
```

The type argument is the view's input. Inside, use ordinary JavaScript: variables, conditions, helper functions. Call helpers with values from the input.

## Props and children

JSX children arrive as `props.children`. Several children arrive as an array.

```tsx check
import { view, type JSX } from 'effectweb';

export const Card = view<{ readonly title: string; readonly children?: JSX.Element }>((props) => (
  <section class="card">
    <h2>{props.title}</h2>
    {props.children}
  </section>
));

export const Profile = view<{ readonly name: string }>((props) => (
  <Card title="Profile">
    <p>{props.name}</p>
  </Card>
));
```

JSX is a normal value. You can store it in a variable, pass it as any prop (`footer={<button>Save</button>}`), or accept a render function typed as `Slot<A>` and call it: `{props.renderRow(item)}`.

## Attributes

Attributes use their HTML names: `class`, `for`, `tabindex`.

- `class` is a string. `classList={{ active: props.active }}` toggles individual classes and can be used together with `class`.
- `style` is a string or an object. Object keys are camelCase (`marginTop`) or custom properties (`'--gap'`). Numbers get `px`, except unitless properties such as `opacity`, `zIndex` and `lineHeight`.
- Boolean attributes such as `disabled={props.busy}` are added or removed. `aria-*` and `data-*` attributes are written as `"true"` or `"false"`.
- `key`, `ref` and `innerHTML` are not supported. Use [`list`](/docs/lists/) for keys and [`domMount`](/docs/dom/) for element access.

## Events and inputs

Event handlers are ordinary functions. `event.currentTarget` is typed for the element.

For a text field, bind `value` and update it in `onInput`. Checkboxes use `checked` and `onChange`.

```tsx
<input value={model.draft} onInput={(event) => patch({ draft: event.currentTarget.value })} />
```

If the handler rejects or changes the edit, the field shows the value in the model again. For number inputs, `valueAsNumber` is `NaN` when the field is empty.

A handler can also return an Effect to run it; see [Async work](/docs/tasks/#run-an-effect-from-an-event). For a custom element's event, write `on:` followed by the exact event name: `on:valueChanged={…}`.

## Telling the parent something happened

There are two ways for a child view to report an action.

**Callback props** are simplest when there are one or two actions. Pass a controller method, or write the function inline:

```tsx
// parent
<TodoRow todo={todo} onToggle={() => model.actions.toggle(todo.id)} />

// child
<input type="checkbox" checked={props.todo.done} onChange={props.onToggle} />
```

The compiler can compare the captured values of analyzable inline callbacks, so they do not force a child to render on every parent update. See [When a view runs again](#when-a-view-runs-again).

**Messages** suit a child with many actions, or a parent written with [`update`](/docs/components/#named-messages). The view declares a message type as its second type argument and receives `send`:

```tsx check
import { view, ViewBinding, list, entities } from 'effectweb';

type Todo = { readonly id: string; readonly title: string; readonly done: boolean };
type TodoMessage = { type: 'Toggle'; id: string } | { type: 'Rename'; id: string; title: string };

export const TodoRow = view<Todo, TodoMessage>((todo, send) => (
  <li>
    <input
      type="checkbox"
      checked={todo.done}
      onChange={() => send({ type: 'Toggle', id: todo.id })}
    />
    <input
      value={todo.title}
      onInput={(event) => send({ type: 'Rename', id: todo.id, title: event.currentTarget.value })}
    />
  </li>
));

export const TodoList = view<{ readonly todos: readonly Todo[] }, TodoMessage>((model, send) => (
  <ul>
    {list(entities(model.todos), (todo) => (
      <ViewBinding view={TodoRow} model={todo} send={send} />
    ))}
  </ul>
));
```

A view that sends messages is placed with `<ViewBinding view={…} model={…} send={…} />`, so the dispatcher is visible. Writing `<TodoRow … />` directly is a type error.

## Rendering from inputs

A view describes the current screen from its inputs. Put changing values in state or observe a source, such as a [clock](/docs/dom/#show-the-current-time). Reading `Date.now()`, `Math.random()`, storage or mutable globals during rendering does not subscribe to changes. Start work and change state in handlers or controllers, not while rendering. The compiler’s [lint rules](/docs/compiler/#diagnostic-codes) catch common mistakes.

## When a view runs again

The renderer compares what each view receives with what it received last time, using `Object.is`. A view runs again only when:

- its model, or one of its JSX props, is a different value;
- for a row in a [`list`](/docs/lists/), the row’s item changed, an outer value it reads changed, or its index changed and the callback reads that index;
- for `observe(source, …)`, the source published a new value.

This has two consequences.

**Unchanged data is skipped.** If a controller publishes `{ ...model, draft }`, `model.rows` is still the same array, so a `<RowList rows={model.rows} />` child does not run. Rebuilding the array makes `RowList` run and reconcile its list, though rows with unchanged items and dependencies can still be skipped.

**Analyzable inline callbacks can also be skipped.** `onSelect={() => select(row.id)}` creates a new function each time the parent runs, and the compiler can record the values it reads (`select`, `row.id`) to compare them instead. Callbacks it cannot analyze are compared by function identity. An object literal or JSX passed as a prop is still a new value on every render.

Nothing else triggers a render. Changing an object in place, or a variable outside the model, does not update the screen.

## Snapshot types

Data published to views has the type `Snapshot<T>`: `T` made deeply readonly. Use it for parameters that receive published data:

```ts
const total = (rows: Snapshot<readonly Row[]>) => rows.reduce((sum, row) => sum + row.amount, 0);
```

A normal mutable value can be passed where a `Snapshot<T>` is expected, so callers do not need casts. Do not cast the readonly away to call a function that wants mutable data; change the function to accept `Snapshot<T>`. Functions, Effects, dates, DOM nodes and Effect data types such as `Option` are left as they are.
