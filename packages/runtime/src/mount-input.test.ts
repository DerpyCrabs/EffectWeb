// @vitest-environment happy-dom
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { controllerView } from './component.js';
import { mount, view } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';
import { makeMount } from './render.js';

function counterController() {
  const owner = modelOwner({ count: 0 });
  return {
    source: owner.source,
    increment: () => owner.patch({ count: owner.read().count + 1 }),
    lifetime: owner,
    owner,
  };
}

it('mounts a controller with its methods as model.actions, and leaves disposing it to the caller', () => {
  const host = document.createElement('div');
  const counter = counterController();
  const mounted = mount(
    host,
    view((model) =>
      jsx('button', { onClick: () => model.actions.increment(), children: String(model.count) }),
    ),
    counter,
  );
  host.querySelector('button')!.click();
  expect(host.textContent).toBe('1');
  mounted.dispose();
  expect(host.childNodes).toHaveLength(0);
  expect(counter.owner.disposed).toBe(false);
  counter.owner.dispose();
});

it('mounts a view with fixed input, such as a controller view that takes no props', () => {
  const host = document.createElement('div');
  const Greeting = view<{ readonly name: string }>((props) => jsx('p', { children: props.name }));
  const stop = mount(host, Greeting, { name: 'Ada' });
  expect(host.textContent).toBe('Ada');
  stop.dispose();
  const Root = controllerView(
    { controller: (_props: {}) => counterController() },
    view((model) => jsx('b', { children: String(model.count) })),
  );
  const root = mount(host, Root, {});
  expect(host.textContent).toBe('0');
  root.dispose();
});

it('makeMount accepts a controller', async () => {
  const host = document.createElement('div');
  const counter = counterController();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* makeMount(
          host,
          view((model) => jsx('i', { children: String(model.count) })),
          counter,
        );
        counter.increment();
        expect(host.textContent).toBe('1');
      }),
    ),
  );
  expect(host.childNodes).toHaveLength(0);
  counter.lifetime.dispose();
});
