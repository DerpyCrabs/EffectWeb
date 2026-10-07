import type { JSX, Slot } from 'effectweb';

export function slotTypes(content: Slot<{ title: string }>, footer: Slot) {
  const inferred: Slot<{ title: string }> = (value) => value.title;
  const simple: JSX.Element = (() => 'Footer')();
  const child: JSX.Element = content({ title: 'Typed content' });
  const empty: JSX.Element = footer();
  // @ts-expect-error Parameterized slots need their placement value.
  const missing: JSX.Element = content;
  // @ts-expect-error The slot's parameter is preserved across component props.
  content({ title: 3 });
  return { child, empty, missing, inferred, simple };
}
