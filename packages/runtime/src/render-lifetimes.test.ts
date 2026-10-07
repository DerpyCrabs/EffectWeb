// @vitest-environment happy-dom
import { Context, Deferred, Effect, Fiber } from 'effect';
import { expect, it } from 'vitest';
import { domMount } from './mount.js';
import { memoView, mount, Portal, view, type View } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { renderView, controlledEffect } from './testing.js';
import { makeMount } from './render.js';
import { modelOwner } from './owner.js';
import { lazyView } from './lazy.js';
import { errorBoundary } from './boundary.js';

it('callback-only mounting trades fresh closures for reacquisition on every input change', async () => {
  let acquisitions = 0;
  let releases = 0;
  const seen: number[] = [];
  const host = document.createElement('div');
  const rendered = renderView(
    host,
    view<{ n: number }>((m) =>
      jsx('button', {
        use: domMount<HTMLButtonElement>((el) => {
          acquisitions++;
          const listener = () => seen.push(m.n);
          el.addEventListener('click', listener);
          return () => {
            releases++;
            el.removeEventListener('click', listener);
          };
        }),
      }),
    ),
    { n: 1 },
  );
  await Promise.resolve();
  host.querySelector('button')!.click();
  rendered.update({ n: 2 });
  await Promise.resolve();
  host.querySelector('button')!.click();
  expect(seen).toEqual([1, 2]);
  expect(acquisitions).toBe(2);
  expect(releases).toBe(1);
  rendered.dispose();
});

it('explicit acquireRelease(mount, close) waits for async DOM finalizers', async () => {
  const gate = Deferred.makeUnsafe<void>();
  let closing = false;
  const definition = view(() =>
    jsx('div', {
      use: domMount(() =>
        Effect.addFinalizer(() =>
          Effect.gen(function* () {
            closing = true;
            yield* Deferred.await(gate);
          }),
        ),
      ),
    }),
  );
  const host = document.createElement('div');
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => mount(host, definition, {})),
          (m) => m.close(),
        );
        yield* Effect.promise(() => Promise.resolve());
      }),
    ),
  );
  await expect.poll(() => closing).toBe(true);
  expect(host.textContent).toBe('');
  Deferred.doneUnsafe(gate, Effect.void);
  await done;
});

it('makeMount provides the same structured completion without hand wiring', async () => {
  const gate = Deferred.makeUnsafe<void>();
  let closing = false;
  const definition = view(() =>
    jsx('div', {
      use: domMount(() =>
        Effect.addFinalizer(() =>
          Effect.gen(function* () {
            closing = true;
            yield* Deferred.await(gate);
          }),
        ),
      ),
    }),
  );
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* makeMount(document.createElement('div'), definition, {});
        yield* Effect.promise(() => Promise.resolve());
      }),
    ),
  );
  await expect.poll(() => closing).toBe(true);
  Deferred.doneUnsafe(gate, Effect.void);
  await done;
});

it('memoView is optional performance policy and an incomplete comparator loses callbacks', () => {
  let calls = 0;
  const seen: string[] = [];
  type Model = { label: string; action: () => void };
  const definition = memoView(
    view<Model>((m) => {
      calls++;
      return jsx('button', { children: m.label, onClick: m.action });
    }),
    (a, b) => a.label === b.label,
  );
  const host = document.createElement('div');
  const rendered = renderView(host, definition, { label: 'same', action: () => seen.push('old') });
  rendered.update({ label: 'same', action: () => seen.push('new') });
  host.querySelector('button')!.click();
  expect(calls).toBe(1);
  expect(seen).toEqual(['old']);
  rendered.dispose();
});

it('Portal moves existing DOM and cleans the remote region with its logical parent', () => {
  const first = document.createElement('div');
  const second = document.createElement('div');
  const host = document.createElement('div');
  const definition = view<{ target: Element; n: number }>((m) =>
    jsx(Portal, { mount: m.target, children: jsx('input', { value: String(m.n) }) }),
  );
  const rendered = renderView(host, definition, { target: first, n: 1 });
  const input = first.querySelector('input');
  rendered.update({ target: second, n: 2 });
  expect(second.querySelector('input')).toBe(input);
  expect(input!.value).toBe('2');
  expect(first.children.length).toBe(0);
  rendered.dispose();
  expect(second.children.length).toBe(0);
});

it('errorBoundary contains update failures that a try/catch around initial mounting misses', async () => {
  const content = view<{ fail: boolean }>((m) => {
    if (m.fail) throw new Error('update');
    return 'ok';
  });
  const protectedView = errorBoundary(content, {
    fallback: view(() => 'fallback'),
    onError: () => {},
  });
  const host = document.createElement('div');
  const rendered = renderView(host, protectedView, { fail: false });
  expect(host.textContent).toBe('ok');
  rendered.update({ fail: true });
  await Promise.resolve();
  expect(host.textContent).toBe('fallback');
  rendered.dispose();
});

it('lazyView resolves with latest props and cancels a removed pending placement', async () => {
  const request = controlledEffect<View<{ n: number }, never>>();
  const definition = lazyView(() => request.effect);
  const host = document.createElement('div');
  const rendered = renderView(host, definition, { n: 1 });
  await expect.poll(request.pending).toBe(1);
  rendered.update({ n: 2 });
  request.succeed(view((m) => String(m.n)));
  await expect.poll(() => host.textContent).toBe('2');
  rendered.dispose();
  const pending = controlledEffect<View<{}, never>>();
  const removed = renderView(
    host,
    lazyView(() => pending.effect),
    {},
  );
  await expect.poll(pending.pending).toBe(1);
  await Effect.runPromise(removed.close());
  expect(pending.canceled()).toBe(1);
  expect(host.textContent).toBe('');
});

it('controlledEffect supports repeat requests where a single Deferred caches the first outcome', async () => {
  const request = controlledEffect<number>();
  const first = Effect.runFork(request.effect);
  await expect.poll(request.pending).toBe(1);
  request.succeed(1);
  expect(await Effect.runPromise(Fiber.join(first))).toBe(1);
  const second = Effect.runFork(request.effect);
  await expect.poll(request.pending).toBe(1);
  request.succeed(2);
  expect(await Effect.runPromise(Fiber.join(second))).toBe(2);
  const cached = Deferred.makeUnsafe<number>();
  Deferred.doneUnsafe(cached, Effect.succeed(1));
  expect(await Effect.runPromise(Deferred.await(cached))).toBe(1);
  expect(await Effect.runPromise(Deferred.await(cached))).toBe(1);
});

it('acquireRelease around mount does not capture application services', async () => {
  const label = Context.Reference<string>('MountLifetime/label', { defaultValue: () => 'default' });
  const seen: string[] = [];
  const definition = view(() =>
    jsx('button', {
      onClick: () =>
        Effect.map(label, (value) => {
          seen.push(value);
        }),
    }),
  );
  for (const scoped of [false, true]) {
    const host = document.createElement('div');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          if (scoped) yield* makeMount(host, definition, {});
          else
            yield* Effect.acquireRelease(
              Effect.sync(() => mount(host, definition, {})),
              (m) => m.close(),
            );
          host.querySelector('button')!.click();
          yield* Effect.promise(() => Promise.resolve());
        }),
      ).pipe(Effect.provideService(label, 'application')),
    );
  }
  expect(seen).toEqual(['default', 'application']);
});

it('plain render functions erase the child update boundary supplied by view', () => {
  let plainCalls = 0;
  let viewCalls = 0;
  const plain = (m: { name: string }) => {
    plainCalls++;
    return jsx('span', { children: m.name });
  };
  const isolated = view<{ name: string }>((m) => {
    viewCalls++;
    return jsx('span', { children: m.name });
  });
  const parent = view<{ name: string; count: number }>((m) =>
    jsx('div', {
      children: [plain({ name: m.name }), jsx(isolated, { name: m.name }), String(m.count)],
    }),
  );
  const rendered = renderView(document.createElement('div'), parent, { name: 'same', count: 1 });
  rendered.update({ name: 'same', count: 2 });
  expect(plainCalls).toBe(2);
  expect(viewCalls).toBe(1);
  rendered.dispose();
});

it('renderView replaces a hand-built owner, dispatch recorder and composite cleanup', async () => {
  const definition = view<{ label: string }, string>((m, send) =>
    jsx('button', { children: m.label, onClick: () => send(m.label) }),
  );
  const host = document.createElement('div');
  const owner = modelOwner({ label: 'first' });
  const sent: string[] = [];
  const mounted = mount(host, definition, {
    ...owner.source,
    send: (message: string) => sent.push(message),
  });
  owner.patch({ label: 'second' });
  host.querySelector('button')!.click();
  expect(sent).toEqual(['second']);
  await Effect.runPromise(mounted.close());
  await Effect.runPromise(owner.close());
  const simple = renderView(host, definition, { label: 'first' });
  simple.update({ label: 'second' });
  host.querySelector('button')!.click();
  expect(simple.sent).toEqual(sent);
  await Effect.runPromise(simple.close());
});
