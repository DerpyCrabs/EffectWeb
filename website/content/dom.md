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

## Show the current time

A view must not call `Date.now()`, because nothing would re-render it when time passes (EW1003). Create a clock source once and observe it:

```tsx check
import { clock, observe, view } from 'effectweb';

const minute = clock(60_000);
const ago = (iso: string, now: number) => `${Math.round((now - Date.parse(iso)) / 60_000)} min ago`;

export const Updated = view<{ readonly at: string }>((props) => (
  <time>{observe(minute, (now) => ago(props.at, now))}</time>
));
```

The clock only ticks while something observes it. Event handlers and Effects may read the time directly. `Intl` formatting is fine in a view.

The same pattern works for any value that changes outside the model: `mapSource(source, project)` derives a source from another one. Declare it once, outside the view (EW3004).

## Show live data from a subscription

Some data arrives through a subscription API rather than a request: who is viewing a card, a live price, a presence list. `liveSource` turns such an API into one source per key. A key is subscribed while something on the page observes it, and unsubscribed when the last observer goes away, so the subscription follows what is shown: closing a card's details, or the card being deleted, stops watching it.

```tsx check
import { liveSource, observe, view } from 'effectweb';

declare const watchCard: (id: string, listener: (viewers: string[]) => void) => () => void; // @hide

const viewers = liveSource({
  initial: (_cardId: string): readonly string[] => [],
  subscribe: (cardId, publish) => watchCard(cardId, publish),
});

export const CardDetails = view<{ readonly id: string }>((props) => (
  <p>{observe(viewers(props.id), (names) => `Viewing: ${names.join(', ') || 'nobody'}`)}</p>
));
```

Render the `observe` only while the data is wanted, for example inside `{open ? … : null}`: content that is hidden with CSS or the `hidden` attribute is still on the page and keeps its subscription. Declare the `liveSource` once, at module scope; `viewers(id)` returns the same source for the same key, so calling it while rendering is fine. Equal keys share one subscription. Do not keep your own map of unsubscribe functions in a controller; it is easy to miss a path (the details closing, the item being deleted, the controller closing) and leak subscriptions.

## Native listeners and delegated events

Common bubbling events (click, input, change, keyboard, pointer, mouse, focusin and focusout) are handled by one listener at the mount root. This matters only if you add your own listeners with `addEventListener` inside a `domMount`:

- A native listener on an element runs before the JSX handlers of that element's children, and its `stopPropagation()` stops them.
- A JSX handler's `stopPropagation()` still stops listeners on `document` and `window`.

Capture handlers (`onClickCapture`), non-bubbling events (`onFocus`, `onBlur`, `onScroll`), `onTouchStart`, `onTouchMove` and `on:` custom events are attached to the element itself.
