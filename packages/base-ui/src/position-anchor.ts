import type { PositionOptions } from './overlay.js';

export function resolvePositionAnchor(
  anchor: PositionOptions['anchor'],
  trigger: Element | undefined,
) {
  const supplied = typeof anchor === 'function' ? anchor() : anchor;
  return (supplied && 'current' in supplied ? supplied.current : supplied) ?? trigger;
}
