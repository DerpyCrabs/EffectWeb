// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { list, markup, mountView, view } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';

const mounted = <Model extends object>(
  initial: Model,
  render: (model: Model) => ReturnType<typeof jsx>,
) => {
  const host = document.createElement('div');
  const errors: unknown[] = [];
  const owner = modelOwner(initial);
  const stop = mountView(
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
  stop();
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
  stop();
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
      children: item({
        children: model.fail ? ({ plain: 'object' } as unknown as string) : 'ready',
      }),
    }),
  );
  owner.patch({ fail: true });
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain('in {model.rows} (App.tsx:7:12)');
  stop();
});
