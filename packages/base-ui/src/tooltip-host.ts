import { domBinding } from 'effectweb';
import type { OverlayHandle } from './overlay.js';
interface TooltipHostInput {
  readonly handle: OverlayHandle;
  readonly delay: number;
}
const acquireHost = (host: HTMLElement, current: () => TooltipHostInput) => {
  const handle = current().handle;
  const trigger = host.firstElementChild;
  if (!(trigger instanceof HTMLElement)) return;
  handle.attachTrigger(trigger);
  const previous = trigger.getAttribute('aria-describedby');
  trigger.setAttribute(
    'aria-describedby',
    [previous, `${handle.id}-popup`].filter(Boolean).join(' '),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = () => {
    clearTimeout(timer);
    timer = setTimeout(() => handle.setOpen(true), current().delay);
  };
  const hide = () => {
    clearTimeout(timer);
    handle.hide();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };
  host.addEventListener('pointerenter', show);
  host.addEventListener('pointerleave', hide);
  host.addEventListener('focusin', show);
  host.addEventListener('focusout', hide);
  host.addEventListener('keydown', key);
  return () => {
    clearTimeout(timer);
    host.removeEventListener('pointerenter', show);
    host.removeEventListener('pointerleave', hide);
    host.removeEventListener('focusin', show);
    host.removeEventListener('focusout', hide);
    host.removeEventListener('keydown', key);
    if (previous === null) trigger.removeAttribute('aria-describedby');
    else trigger.setAttribute('aria-describedby', previous);
    if (handle.trigger() === trigger) handle.attachTrigger(undefined);
  };
};
/** Bind hover/focus behavior to an arbitrary child button or link while retaining its native element. */
export const tooltipHostBinding = (input: TooltipHostInput) => ({
  ...domBinding(input, acquireHost),
  identity: input.handle,
});
