// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { iconAttributes, lucideIcon, type LucideProps } from './attributes.js';
import { Camera } from '@lucide/icons';
import { mount, modelOwner } from 'effectweb';

describe('Lucide SVG props', () => {
  it('defaults to a decorative 24px currentColor outline', () => {
    expect(iconAttributes({}, 'lucide-camera', 24, 24)).toMatchObject({
      width: 24,
      height: 24,
      stroke: 'currentColor',
      fill: 'none',
      'stroke-width': 2,
      'aria-hidden': true,
      class: 'lucide lucide-camera',
    });
  });
  it('labels meaningful icons and permits explicit accessibility overrides', () => {
    for (const props of [
      { title: 'Camera' },
      { 'aria-label': 'Camera' },
      { 'aria-labelledby': 'label' },
    ]) {
      expect(iconAttributes(props, '', 24, 24)).toMatchObject({
        'aria-hidden': undefined,
        role: 'img',
      });
    }
    expect(
      iconAttributes({ title: 'Camera', 'aria-hidden': true, role: 'presentation' }, '', 24, 24),
    ).toMatchObject({ 'aria-hidden': true, role: 'presentation' });
  });
  it('preserves native attributes and handlers, accepts zero, and consumes component options', () => {
    const onClick = () => {};
    const attrs = iconAttributes(
      {
        size: '1em',
        color: 'red',
        strokeWidth: 0,
        width: 40,
        class: 'first',
        onClick,
        title: 'Camera',
        children: 'child',
        absoluteStrokeWidth: true,
        'data-state': 'ready',
        'stroke-linecap': 'square',
      },
      'lucide-camera',
      20,
      30,
    );
    expect(attrs).toMatchObject({
      width: 40,
      height: '1em',
      stroke: 'red',
      'stroke-width': 0,
      viewBox: '0 0 20 30',
      class: 'lucide lucide-camera first',
      onClick,
      'data-state': 'ready',
      'stroke-linecap': 'square',
    });
    for (const name of ['size', 'color', 'strokeWidth', 'absoluteStrokeWidth', 'title', 'children'])
      expect(attrs).not.toHaveProperty(name);
  });
});

it('mounts raw Lucide data and nested shapes without leaking reconciliation keys', () => {
  const Icon = lucideIcon('lucide-camera', 24, 24, [['g', { key: 'group' }, Camera.node]]);
  const props = modelOwner<LucideProps>({});
  const host = document.createElement('div');
  const root = mount(host, Icon, props.source);
  try {
    expect(host.querySelectorAll('g > path, g > circle')).toHaveLength(Camera.node.length);
    expect(host.querySelector('[key]')).toBeNull();
    props.patch({ absoluteStrokeWidth: true });
    for (const shape of host.querySelectorAll('g, path, circle')) {
      expect(shape.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    }
    expect(host.querySelector('[key]')).toBeNull();
  } finally {
    root.dispose();
    props.dispose();
  }
});
