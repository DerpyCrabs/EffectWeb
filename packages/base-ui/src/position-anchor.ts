import type { PositionOptions } from './overlay.js';

export function resolvePositionAnchor(
  anchor: PositionOptions['anchor'],
  trigger: Element | undefined,
) {
  const supplied = typeof anchor === 'function' ? anchor() : anchor;
  return (supplied && 'current' in supplied ? supplied.current : supplied) ?? trigger;
}

/** Scrolls outside the anchor and popup ancestry cannot move either box. */
export function scrollAffectsPosition(
  event: Event,
  anchor:
    | Element
    | { getBoundingClientRect(): unknown; contextElement?: Element | undefined }
    | undefined,
  popup: HTMLElement,
): boolean {
  const target = event.target;
  if (!target || !('nodeType' in target) || target.nodeType === 9) return true;
  if (!anchor) return false;
  const context = 'nodeType' in anchor ? anchor : anchor.contextElement;
  if (!context) return true;
  const contains = (element: Element): boolean => {
    for (let node: Node | null = element; node;) {
      if (node === target) return true;
      node =
        ('assignedSlot' in node && (node as Element).assignedSlot) ||
        node.parentNode ||
        ('host' in node ? (node as ShadowRoot).host : null);
    }
    return false;
  };
  return contains(context) || contains(popup);
}
