// @vitest-environment happy-dom
import { expect, test } from 'vite-plus/test';
import { registry } from '../../../tests/fixtures/jsonRenderFixture';
import { renderView } from 'effectweb/testing';
import { Renderer, type RendererProps } from './render.js';

const spec = (children: string[]): RendererProps['spec'] => ({
  root: 'root',
  elements: {
    root: { type: 'Frame', props: {}, children },
    a: { type: 'Input', props: {} },
    b: { type: 'Input', props: {} },
  },
});

test('reordering and removing spec children keeps drafts and focus with element IDs', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const props: RendererProps = { spec: spec(['a', 'b']), registry, state: {}, dispatch: () => {} };
  const mounted = renderView(host, Renderer, props);
  try {
    const a = host.querySelector<HTMLInputElement>('[data-id=a]')!;
    a.value = 'draft for a';
    a.focus();
    mounted.update({ ...props, spec: spec(['b', 'a']) });
    expect(host.querySelector('[data-id=a]')).toBe(a);
    expect(a.value).toBe('draft for a');
    expect(document.activeElement).toBe(a);
    expect(host.querySelector<HTMLInputElement>('[data-id=b]')!.value).toBe('');
    mounted.update({ ...props, spec: spec(['a']) });
    expect(host.querySelector('input')).toBe(a);
    mounted.update({ ...props, spec: spec(['b']) });
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('');
  } finally {
    mounted.dispose();
    host.remove();
  }
});

test('resolves keyed repeats, named slots, and watch actions with current state', async () => {
  const host = document.createElement('div');
  const actions: string[] = [];
  const props: RendererProps = {
    state: { rows: [{ id: 'a' }, { id: 'b' }], country: 'UK' },
    dispatch: (event) => actions.push(String(event.params.country)),
    registry: {
      Frame: ({ children, slots }) => [slots?.title, children],
      Label: ({ props }) => String(props.label),
    },
    spec: {
      root: 'root',
      elements: {
        root: {
          type: 'Frame',
          props: {},
          slots: { title: ['title'] },
          repeat: { statePath: '/rows', key: 'id' },
          children: ['row'],
          watch: { '/country': { action: 'reload', params: { country: { $state: '/country' } } } },
        },
        title: { type: 'Label', props: { label: 'Rows:' } },
        row: { type: 'Label', props: { label: { $item: 'id' } } },
      },
    },
  };
  const app = renderView(host, Renderer, props);
  try {
    expect(host.textContent).toBe('Rows:ab');
    expect(actions).toEqual([]);
    app.update({ ...props, state: { rows: [{ id: 'b' }, { id: 'a' }], country: 'DE' } });
    await Promise.resolve();
    expect(host.textContent).toBe('Rows:ba');
    expect(actions).toEqual(['DE']);
  } finally {
    app.dispose();
  }
});
