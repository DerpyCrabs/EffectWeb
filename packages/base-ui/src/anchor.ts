import { domBinding } from 'effectweb';
import type { OverlayHandle } from './overlay.js';
const acquireAnchor = (
  host: HTMLElement,
  current: () => { handle: OverlayHandle; kind: string },
) => {
  const { handle, kind } = current();
  const trigger = host.firstElementChild;
  if (!(trigger instanceof HTMLElement)) return;
  handle.attachTrigger(trigger);
  const attributes = ['aria-expanded', 'aria-haspopup', 'aria-controls'] as const;
  const previous = attributes.map((name) => trigger.getAttribute(name));
  const sync = () => {
    trigger.setAttribute('aria-expanded', String(handle.source.model().open));
    trigger.setAttribute('aria-controls', `${handle.id}-popup`);
    trigger.setAttribute('aria-haspopup', kind);
  };
  const stop = handle.source.subscribe(sync);
  sync();
  return () => {
    stop();
    if (handle.trigger() === trigger) handle.attachTrigger(undefined);
    for (let i = 0; i < attributes.length; i++) {
      const value = previous[i];
      if (value === null || value === undefined) trigger.removeAttribute(attributes[i]!);
      else trigger.setAttribute(attributes[i]!, value);
    }
  };
};
/** Attach an arbitrary child button/link to an explicit menu handle without wrapping it in another control. */
export const menuAnchorBinding = (handle: OverlayHandle) => overlayAnchorBinding(handle, 'menu');
/** Attach arbitrary trigger JSX while preserving its native button/link semantics. */
export const overlayAnchorBinding = (handle: OverlayHandle, kind = 'dialog') => ({
  ...domBinding({ handle, kind }, acquireAnchor),
  // Another handle attaches the trigger again.
  identity: handle,
});
