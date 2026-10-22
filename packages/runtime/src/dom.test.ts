// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { attribute, block, list, markup, mount, still, view, type SiteNode } from './dom.js';
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

it('keeps repeated child placements independent and uses their latest event props', () => {
  const seen: string[] = [];
  const Child = view<{ label: string; choose: (label: string) => void }>((props) =>
    jsx('button', { onClick: () => props.choose(props.label), children: props.label }),
  );
  const first = (label: string) => void seen.push(`first:${label}`);
  const second = (label: string) => void seen.push(`second:${label}`);
  const { host, owner, errors, stop } = mounted({ label: 'left', choose: first }, (model) =>
    jsx('div', {
      children: [
        jsx(Child, { label: model.label, choose: model.choose }),
        jsx(Child, { label: 'right', choose: first }),
      ],
    }),
  );
  const buttons = [...host.querySelectorAll('button')];
  buttons.forEach((button) => button.click());
  owner.patch({ choose: second });
  buttons.forEach((button) => button.click());
  owner.patch({ label: 'updated' });
  buttons.forEach((button) => button.click());
  expect([...host.querySelectorAll('button')]).toEqual(buttons);
  expect(seen).toEqual([
    'first:left',
    'first:right',
    'second:left',
    'first:right',
    'second:updated',
    'first:right',
  ]);
  expect(errors).toEqual([]);
  stop.dispose();
  buttons.forEach((button) => button.click());
  expect(seen).toHaveLength(6);
});

it('reports missing message authority when an untyped caller places a sending child', () => {
  const Child = view<{}, 'press'>((_model, send) =>
    jsx('button', { onClick: () => send('press'), children: 'send' }),
  );
  const { host, errors, stop } = mounted({}, () => jsx(Child, {}));
  host.querySelector('button')!.click();
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain('This view sends messages but has no dispatcher');
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

it('identifies the element and attribute when a DOM attribute value is not scalar', () => {
  const element = document.createElement('button');
  expect(() => attribute(element, 'title', { invalid: true })).toThrow(
    '<button> attribute "title"',
  );
});

it.each(['keydown', 'keyup'] as const)(
  'runs %s handlers before native ancestor listeners',
  (type) => {
    const seen: string[] = [];
    const { host, owner, stop } = mounted({ shield: true }, (model) =>
      jsx('button', {
        [type === 'keydown' ? 'onKeyDown' : 'onKeyUp']: (event: KeyboardEvent) => {
          seen.push('child');
          if (model.shield) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        children: 'record',
      }),
    );
    const ancestor = document.createElement('section');
    host.append(ancestor);
    const button = host.querySelector('button')!;
    ancestor.append(button);
    ancestor.addEventListener(type, () => seen.push('native ancestor'));
    button.dispatchEvent(
      new KeyboardEvent(type, { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(seen).toEqual(['child']);
    owner.patch({ shield: false });
    button.dispatchEvent(
      new KeyboardEvent(type, { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(seen).toEqual(['child', 'child', 'native ancestor']);
    stop.dispose();
    owner.dispose();
  },
);

it('binds later holes after expanding content and skipping static subtrees', () => {
  const site: SiteNode = [
    'section',
    { title: 'static root' },
    [
      1,
      ['aside', null, [['strong', null, ['static']]]],
      ['div', 0, ['before ', 1, ['i', null, ['after']]]],
    ],
  ];
  const compiled = block(site);
  const render = (text: string, expanded: boolean) =>
    compiled(expanded ? [b(null, 'one'), b(null, 'two')] : 'plain', { title: text }, text);
  const { host, owner, errors, stop } = mounted({ text: 'first', expanded: true }, (model) =>
    render(model.text, model.expanded),
  );
  const aside = host.querySelector('aside');
  const tail = host.querySelector('div');
  expect(host.querySelector('section')!.title).toBe('static root');
  expect(texts(host, 'b')).toEqual(['one', 'two']);
  expect(tail!.textContent).toBe('before firstafter');
  owner.patch({ text: 'second', expanded: false });
  expect(host.querySelector('aside')).toBe(aside);
  expect(host.querySelector('div')).toBe(tail);
  expect(tail!.title).toBe('second');
  expect(tail!.textContent).toBe('before secondafter');
  expect(errors).toEqual([]);
  stop.dispose();
});

for (const tracksIndex of [false, true]) {
  it(`preserves row nodes and order across filtering, insertion and reorder (index=${tracksIndex})`, () => {
    const records = Array.from({ length: 8 }, (_, id) => ({ id }));
    const { host, owner, errors, stop } = mounted({ rows: records }, (model) =>
      jsx('ul', {
        children: (
          list as (
            rows: ReturnType<typeof entities<{ id: number }>>,
            render: (row: { id: number }, index: number) => ReturnType<typeof jsx>,
            captures: readonly unknown[],
            indexUsed: boolean,
          ) => ReturnType<typeof jsx>
        )(
          entities(model.rows),
          (row, index) =>
            jsx('li', { 'data-id': row.id, children: tracksIndex ? `${row.id}:${index}` : row.id }),
          [],
          tracksIndex,
        ),
      }),
    );
    const nodes = new Map(
      [...host.querySelectorAll('li')].map((node) => [Number(node.dataset.id), node]),
    );
    for (const ids of [
      [1, 3, 5, 7],
      [3, 7],
      [3, 7, 0],
      [2, 3, 6, 7, 0],
      [0, 7, 6, 3, 2],
      [7, 3],
      [3, 7],
    ]) {
      owner.patch({ rows: ids.map((id) => records[id]!) });
      const rendered = [...host.querySelectorAll('li')];
      expect(rendered.map((node) => Number(node.dataset.id))).toEqual(ids);
      expect(rendered.map((node) => node.textContent)).toEqual(
        ids.map((id, index) => (tracksIndex ? `${id}:${index}` : String(id))),
      );
      for (const node of rendered) {
        const id = Number(node.dataset.id);
        if (nodes.has(id)) expect(node).toBe(nodes.get(id));
      }
      nodes.clear();
      for (const node of rendered) nodes.set(Number(node.dataset.id), node);
    }
    expect(errors).toEqual([]);
    stop.dispose();
  });
}

it('recovers row order after a new row throws during reconciliation', () => {
  const records = Array.from({ length: 4 }, (_, id) => ({ id }));
  const { host, owner, errors, stop } = mounted({ rows: records.slice(0, 3) }, (model) =>
    jsx('ul', {
      children: (
        list as (
          rows: ReturnType<typeof entities<{ id: number }>>,
          render: (row: { id: number }, index: number) => ReturnType<typeof jsx>,
          captures: readonly unknown[],
          indexUsed: boolean,
        ) => ReturnType<typeof jsx>
      )(
        entities(model.rows),
        (row) => {
          if (row.id === 3) throw new Error('cannot render row');
          return jsx('li', { children: row.id });
        },
        [],
        false,
      ),
    }),
  );
  const first = host.querySelectorAll('li')[0];
  const second = host.querySelectorAll('li')[1];
  owner.patch({ rows: [records[1]!, records[0]!, records[3]!] });
  expect(errors).toHaveLength(1);
  owner.patch({ rows: [records[1]!, records[0]!] });
  expect(texts(host, 'li')).toEqual(['1', '0']);
  expect(host.querySelectorAll('li')[0]).toBe(second);
  expect(host.querySelectorAll('li')[1]).toBe(first);
  stop.dispose();
});
