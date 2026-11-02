/** HTML elements may belong to a different Window than the UI runtime. */
export function isHTMLElement(element: Element | null): element is HTMLElement {
  return element !== null && element.namespaceURI === 'http://www.w3.org/1999/xhtml';
}
