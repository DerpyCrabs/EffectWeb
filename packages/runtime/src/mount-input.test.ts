// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { controllerView } from './component.js';
import { mount, view } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';

function counterController() {
  const owner = modelOwner({ count: 0 });
  return {
    source: owner.source,
    increment: () => owner.patch({ count: owner.read().count + 1 }),
    lifetime: owner,
    owner,
  };
}

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
