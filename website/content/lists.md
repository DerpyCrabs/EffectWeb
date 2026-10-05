Use `list` for every callback that renders JSX, including static and stateless rows. It keys each row by an identity you choose, usually its `id`.

```tsx check
import { view, list, entities } from 'effectweb';

type Task = { readonly id: string; readonly title: string };

export const TaskList = view<{ readonly tasks: readonly Task[] }>((model) => (
  <ul>
    {list(entities(model.tasks), (task) => (
      <li>
        <input value={task.title} />
      </li>
    ))}
  </ul>
));
```

## Why not `.map`

`.map` in JSX matches rows by position. Remove the second row, and the row that was third takes its place on the page, including the second row's focus, unsaved input text, component state and running requests.

`list` matches rows by identity, so each row keeps its own state when others move. Every `.map` callback returning JSX is a lint error (EW3001), including stateless and literal rows. Use `list(values, render)` for scalars. Non-array receivers may suppress `effectweb/identity`; compilation still accepts arrays and fragments.

## Choosing a key

| Rows                                     | Write                                   |
| ---------------------------------------- | --------------------------------------- |
| Objects with an `id` field               | `list(entities(rows), render)`          |
| Objects keyed by another field           | `list(rows, (row) => row.code, render)` |
| Strings or numbers                       | `list(values, render)`                  |
| Objects that are only shown, by position | `list(sequence(rows), render)`          |

Keys must be unique. A duplicate key, or a row passed to `entities` without an `id`, throws an error that names the key.

Never build a key from the index, as in `` (row, index) => `${row.type}-${index}` ``. When a middle row is deleted, the next row takes over its index and its state (EW3006). The one acceptable use is a fallback for rows that do not have an identity yet: `` (row, index) => row.id || `new:${index}` ``.

`sequence` keys by position on purpose. Do not use it for rows with inputs, or for rows filtered with `.filter(…)`, since both need a real key (EW3005).

If several places need the same identity and also share structure between updates, declare it once with `collection((row) => row.code)` and use `list(byCode.from(rows), render)`.

## When rows run again

A row runs again when its item is a different object, when an outer value the row callback reads changes, or when its index changes and the callback reads that index. The compiler records those outer values for inline callbacks. In this example rows run again when `selected` changes, and not on unrelated updates:

```tsx
list(entities(model.rows), (row) => <Row row={row} selected={row.id === model.selected} />);
```

Read only what the row needs. A callback that passes the whole `model` to each row depends on all of it.

## State that outlives a row

Rows come and go as the list changes: a search or filter removes them, paging replaces them, a delete removes one. A row's own state (a [component](/docs/components/) inside the row, its inputs) goes with it. Anything that must survive the row leaving the list belongs in the controller or component that owns the list, keyed by the row's id:

- drafts of edits that are not saved yet (`drafts: Record<string, Draft>`), so they come back when the row does;
- per-row request status (`owner.task(['saving', id], …)`, see [one key per row](/docs/tasks/#one-key-per-row));
- selection and expanded state, if it should persist across searches.

Counts and summaries over that state (for example how many issues have unsaved drafts) are then computed from the controller's records, not from the rows currently shown.
