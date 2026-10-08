// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { component, controllerView } from './component.js';
import {
  block,
  captured,
  markup,
  memoView,
  mount,
  Portal,
  still,
  view,
  type SiteNode,
} from './dom.js';
import { jsx } from './jsx-runtime.js';
import { createModelOwner, modelOwner } from './owner.js';

const mounted = <Model extends object>(
  initial: Model,
  render: (model: Model) => ReturnType<typeof jsx>,
) => {
  const host = document.createElement('div');
  const errors: unknown[] = [];
  // Generic over the model: the unwidened owner keeps `Model` as the published type.
  const owner = createModelOwner<Model, never>(initial);
  const stop = mount(
    host,
    view<Model>((model) => render(model as Model)),
    owner.source,
    { onError: (error) => errors.push(error) },
  );
  return { host, errors, owner, stop };
};

it('memoView renders only when its equality says the model changed', () => {
  let renders = 0;
  const Label = memoView(
    view<{ text: string; revision: number }>((model) => {
      renders++;
      return jsx('p', { children: model.text });
    }),
    (previous, next) => previous.text === next.text,
  );
  const { host, owner, stop } = mounted({ text: 'a', revision: 0 }, (model) =>
    jsx('div', { children: jsx(Label, { text: model.text, revision: model.revision }) }),
  );
  expect(renders).toBe(1);
  // A field the equality ignores does not render the view, although the props differ.
  owner.patch({ revision: 1 });
  expect(renders).toBe(1);
  owner.patch({ text: 'b' });
  expect(renders).toBe(2);
  expect(host.querySelector('p')!.textContent).toBe('b');
  stop.dispose();
  expect(host.childNodes.length).toBe(0);
});

it('a component keeps its state and skips rendering and receive while its props are identical', () => {
  let renders = 0;
  let received = 0;
  const Counter = component<{ label: string }, { count: number }, 'increment'>(
    {
      init: () => ({ count: 0 }),
      receive: (model) => {
        received++;
        return { model };
      },
      update: (model) => ({ model: { ...model, count: model.count + 1 } }),
    },
    view((model, send) => {
      renders++;
      return jsx('button', {
        onClick: () => send('increment'),
        children: `${model.props.label}:${model.count}`,
      });
    }),
  );
  const { host, owner, stop } = mounted({ label: 'a', other: 0 }, (model) =>
    jsx('div', { children: jsx(Counter, { label: model.label }) }),
  );
  const button = host.querySelector('button')!;
  const before = { renders, received };
  owner.patch({ other: 1 });
  expect({ renders, received }).toEqual(before);
  button.dispatchEvent(new Event('click', { bubbles: true }));
  expect(button.textContent).toBe('a:1');
  owner.patch({ label: 'b' });
  expect(received).toBe(before.received + 1);
  expect(button.textContent).toBe('b:1');
  stop.dispose();
});

it('a controller receives props only when one of them changes', () => {
  const received: string[] = [];
  const Panel = controllerView(
    {
      controller: (props: { readonly id: string }) => {
        const owner = modelOwner({ id: props.id });
        return {
          source: owner.source,
          receive: (next: { readonly id: string }) => {
            received.push(next.id);
            owner.patch({ id: next.id });
          },
          lifetime: owner,
        };
      },
    },
    view((model) => jsx('p', { children: model.id })),
  );
  const { host, owner, stop } = mounted({ id: 'one', other: 0 }, (model) =>
    jsx('div', { children: jsx(Panel, { id: model.id }) }),
  );
  const initial = received.length;
  owner.patch({ other: 1 });
  owner.patch({ other: 2 });
  expect(received.length).toBe(initial);
  owner.patch({ id: 'two' });
  expect(received.slice(initial)).toEqual(['two']);
  expect(host.querySelector('p')!.textContent).toBe('two');
  stop.dispose();
});

it('compares props field by field: new JSX children and class instances render again', () => {
  const renders = { wrapper: 0, hoisted: 0, instance: 0 };
  const Wrapper = view<{ children?: ReturnType<typeof jsx> }>((props) => {
    renders.wrapper++;
    return jsx('section', { children: props.children });
  });
  const Hoisted = view<{ children?: ReturnType<typeof jsx> }>((props) => {
    renders.hoisted++;
    return jsx('aside', { children: props.children });
  });
  class Point {
    constructor(readonly x: number) {}
  }
  const Dot = view<Point>((point) => {
    renders.instance++;
    return jsx('i', { children: point.x });
  });
  const fixed = still(markup('b')(null, 'fixed'));
  const { host, owner, stop } = mounted({ label: 'a', other: 0 }, (model) =>
    jsx('div', {
      children: [
        // Markup created during render is a new value on every render.
        jsx(Wrapper, { children: jsx('b', { children: model.label }) }),
        // A hoisted literal element keeps its identity.
        jsx(Hoisted, { children: fixed }),
        // Only plain objects are compared by their fields.
        jsx(Dot, new Point(1) as unknown as Record<string, unknown>),
      ],
    }),
  );
  expect(renders).toEqual({ wrapper: 1, hoisted: 1, instance: 1 });
  owner.patch({ other: 1 });
  expect(renders).toEqual({ wrapper: 2, hoisted: 1, instance: 2 });
  expect(host.querySelector('section b')!.textContent).toBe('a');
  stop.dispose();
});

it('reconciles a block with literal text and a hoisted child against another call site', () => {
  const badge = still(markup('em')({ class: 'badge' }, 'new'));
  const siteA = ['div', null, [badge, 'Name: ', ['b', null, [1]], 1]] as unknown as SiteNode;
  const siteB = ['div', null, [badge, 'Title: ', ['b', null, [1]], 1]] as unknown as SiteNode;
  const a = block(siteA);
  const b = block(siteB);
  const { host, errors, owner, stop } = mounted(
    { wide: false, text: 'x', tail: 't' as unknown },
    (model) => (model.wide ? b(model.text, model.tail) : a(model.text, model.tail)),
  );
  const root = host.querySelector('div')!;
  const [em, bold] = [host.querySelector('em')!, host.querySelector('b')!];
  expect(root.textContent).toBe('newName: xt');
  owner.patch({ wide: true, text: 'y' });
  expect(host.querySelector('div')).toBe(root);
  expect(host.querySelector('em')).toBe(em);
  expect(host.querySelector('b')).toBe(bold);
  expect(root.textContent).toBe('newTitle: yt');
  // The adopted positions keep working: text, then markup, then text again.
  owner.patch({ tail: markup('u')(null, 'mark') });
  expect(root.innerHTML).toContain('<b>y</b><u>mark</u>');
  owner.patch({ wide: false, tail: 'end' });
  expect(root.textContent).toBe('newName: yend');
  expect(errors).toEqual([]);
  stop.dispose();
});

it('runs delegated handlers for content in a portal and inside a shadow root', () => {
  const seen: string[] = [];
  const target = document.createElement('div');
  document.body.append(target);
  const { host, stop } = mounted({}, () =>
    jsx('div', {
      onClick: () => seen.push('outer'),
      children: jsx(Portal, {
        mount: target,
        children: jsx('button', {
          id: 'portalled',
          onClick: (event: Event) => seen.push(`portal:${(event.currentTarget as Element).id}`),
          children: 'open',
        }),
      }),
    }),
  );
  document.body.append(host);
  target.querySelector('button')!.dispatchEvent(new Event('click', { bubbles: true }));
  // The portal's content is outside the mount root in the document, so only its own
  // handler runs.
  expect(seen).toEqual(['portal:portalled']);
  stop.dispose();
  expect(target.querySelector('button')).toBeNull();
  host.remove();
  target.remove();

  const shadowHost = document.createElement('div');
  document.body.append(shadowHost);
  const container = document.createElement('div');
  shadowHost.attachShadow({ mode: 'open' }).append(container);
  const owner = modelOwner({});
  const inShadow = mount(
    container,
    view(() =>
      jsx('button', {
        id: 'shadowed',
        onClick: (event: Event) => seen.push(`shadow:${(event.currentTarget as Element).id}`),
        children: 'x',
      }),
    ),
    owner.source,
  );
  container
    .querySelector('button')!
    .dispatchEvent(new Event('click', { bubbles: true, composed: true }));
  expect(seen).toEqual(['portal:portalled', 'shadow:shadowed']);
  inShadow.dispose();
  shadowHost.remove();
});

it('a function prop marked with its captured values does not render the view again', () => {
  let renders = 0;
  const picked: string[] = [];
  let pick!: () => void;
  const Row = view<{ id: string; onPick: () => void }>((props) => {
    renders++;
    pick = props.onPick;
    return jsx('li', { children: props.id });
  });
  const site = Symbol();
  const other = Symbol();
  const { owner, stop } = mounted({ id: 'a', unrelated: 0, alternate: false }, (model) =>
    jsx('ul', {
      children: jsx(Row, {
        id: 'row',
        // What the compiler emits for onPick={() => picked.push(model.id)}.
        onPick: captured(() => picked.push(model.id), [model.alternate ? other : site, model.id]),
      }),
    }),
  );
  expect(renders).toBe(1);
  owner.patch({ unrelated: 1 });
  expect(renders).toBe(1);
  // A captured value changed: the view runs again and receives the new function.
  owner.patch({ id: 'b' });
  expect(renders).toBe(2);
  pick();
  expect(picked).toEqual(['b']);
  // The same values from another site are a different function.
  owner.patch({ alternate: true });
  expect(renders).toBe(3);
  stop.dispose();
});

it('an unmarked function prop renders the view on every parent render', () => {
  let renders = 0;
  const Row = view<{ onPick: () => void }>(() => {
    renders++;
    return jsx('li', {});
  });
  const { owner, stop } = mounted({ unrelated: 0 }, () =>
    jsx('ul', { children: jsx(Row, { onPick: () => {} }) }),
  );
  owner.patch({ unrelated: 1 });
  expect(renders).toBe(2);
  stop.dispose();
});
