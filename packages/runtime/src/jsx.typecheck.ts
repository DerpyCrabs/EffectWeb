import type { JSX } from './jsx.js';
import { localComponent } from './component.js';
import { compiled } from './dom.js';

localComponent<{ title: string }, { count: number }>({
  init: () => ({ count: 0 }),
  view: compiled((scope) => {
    scope.send({ count: 1 });
    // @ts-expect-error Parent inputs cannot be patched by local state.
    scope.send({ props: { title: 'changed' } });
    // @ts-expect-error A field patch is typed.
    scope.send({ count: 'wrong' });
    // @ts-expect-error No updater-function convention is needed.
    scope.send((state: { count: number }) => ({ count: state.count + 1 }));
  }),
});
// Keep the JSX authoring contract checked by tsc even when the examples do not use these fields.
export const validButton: JSX.IntrinsicElements['button'] = {
  disabled: true,
  'aria-label': 'Save',
  'data-action': 'save',
  onClickCapture: (event) => event.currentTarget.focus(),
};
// @ts-expect-error Attribute spelling is checked.
export const typo: JSX.IntrinsicElements['button'] = { disabledd: true };
// @ts-expect-error Event names are checked.
export const wrongEvent: JSX.IntrinsicElements['input'] = { onInpt: () => {} };
// @ts-expect-error A button cannot have image source attributes.
export const wrongTag: JSX.IntrinsicElements['button'] = { src: 'image.png' };
// @ts-expect-error Boolean attributes reject arbitrary values.
export const wrongBoolean: JSX.IntrinsicElements['button'] = { disabled: 'yes' };
