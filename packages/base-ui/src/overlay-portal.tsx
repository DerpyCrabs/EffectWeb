import { modelOwner, observe, Portal, view, type JSX } from 'effectweb';
import type { OverlayHandle } from './overlay.js';

const mountedOverlays = new WeakMap<OverlayHandle, ReturnType<typeof createMountState>>();
function createMountState(handle: OverlayHandle) {
  const owner = modelOwner({ mounted: handle.source.model().open });
  handle.lifetime.own(owner);
  owner.own(
    handle.source.subscribe(({ open }) => {
      if (open) owner.patch({ mounted: true });
      else if (!handle.popup()) owner.patch({ mounted: false });
    }),
  );
  return owner;
}
function mountState(handle: OverlayHandle) {
  let state = mountedOverlays.get(handle);
  if (!state) mountedOverlays.set(handle, (state = createMountState(handle)));
  return state;
}
/** Called after exit motion and focus restoration, never merely on an open-state change. */
export function completeOverlayExit(handle: OverlayHandle) {
  if (!handle.source.model().open) mountedOverlays.get(handle)?.patch({ mounted: false });
}
export interface OverlayPortalProps {
  readonly handle: OverlayHandle;
  readonly children?: JSX.Element;
  readonly keepMounted?: boolean;
  readonly container?: Element | undefined;
}
/** Shared implementation of the adapter's family Portal parts. */
export const OverlayPortal = view<OverlayPortalProps>(
  ({ handle, children, keepMounted, container }) =>
    observe(mountState(handle).source, ({ mounted }) =>
      mounted || keepMounted ? <Portal mount={container}>{children}</Portal> : null,
    ),
);
