// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { block, list, markup, mount, still, view, type SiteNode } from './dom.js';
import { entities } from './collection.js';
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
const texts = (host: Element, selector: string) =>
  [...host.querySelectorAll(selector)].map((node) => node.textContent);

it('renders repeated values of a plain array and keeps each occurrence mounted', () => {
  const { host, errors, owner, stop } = mounted({ tags: ['a', 'b'] }, (model) =>
    jsx('ul', { children: list(model.tags, (tag) => jsx('li', { children: tag })) }),
  );
  const first = host.querySelector('li');
  owner.patch({ tags: ['a', 'b', 'a', 'a'] });
  expect(texts(host, 'li')).toEqual(['a', 'b', 'a', 'a']);
  const repeated = host.querySelectorAll('li')[2];
  owner.patch({ tags: ['b', 'a', 'a'] });
  expect(texts(host, 'li')).toEqual(['b', 'a', 'a']);
  expect(host.querySelectorAll('li')[1]).toBe(first);
  expect(host.querySelectorAll('li')[2]).toBe(repeated);
  expect(errors).toEqual([]);
  stop.dispose();
  expect(host.childNodes.length).toBe(0);
});

it('applies a control value after the attributes that constrain it', () => {
  const { host, owner, stop } = mounted({ value: 'b', multiple: false }, (model) =>
    jsx('div', {
      children: [
        jsx('input', { value: model.value, type: 'text', maxlength: 4 }),
        jsx('input', { checked: true, type: 'checkbox' }),
      ],
    }),
  );
  const [text, checkbox] = [...host.querySelectorAll('input')];
  expect(text!.value).toBe('b');
  expect(text!.getAttribute('type')).toBe('text');
  expect(checkbox!.checked).toBe(true);
  owner.patch({ value: 'c' });
  expect(text!.value).toBe('c');
  stop.dispose();
});

it('names the failing binding when development metadata is present', () => {
  const location = {
    file: 'App.tsx',
    line: 7,
    column: 12,
    expression: 'model.rows',
    dependencies: [],
  };
  const item = markup('li', { children: location });
  const { errors, owner, stop } = mounted({ fail: false }, (model) =>
    jsx('ul', {
      children: item(null, model.fail ? ({ plain: 'object' } as unknown as string) : 'ready'),
    }),
  );
  owner.patch({ fail: true });
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain('in {model.rows} (App.tsx:7:12)');
  stop.dispose();
});

it('appends px to numeric lengths and leaves unitless properties and custom properties alone', () => {
  const { host, stop } = mounted({ width: 10 }, (model) =>
    jsx('div', {
      style: {
        width: model.width,
        opacity: 0.5,
        lineHeight: 1.5,
        '--gap': 4,
        zIndex: 2,
        marginTop: 0,
        flexGrow: 1,
      },
    }),
  );
  const style = host.querySelector('div')!.style;
  expect(style.getPropertyValue('width')).toBe('10px');
  expect(style.getPropertyValue('opacity')).toBe('0.5');
  expect(style.getPropertyValue('line-height')).toBe('1.5');
  expect(style.getPropertyValue('--gap')).toBe('4');
  expect(style.getPropertyValue('z-index')).toBe('2');
  expect(['0', '0px']).toContain(style.getPropertyValue('margin-top'));
  expect(style.getPropertyValue('flex-grow')).toBe('1');
  stop.dispose();
});

it('listens for custom events by their exact name through on: attributes', () => {
  const seen: string[] = [];
  const { host, stop } = mounted({}, () =>
    jsx('my-element', {
      'on:valueChanged': (event: Event) => {
        seen.push(event.type);
      },
      onClick: (event: Event) => {
        seen.push(event.type);
      },
    }),
  );
  const element = host.querySelector('my-element')!;
  element.dispatchEvent(new Event('valueChanged'));
  element.dispatchEvent(new Event('valuechanged'));
  // A non-bubbling synthetic click still reaches the handler of the element it targets.
  element.dispatchEvent(new Event('click'));
  expect(seen).toEqual(['valueChanged', 'click']);
  stop.dispose();
  element.dispatchEvent(new Event('valueChanged'));
  expect(seen).toEqual(['valueChanged', 'click']);
});

it('names a second runtime copy when its JSX reaches this renderer', () => {
  const foreign = { definition: { mount() {} }, value: 'other copy' };
  const { errors, owner, stop } = mounted({ show: false }, (model) =>
    jsx('div', { children: model.show ? (foreign as unknown as string) : 'ready' }),
  );
  owner.patch({ show: true });
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain('second copy of effectweb');
  stop.dispose();
});

it('conservatively reruns shifted rows for callbacks without compiler metadata', () => {
  const renders: string[] = [];
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  // Declared once: an inline closure is new on every parent render and reruns its rows anyway.
  const indexed = (row: { id: string }, index: number) => {
    renders.push(`${row.id}:${index}`);
    return jsx('li', { children: row.id });
  };
  const plain = (row: { id: string }) => {
    renders.push(row.id);
    return jsx('li', { children: row.id });
  };
  const byIndex = mounted({ rows }, (model) =>
    jsx('ul', { children: list(entities(model.rows), indexed) }),
  );
  const byRow = mounted({ rows }, (model) =>
    jsx('ul', { children: list(entities(model.rows), plain) }),
  );
  renders.length = 0;
  byIndex.owner.patch({ rows: rows.slice(1) });
  expect(renders).toEqual(['b:0', 'c:1']);
  renders.length = 0;
  byRow.owner.patch({ rows: rows.slice(1) });
  expect(renders).toEqual(['b', 'c']);
  expect(texts(byRow.host, 'li')).toEqual(['b', 'c']);
  byIndex.stop.dispose();
  byRow.stop.dispose();
});

it('shares one hoisted static element between roots and survives disposing one of them', () => {
  const item = markup('li')(null, 'static');
  const first = mounted({ n: 1 }, (model) => jsx('ul', { children: [item, model.n] }));
  const second = mounted({ n: 1 }, (model) => jsx('ul', { children: [item, model.n] }));
  expect(texts(first.host, 'li')).toEqual(['static']);
  expect(texts(second.host, 'li')).toEqual(['static']);
  first.stop.dispose();
  second.owner.patch({ n: 2 });
  expect(texts(second.host, 'li')).toEqual(['static']);
  expect(second.host.textContent).toContain('2');
  expect(second.errors).toEqual([]);
  second.stop.dispose();
});

// Call-site blocks: the compiler records each element tree's static shape and passes only the
// values of its dynamic positions.
const b = markup('b');
const blockSite = [
  'ul',
  null,
  [
    ['li', 0, ['Name: ', 1, ['b', null, [1]]]],
    ['li', null, [1]],
  ],
] as const;
const blockRoot = block(blockSite as unknown as SiteNode);
const rows = (model: { cls: string; name: string; count: number; extra: unknown }) =>
  blockRoot({ class: model.cls }, model.name, model.count, model.extra);

it('clones a call site once and updates only its dynamic positions', () => {
  const { host, errors, owner, stop } = mounted(
    { cls: 'a', name: 'Ada', count: 1, extra: 'x' as unknown },
    rows,
  );
  expect(host.innerHTML).toContain('<li class="a">Name: Ada<b>1</b></li><li>x</li>');
  const [first, second] = [...host.querySelectorAll('li')];
  const bold = host.querySelector('b');
  owner.patch({ cls: 'z', name: 'Bob', count: 2, extra: null });
  expect(first!.outerHTML).toBe('<li class="z">Name: Bob<b>2</b></li>');
  expect(second!.textContent).toBe('');
  // A dynamic position can hold markup, and go back to text, without disturbing its siblings.
  owner.patch({ extra: b(null, 'nested') });
  expect(second!.innerHTML).toBe('<b>nested</b>');
  owner.patch({ extra: 'plain' });
  expect(second!.textContent).toBe('plain');
  expect(host.querySelectorAll('li')[0]).toBe(first);
  expect(host.querySelector('b')).toBe(bold);
  expect(errors).toEqual([]);
  stop.dispose();
  expect(host.childNodes.length).toBe(0);
});

it('reconciles markup from another call site in place, keeping nodes, drafts and handlers', () => {
  const clicks: string[] = [];
  const siteA = [
    'div',
    null,
    [
      ['input', 0, []],
      ['b', null, [1]],
    ],
  ] as unknown as SiteNode;
  const siteB = [
    'div',
    null,
    [
      ['input', 0, []],
      ['b', null, ['Label: ', 1]],
    ],
  ];
  const rootA = block(siteA);
  const rootB = block(siteB as unknown as SiteNode);
  const { host, errors, owner, stop } = mounted({ wide: false, label: 'one' }, (model) =>
    model.wide
      ? rootB({ placeholder: 'wide', onClick: () => clicks.push('wide') }, model.label)
      : rootA({ placeholder: 'narrow', onClick: () => clicks.push('narrow') }, model.label),
  );
  const root = host.querySelector('div')!;
  const field = host.querySelector('input')!;
  const bold = host.querySelector('b')!;
  field.value = 'draft';
  field.click();
  // Another site with the same tags: every element is kept and reconciled in place.
  owner.patch({ wide: true, label: 'two' });
  expect(host.querySelector('div')).toBe(root);
  expect(host.querySelector('input')).toBe(field);
  expect(host.querySelector('b')).toBe(bold);
  expect(field.value).toBe('draft');
  expect(field.getAttribute('placeholder')).toBe('wide');
  expect(bold.textContent).toBe('Label: two');
  field.click();
  owner.patch({ wide: false, label: 'three' });
  expect(host.querySelector('input')).toBe(field);
  expect(host.querySelector('b')).toBe(bold);
  expect(bold.textContent).toBe('three');
  field.click();
  owner.patch({ label: 'four' });
  expect(bold.textContent).toBe('four');
  expect(clicks).toEqual(['narrow', 'wide', 'narrow']);
  expect(errors).toEqual([]);
  stop.dispose();
  field.click();
  expect(clicks).toHaveLength(3);
});

it('reports a failing dynamic position in a block and keeps its siblings current', () => {
  const { host, errors, owner, stop } = mounted(
    { cls: 'a', name: 'Ada', count: 1, extra: 'x' as unknown },
    rows,
  );
  owner.patch({ name: 'Bob', extra: { plain: 'object' } });
  expect(errors).toHaveLength(1);
  expect(host.querySelector('li')!.textContent).toBe('Name: Bob1');
  owner.patch({ extra: 'recovered' });
  expect(host.querySelectorAll('li')[1]!.textContent).toBe('recovered');
  stop.dispose();
});

it('bakes hoisted static children into a block and keeps the SVG namespace', () => {
  const circle = still(markup('circle')({ r: '5' }));
  const site = ['svg', null, [circle, ['text', null, [1]]]] as unknown as SiteNode;
  const root = block(site);
  const { host, owner, stop } = mounted({ label: 'a' }, (model) => root(model.label));
  const svg = host.querySelector('svg')!;
  expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(svg.querySelector('circle')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(svg.querySelector('circle')!.getAttribute('r')).toBe('5');
  owner.patch({ label: 'b' });
  expect(svg.querySelector('text')!.textContent).toBe('b');
  stop.dispose();
});

it('delegates bubbling events in bubble order with the element as currentTarget', () => {
  const seen: string[] = [];
  const outside: string[] = [];
  const onDocument = () => outside.push('document');
  document.addEventListener('click', onDocument);
  const { host, owner, stop } = mounted({ shield: false }, (model) =>
    jsx('section', {
      id: 'outer',
      onClick: (event: Event) => {
        seen.push(`outer:${(event.currentTarget as Element).id}:${event.eventPhase}`);
      },
      children: jsx('button', {
        id: 'inner',
        onClick: (event: Event) => {
          seen.push(`inner:${(event.currentTarget as Element).id}:${event.eventPhase}`);
          if (model.shield) event.stopPropagation();
        },
        children: 'go',
      }),
    }),
  );
  document.body.append(host);
  const button = host.querySelector('button')!;
  button.click();
  expect(seen).toEqual(['inner:inner:2', 'outer:outer:3']);
  expect(outside).toEqual(['document']);
  // Stopping propagation keeps the event from ancestors and from document listeners.
  owner.patch({ shield: true });
  button.click();
  expect(seen).toEqual(['inner:inner:2', 'outer:outer:3', 'inner:inner:2']);
  expect(outside).toEqual(['document']);
  stop.dispose();
  button.click();
  expect(seen).toHaveLength(3);
  document.removeEventListener('click', onDocument);
  host.remove();
});

it('runs each delegated handler once when one mount is nested inside another', () => {
  const seen: string[] = [];
  const outer = mounted({}, () =>
    jsx('div', { id: 'slot', onClick: () => void seen.push('outer') }),
  );
  const inner = mount(
    outer.host.querySelector('#slot')!,
    view<{ label: string }>(() => jsx('button', { onClick: () => void seen.push('inner') })),
    modelOwner({ label: 'x' }).source,
  );
  outer.host.querySelector('button')!.click();
  expect(seen).toEqual(['inner', 'outer']);
  inner.dispose();
  outer.stop.dispose();
});

it('mounts a block element by element when part of its tree cannot be cloned', () => {
  // A custom element is never cloned, so the tree is created per element; nested shapes
  // still receive their own values.
  const custom = still(markup('x-badge')({ tone: 'info' }));
  const site = ['div', 0, [custom, ['p', null, ['Hello ', 1]], 1]] as unknown as SiteNode;
  const root = block(site);
  const { host, errors, owner, stop } = mounted({ cls: 'a', name: 'Ada', tail: 'x' }, (model) =>
    root({ class: model.cls }, model.name, model.tail),
  );
  expect(host.innerHTML).toContain(
    '<div class="a"><x-badge tone="info"></x-badge><p>Hello Ada</p>x</div>',
  );
  const paragraph = host.querySelector('p');
  owner.patch({ cls: 'b', name: 'Bob', tail: 'y' });
  expect(host.innerHTML).toContain(
    '<div class="b"><x-badge tone="info"></x-badge><p>Hello Bob</p>y</div>',
  );
  expect(host.querySelector('p')).toBe(paragraph);
  expect(errors).toEqual([]);
  stop.dispose();
});

it('skips a child view whose props have identical fields, and renders it when one changes', () => {
  let renders = 0;
  const Child = view<{ rows: readonly number[]; label: string }>((props) => {
    renders++;
    return jsx('p', { children: `${props.label}:${props.rows.length}` });
  });
  const { host, owner, stop } = mounted({ rows: [1, 2], label: 'n', other: 0 }, (model) =>
    jsx('div', { children: jsx(Child, { rows: model.rows, label: model.label }) }),
  );
  expect(renders).toBe(1);
  owner.patch({ other: 1 });
  expect(renders).toBe(1);
  owner.patch({ label: 'm' });
  expect(renders).toBe(2);
  expect(host.querySelector('p')!.textContent).toBe('m:2');
  owner.patch({ rows: [1, 2, 3] });
  expect(host.querySelector('p')!.textContent).toBe('m:3');
  stop.dispose();
});

it('reruns list rows only when a captured value changes', () => {
  let renders = 0;
  const { host, owner, stop } = mounted(
    { rows: [{ id: 1 }, { id: 2 }], selected: 1, other: 0 },
    (model) =>
      jsx('ul', {
        children: (list as (...input: unknown[]) => ReturnType<typeof jsx>)(
          entities(model.rows),
          (row: { id: number }) => {
            renders++;
            return jsx('li', { class: row.id === model.selected ? 'on' : '', children: row.id });
          },
          // What the compiler appends for this callback.
          [model.selected],
        ),
      }),
  );
  expect(renders).toBe(2);
  owner.patch({ other: 1 });
  expect(renders).toBe(2);
  owner.patch({ selected: 2 });
  expect(renders).toBe(4);
  expect(host.querySelector('.on')!.textContent).toBe('2');
  owner.patch({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  expect(texts(host, 'li')).toEqual(['1', '2', '3']);
  stop.dispose();
});

it('reaches handlers on disabled controls for movement, and keeps touch moves on the element', () => {
  const seen: string[] = [];
  const { host, stop } = mounted({}, () =>
    jsx('button', {
      disabled: true,
      onClick: () => seen.push('click'),
      onPointerOver: () => seen.push('over'),
      onTouchMove: () => seen.push('touch'),
      children: 'x',
    }),
  );
  document.body.append(host);
  const button = host.querySelector('button')!;
  button.dispatchEvent(new Event('pointerover', { bubbles: true }));
  button.dispatchEvent(new Event('click', { bubbles: true }));
  // A touch move that does not bubble only reaches a listener on the element itself.
  button.dispatchEvent(new Event('touchmove'));
  expect(seen).toEqual(['over', 'touch']);
  stop.dispose();
  host.remove();
});
