import { Portal } from './dom.js';

export function portalTargets(element: HTMLElement, svg: SVGElement) {
  const defaultTarget = <Portal>Body</Portal>;
  const htmlTarget = <Portal mount={element}>Element</Portal>;
  const svgTarget = <Portal mount={svg}>SVG</Portal>;
  const optionalTarget = <Portal mount={undefined}>Body</Portal>;
  // @ts-expect-error Portal ownership requires an actual target element, not a selector string.
  const invalid = <Portal mount="#menu">Invalid</Portal>;
  // @ts-expect-error A text node cannot contain portal children.
  const text = <Portal mount={element.ownerDocument.createTextNode('text')}>Invalid</Portal>;
  void [defaultTarget, htmlTarget, svgTarget, optionalTarget, invalid, text];
}
