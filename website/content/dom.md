Views do not get references to DOM elements. When you need one, to focus an input, measure a box or attach a chart library, attach a setup function to the element with the `use` attribute.

## Run code when an element appears

`domMount(setup)` runs `setup(element)` after the element is added to the page.

```tsx check
import { domMount, view } from 'effectweb';

const autofocus = domMount((element: HTMLInputElement) => element.focus());

export const SearchBox = view<{}>(() => <input use={autofocus} />);
```

The setup can return a cleanup function, which runs when the element is removed. It can also return `{ update?, dispose }` or an Effect, which is interrupted on removal.

Declare the setup at module scope, as above. A setup created inside a view is new on every render, so the element's setup would be torn down and run again on every update (EW3002).

Listeners on `window` or `document` belong in a `domMount` too, so they are removed with the element.

Setup runs in a microtask after the element is inserted. A test that mounts a view and checks the result must wait for that microtask.

## Pass data to a widget

`domBinding(data, setup)` keeps one widget instance while its data changes. The setup receives a function that returns the current data, and returns an `update` method called after each change.

```tsx check
import { domBinding, view, type Snapshot } from 'effectweb';

declare const chart: {
  create: (canvas: HTMLCanvasElement) => {
    draw: (points: readonly number[]) => void;
    destroy: () => void;
  };
}; // @hide

const drawChart = (canvas: HTMLCanvasElement, points: () => Snapshot<readonly number[]>) => {
  const instance = chart.create(canvas);
  instance.draw(points());
  return { update: () => instance.draw(points()), dispose: instance.destroy };
};

export const Chart = view<{ readonly points: readonly number[] }>((props) => (
  <canvas use={domBinding(props.points, drawChart)} />
));
```

## Give a controller an element

When a controller needs an element, for example to scroll a transcript to the bottom, create a handle with `domHandle` and attach `handle.mount` in the view.

```tsx check
import { domHandle, list, sequence, view } from 'effectweb';

const transcript = domHandle<HTMLDivElement>();

export const Transcript = view<{ readonly lines: readonly string[] }>((props) => (
  <div use={transcript.mount}>
    {list(sequence(props.lines), (line) => (
      <p>{line}</p>
    ))}
  </div>
));

export const scrollToEnd = () => {
  const element = transcript.element();
  if (element) element.scrollTop = element.scrollHeight;
};
```

`transcript.element()` is `undefined` until the element is on the page and after it is removed. A handle serves one element at a time.

## Render elsewhere with Portal

`<Portal mount={element}>…</Portal>` renders its children into another element, such as `document.body` for a dialog. The children still belong to the view that renders the portal and are removed with it.

## Native listeners and delegated events

Common bubbling events (click, input, change, keyboard, pointer, mouse, focusin and focusout) are handled by one listener at the mount root. This matters only if you add your own listeners with `addEventListener` inside a `domMount`:

- A native listener on an element runs before the JSX handlers of that element's children, and its `stopPropagation()` stops them.
- A JSX handler's `stopPropagation()` still stops listeners on `document` and `window`.

Capture handlers (`onClickCapture`), non-bubbling events (`onFocus`, `onBlur`, `onScroll`), `onTouchStart`, `onTouchMove` and `on:` custom events are attached to the element itself.
