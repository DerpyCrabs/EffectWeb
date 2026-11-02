/** The DOM host owns node construction, including mounts into another realm. */
export function ownerDocument(node: Node): Document {
  return node.nodeType === 9 ? (node as Document) : node.ownerDocument!;
}

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function isFocusable(
  node: Element | null,
): node is Element & { focus(options?: FocusOptions): void } {
  return node !== null && 'focus' in node && typeof node.focus === 'function';
}
