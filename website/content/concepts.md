An EffectWeb app has a simple data flow: an action changes state, and views describe the screen for that state. Effects handle the work between actions, such as loading a document or saving an edit.

## Views describe the screen

A **view** is a function from inputs to JSX. Inputs can include data and callbacks for actions. Views compose through props and children, just like the markup they produce.

A **component** adds local state to a view. Each place it appears gets its own state:

```tsx check
import { component, view } from 'effectweb';

export const Counter = component<{}, { count: number }>(
  { init: () => ({ count: 0 }) },
  view((model, patch) => (
    <button onClick={() => patch({ count: model.count + 1 })}>Count: {model.count}</button>
  )),
);
```

Here, `init` creates the state. Clicking the button calls `patch`, which publishes a new count. The view receives the new model and updates the button. See [Components](/docs/components/) for drafts, dialogs and other local state.

## State lives with the feature

Keep state in a component when it belongs to one place on the page. Use a **controller** when several views share it or the feature’s logic deserves its own module.

A controller is a plain function returning a **source** and actions. The source provides the current state and notifies views when it changes; the actions are methods such as `edit`, `save` or `select`. A **model owner** (`modelOwner`) supplies the state and task management behind it. [Controllers →](/docs/controllers/)

Published data is an immutable snapshot. An edit creates a new value while unchanged data keeps its identity. This makes each update explicit and lets the renderer skip unchanged child inputs.

## Effects do the work

An Effect describes an operation, including its result, errors and required services. An **owner** runs it and manages its lifetime. A component owns its local work; a controller owns work shared by its views.

Give overlapping work a key and a policy: replace an earlier search, ignore duplicate submits, or queue saves. `owner.task` also publishes the result and loading state for the view. Disposing an owner interrupts its work and runs registered cleanup. `controllerView` ties a controller’s lifetime to its place on the page. [Async work →](/docs/tasks/)

For shared server data, the [query package](/docs/queries/) adds caching and refresh state instead of making each feature load its own copy.

## Identity connects updates

A view’s place in the UI determines its local state. In a list, a domain key such as a document ID identifies that place even when rows move. Use `list` to keep focus, drafts and work attached to the right item. [Lists →](/docs/lists/)

## When a view runs again

Changed inputs update the view; unchanged inputs can skip rendering. The [rendering guide](/docs/views/#when-a-view-runs-again) explains comparisons, inline callbacks and list dependencies.

## Snapshot types

`Snapshot<T>` describes published, readonly data. Use it when a helper accepts a view’s model; see [snapshot types](/docs/views/#snapshot-types) for examples.
