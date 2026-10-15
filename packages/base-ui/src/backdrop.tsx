import { observe, view } from 'effectweb';
import { panelPresence } from './presence.js';
import type { OverlayHandle } from './overlay.js';
import type { Native } from './types.js';
/** Retain a backdrop visual for the same CSS presence lifecycle as its popup. */
export const OverlayBackdrop = view<Native<'div'> & { readonly handle: OverlayHandle }>(
  ({ handle, ...rest }) =>
    observe(handle.source, (state) => (
      <div {...rest} aria-hidden="true" use={panelPresence(state.open)} />
    )),
);
