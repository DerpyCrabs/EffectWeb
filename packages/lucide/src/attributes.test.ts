import { describe, expect, it } from 'vitest';
import { iconAttributes } from './attributes.js';

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
        className: 'second',
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
      class: 'lucide lucide-camera first second',
      onClick,
      'data-state': 'ready',
      'stroke-linecap': 'square',
    });
    for (const name of [
      'size',
      'color',
      'strokeWidth',
      'absoluteStrokeWidth',
      'title',
      'children',
      'className',
    ])
      expect(attrs).not.toHaveProperty(name);
  });
});
