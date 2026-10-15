/** Resolve inherited CSS direction, including the document and nearest dir ancestor. */
export const direction = (element: Element): 'ltr' | 'rtl' =>
  element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl' ? 'rtl' : 'ltr';
/** Convert physical horizontal arrows to logical collection movement. */
export function logicalKey(key: string, element: Element): string {
  if (direction(element) !== 'rtl') return key;
  return key === 'ArrowLeft' ? 'ArrowRight' : key === 'ArrowRight' ? 'ArrowLeft' : key;
}
