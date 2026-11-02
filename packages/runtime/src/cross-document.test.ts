// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { mount, view, list, Portal, block, type SiteNode } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';
import { controllerView } from './component.js';

function documentHost() {
  const browser = new Window({ url: 'https://example.test/desktop' });
  const document = browser.document as unknown as Document;
  const root = document.createElement('main');
  document.body.append(root);
  return { document, root };
}

it('creates dynamic nodes, templates and list markers in each owning document', () => {
  const first = documentHost(),
    second = documentHost();
  const errors: unknown[] = [];
  const owner = modelOwner({ rows: ['a', 'b'], text: 'initial' });
  const site: SiteNode = ['section', { class: 'static' }, [['span', null, ['shared']], 1]];
  const template = block(site);
  const definition = view<{ rows: string[]; text: string }>((model) =>
    jsx('div', {
      children: [template(model.text), list(model.rows, (row) => jsx('p', { children: row }))],
    }),
  );
  const traps = ['createElement', 'createTextNode', 'createComment', 'createDocumentFragment'].map(
    (method) =>
      vi.spyOn(document, method as 'createElement').mockImplementation(() => {
        throw new Error('ambient document used');
      }),
  );
  const a = mount(first.root, definition, owner.source, { onError: (error) => errors.push(error) });
  const b = mount(second.root, definition, owner.source, {
    onError: (error) => errors.push(error),
  });
  try {
    expect(errors).toEqual([]);
    expect(first.root.textContent).toBe('sharedinitialab');
    expect(second.root.textContent).toBe('sharedinitialab');
    owner.patch({ rows: ['b', 'c', 'a'], text: 'updated' });
    expect(first.root.textContent).toBe('sharedupdatedbca');
    expect(second.root.textContent).toBe('sharedupdatedbca');
    a.dispose();
    owner.patch({ rows: [], text: 'survivor' });
    expect(first.root.textContent).toBe('');
    expect(second.root.textContent).toBe('sharedsurvivor');
    expect(errors).toEqual([]);
    for (const node of second.root.querySelectorAll('*'))
      expect(node.ownerDocument).toBe(second.document);
  } finally {
    a.dispose();
    b.dispose();
    owner.dispose();
    traps.forEach((trap) => trap.mockRestore());
  }
});

it('default portals use the document of their placement', () => {
  const first = documentHost(),
    second = documentHost();
  const owner = modelOwner({ text: 'popup' });
  const definition = view<{ text: string }>((model) =>
    jsx(Portal, { children: jsx('aside', { children: model.text }) }),
  );
  const a = mount(first.root, definition, owner.source);
  const b = mount(second.root, definition, owner.source);
  try {
    expect(first.document.querySelector('aside')?.textContent).toBe('popup');
    expect(second.document.querySelector('aside')?.textContent).toBe('popup');
    expect(document.querySelector('aside')).toBeNull();
    a.dispose();
    owner.patch({ text: 'still mounted' });
    expect(first.document.querySelector('aside')).toBeNull();
    expect(second.document.querySelector('aside')?.textContent).toBe('still mounted');
  } finally {
    a.dispose();
    b.dispose();
    owner.dispose();
  }
});

it('controllers capture their host once and keep it across asynchronous work', async () => {
  const first = documentHost(),
    second = documentHost();
  const pending: Promise<void>[] = [];
  const captured: Document[] = [],
    closed: Document[] = [];
  const definition = controllerView(
    {
      controller(_props: {}, host) {
        const owner = modelOwner({ text: 'mounted' });
        pending.push(
          Promise.resolve().then(() => {
            captured.push(host.document);
          }),
        );
        return {
          source: owner.source,
          lifetime: {
            dispose() {
              closed.push(host.document);
              owner.dispose();
            },
          },
        };
      },
    },
    view<{ text: string }>((model) => jsx('p', { children: model.text })),
  );
  const a = mount(first.root, definition, {});
  const b = mount(second.root, definition, {});
  await Promise.all(pending);
  expect(captured).toEqual([first.document, second.document]);
  a.dispose();
  expect(closed).toEqual([first.document]);
  expect(second.root.textContent).toBe('mounted');
  b.dispose();
  expect(closed).toEqual([first.document, second.document]);
});
