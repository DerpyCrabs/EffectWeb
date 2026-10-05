Test helpers live in `effectweb/testing`. Use Vitest with `happy-dom` for most tests, and a real browser for focus, selection, pointer input and layout. Apply the EffectWeb Vite plugin to test files that contain JSX.

## Test `update` as data

An [`update`](/docs/components/#named-messages) function returns the next model and the commands to run. Call it and check what it returns. No DOM is needed.

## Render a view

`renderView` mounts a view with fixed input, records the messages it sends, and lets you publish new input.

```tsx check
// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { view } from 'effectweb';
import { renderView } from 'effectweb/testing';

const Counter = view<{ count: number }, { type: 'Increment' }>((model, send) => (
  <button onClick={() => send({ type: 'Increment' })}>{model.count}</button>
));

test('records a click and shows new input', () => {
  const parent = document.createElement('div');
  const rendered = renderView(parent, Counter, { count: 0 });
  try {
    parent.querySelector('button')!.click();
    expect(rendered.sent).toEqual([{ type: 'Increment' }]);

    rendered.update({ count: 1 });
    expect(parent.textContent).toBe('1');
  } finally {
    rendered.dispose();
  }
});
```

## Control when a request finishes

`controlledEffect()` creates a fake request that stays pending until you call `succeed`, `fail` or `die`. It also counts how many requests are pending and how many were cancelled. Use it instead of sleeping and hoping the request has finished.

```ts check
import { Effect } from 'effect';
import { modelOwner } from 'effectweb';
import { controlledEffect } from 'effectweb/testing';

export const loadsValue = Effect.gen(function* () {
  const owner = modelOwner({ value: '' });
  const request = controlledEffect<string, Error>();
  try {
    owner.run(
      'load',
      request.effect.pipe(Effect.tap((value) => Effect.sync(() => owner.patch({ value })))),
      'replace',
    );
    yield* Effect.yieldNow; // let the owned fiber start the request

    request.succeed('ready');
    yield* owner.awaitIdle();
    if (owner.read().value !== 'ready') throw new Error('Result was not published');
  } finally {
    owner.dispose();
  }
});
```

To test cancellation, start a second request in the same key, check that the first one was cancelled, then settle the second and check that the old result never appears.

## Wait for the right thing

- `owner.awaitIdle()` waits for an owner's work to finish.
- `close()` waits for teardown, including async finalizers.
- `programDriver(program)` exposes the active keys and `awaitIdle` for message-based programs.

Do not add fixed delays. They make tests slow without proving the work has finished.

Cases worth a browser test: deleting a row above a focused input, reordering a row that is being edited, switching a controller's entity while its request is running, and closing a scope that has async cleanup.
