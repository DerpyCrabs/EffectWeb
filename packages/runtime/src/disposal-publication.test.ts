// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { controllerView } from './component.js';
import { mount, observe, view } from './dom.js';
import { domBinding } from './mount.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';

it('finishes identity replacement before rendering a publication from the old child disposal', () => {
  const route = modelOwner({ id: 'a' });
  const canvas = modelOwner({ revision: 0 });
  const measure = () => {
    canvas.patch({ revision: 1 });
  };
  const measured = domBinding({}, () => {
    measure();
  });
  const created: string[] = [];
  const disposed: string[] = [];
  const errors: unknown[] = [];
  const Card = controllerView(
    {
      controller(props: { id: string }) {
        created.push(props.id);
        if (created.length > 10) throw new Error('Repeated card replacement');
        const owner = modelOwner(props);
        owner.own(() => {
          disposed.push(props.id);
          canvas.patch({ revision: 0 });
        });
        return { source: owner.source, lifetime: owner };
      },
    },
    view(({ id }) => jsx('span', { children: id, use: measured })),
  );
  const Panel = controllerView(
    {
      identity: (props: { id: string }) => props.id,
      controller(props: { id: string }) {
        const owner = modelOwner(props);
        return { source: owner.source, lifetime: owner };
      },
    },
    view(({ id }) => jsx(Card, { id })),
  );
  const host = document.createElement('div');
  const root = mount(
    host,
    view<{ id: string }>(({ id }) => observe(canvas.source, () => jsx(Panel, { id }))),
    route.source,
    { onError: (error) => errors.push(error) },
  );
  route.patch({ id: 'b' });
  expect(errors).toEqual([]);
  expect(created).toEqual(['a', 'b']);
  expect(disposed).toEqual(['a']);
  expect(host.textContent).toBe('b');
  root.dispose();
  expect(disposed).toEqual(['a', 'b']);
  route.dispose();
  canvas.dispose();
});
