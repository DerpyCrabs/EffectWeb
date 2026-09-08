import type { JSX } from './jsx.js';

type DeclaredEvents = keyof JSX.Events<HTMLElement> extends `on${infer Name}`
  ? Lowercase<Name>
  : never;
type MissingNativeEvents = Exclude<keyof HTMLElementEventMap, DeclaredEvents | `webkit${string}`>;
// Catch omissions when the supported DOM library adds another standard element event.
export const completeElementEvents: MissingNativeEvents extends never ? true : false = true;

const mouseClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => {};
export const compatibleClick: JSX.IntrinsicElements['button'] = { onClick: mouseClick };
export const pointerClick: JSX.IntrinsicElements['button'] = {
  onClick: (event) => event.currentTarget.setPointerCapture(event.pointerId),
  onGotPointerCapture: (event) => event.currentTarget.hasPointerCapture(event.pointerId),
  onLostPointerCaptureCapture: (event) =>
    event.currentTarget.releasePointerCapture(event.pointerId),
  onDragStart: (event) => event.dataTransfer?.setData('text/plain', event.currentTarget.id),
  onDragEnd: (event) => event.dataTransfer?.clearData(),
  onDragEnter: (event) => event.preventDefault(),
  onTouchStart: (event) =>
    event.currentTarget.setAttribute('data-touch', String(event.touches.length)),
};
export const editorEvents: JSX.IntrinsicElements['textarea'] = {
  onBeforeInput: (event) => event.currentTarget.setAttribute('data-input', event.inputType),
  onCompositionEnd: (event) => event.currentTarget.setAttribute('data-composition', event.data),
  onCopy: (event) => event.clipboardData?.setData('text/plain', event.currentTarget.value),
  onFocusIn: (event) => event.currentTarget.focus(),
  onFocusOut: (event) => event.relatedTarget?.dispatchEvent(new Event('focus-left')),
};
export const mediaEvents: JSX.IntrinsicElements['video'] = {
  onCanPlay: (event) => event.currentTarget.pause(),
  onSeeking: (event) => event.currentTarget.pause(),
  onEncrypted: (event) => event.currentTarget.setAttribute('data-encryption', event.initDataType),
  onEnterPictureInPicture: (event) =>
    event.currentTarget.setAttribute('data-pip-width', String(event.pictureInPictureWindow.width)),
  disablePictureInPicture: true,
  disableremoteplayback: false,
};
export const formEvents: JSX.IntrinsicElements['form'] = {
  onFormData: (event) => event.formData.set('source', event.currentTarget.id),
  onReset: (event) => event.preventDefault(),
};
export const dialogEvents: JSX.IntrinsicElements['dialog'] = {
  onCancel: (event) => event.preventDefault(),
  onToggle: (event) => event.currentTarget.setAttribute('data-state', event.newState),
  onCommand: (event) => event.source?.setAttribute('data-command', event.command),
};
export const renderingEvents: JSX.IntrinsicElements['canvas'] = {
  onWebGLContextLost: (event) => {
    event.preventDefault();
    event.currentTarget.setAttribute('data-status', event.statusMessage);
  },
  onAnimationEnd: (event) =>
    event.currentTarget.setAttribute('data-animation', event.animationName),
  onTransitionEnd: (event) =>
    event.currentTarget.setAttribute('data-transition', event.propertyName),
  onScrollSnapChange: (event) => event.snapTargetBlock?.dispatchEvent(new Event('snap')),
};
export const animation: JSX.IntrinsicElements['animate'] = {
  attributeName: 'opacity',
  values: '0;1',
  dur: '1s',
  repeatCount: 'indefinite',
  onBegin: (event) => event.currentTarget.setAttribute('data-repeat', String(event.detail)),
  onRepeatCapture: (event) => event.view?.dispatchEvent(new Event('animation-repeat')),
};
export const svgGeometry: JSX.IntrinsicElements['linearGradient'] = {
  gradientUnits: 'userSpaceOnUse',
  gradientTransform: 'rotate(45)',
  spreadMethod: 'reflect',
  href: '#base-gradient',
};
export const svgFilter: JSX.IntrinsicElements['feConvolveMatrix'] = {
  in: 'SourceGraphic',
  kernelMatrix: '0 1 0 1 -4 1 0 1 0',
  preserveAlpha: 'false',
};
export const svgLink: JSX.IntrinsicElements['a'] = {
  href: '#shape',
  transform: 'translate(1 2)',
  fill: 'red',
  'vector-effect': 'non-scaling-stroke',
};
export const svgScript: JSX.IntrinsicElements['script'] = { href: '/graphics.js', nonce: 'nonce' };
export const svgTitle: JSX.IntrinsicElements['title'] = { lang: 'en', fill: 'red' };
export const svgStyle: JSX.IntrinsicElements['style'] = { media: 'screen', 'font-size': 12 };
export const enumeratedAttributes: JSX.IntrinsicElements['div'] = {
  contenteditable: 'inherit',
  spellcheck: '',
  translate: '',
  part: 'surface',
  exportparts: 'surface:outer-surface',
};

// @ts-expect-error Event spellings remain finite.
export const misspelledEvent: JSX.IntrinsicElements['video'] = { onCanPaly: () => {} };
export const wrongPayload: JSX.IntrinsicElements['div'] = {
  // @ts-expect-error Capture events retain their native payload type.
  onLostPointerCapture: (_event: KeyboardEvent) => {},
};
export const unownedPromise: JSX.IntrinsicElements['video'] = {
  // @ts-expect-error New event names keep the owned asynchronous-work contract.
  onCanPlay: () => Promise.resolve(),
};
export const syntheticEvent: JSX.IntrinsicElements['button'] = {
  // @ts-expect-error Native events do not acquire React synthetic-event fields.
  onClick: (event) => !!event.nativeEvent,
};
// @ts-expect-error Solid's event directives are not EffectWeb event attributes.
export const foreignDirective: JSX.IntrinsicElements['div'] = { 'on:dragstart': () => {} };
// @ts-expect-error Window listeners belong in an owned DOM binding.
export const windowEvent: JSX.IntrinsicElements['body'] = { onPopstate: () => {} };
// @ts-expect-error SVG animation handlers do not apply to HTML controls.
export const wrongAnimationTarget: JSX.IntrinsicElements['button'] = { onRepeat: () => {} };
export const wrongMediaAttribute: JSX.IntrinsicElements['audio'] = {
  // @ts-expect-error Picture-in-picture controls apply to video elements.
  disablepictureinpicture: true,
};
// @ts-expect-error Media state is writable native state, not a content attribute.
export const nativeMediaState: JSX.IntrinsicElements['video'] = { currentTime: 5 };
export const nativeSvgObject: JSX.IntrinsicElements['use'] = {
  // @ts-expect-error Expanded SVG attributes do not admit arbitrary IDL objects.
  href: { baseVal: '#shape', animVal: '#shape' },
};
// @ts-expect-error SVG's enumerated boolean is serialized as a string.
export const svgBoolean: JSX.IntrinsicElements['feConvolveMatrix'] = { preserveAlpha: false };
// @ts-expect-error SVG attributes use their native spelling.
export const misspelledSvg: JSX.IntrinsicElements['path'] = { vectorEffect: 'non-scaling-stroke' };
// @ts-expect-error Shared HTML/SVG names do not admit native node assignment.
export const nativeHtmlState: JSX.IntrinsicElements['a'] = { innerHTML: '<b>unowned</b>' };
