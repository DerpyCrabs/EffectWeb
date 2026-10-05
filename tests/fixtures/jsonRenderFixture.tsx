import type { RendererProps } from '../../packages/json-render/src/render';
export const registry: RendererProps['registry'] = {
  Frame: ({ children }) => <div>{children}</div>,
  Input: ({ key }) => <input data-id={key} />,
};

import { Renderer } from '../../packages/json-render/src/render';
import { renderView } from 'effectweb/testing';
export function checkJsonIdentity(host: HTMLElement) {
  const spec = (children: string[]): RendererProps['spec'] => ({
    root: 'root',
    elements: {
      root: { type: 'Frame', props: {}, children },
      a: { type: 'Input', props: {} },
      b: { type: 'Input', props: {} },
    },
  });
  const props: RendererProps = { spec: spec(['a', 'b']), registry, state: {}, dispatch: () => {} };
  const mounted = renderView(host, Renderer, props);
  try {
    const a = host.querySelector<HTMLInputElement>('[data-id=a]')!;
    a.value = 'draft';
    a.focus();
    a.setSelectionRange(1, 3);
    mounted.update({ ...props, spec: spec(['b', 'a']) });
    const reordered = {
      sameNode: host.querySelector('[data-id=a]') === a,
      focused: document.activeElement === a,
      selection: [a.selectionStart, a.selectionEnd],
      otherValue: host.querySelector<HTMLInputElement>('[data-id=b]')!.value,
    };
    mounted.update({ ...props, spec: spec(['a']) });
    return { ...reordered, afterRemoval: host.querySelector('input') === a, value: a.value };
  } finally {
    mounted.dispose();
  }
}
