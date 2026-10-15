import { observe, view, domBinding } from 'effectweb';
import { createStateController, type ControllerOptions } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned Avatar handle; pass it to the parts and own its lifetime. */
export interface AvatarState {
  readonly loaded: boolean;
}
export interface AvatarOptions extends ControllerOptions, Partial<AvatarState> {}
/** Create an Avatar handle: the image loading status that decides between the image and the fallback. */
export const createAvatar = (options: AvatarOptions = {}) =>
  createStateController<AvatarState>({ loaded: options.loaded ?? false }, options);
export type AvatarHandle = ReturnType<typeof createAvatar>;
/** The avatar container, sized and shaped by the consumer. */
export const AvatarRoot = view<Native<'span'>>((props) => <span {...props} />);
const acquireImage = (element: HTMLImageElement, current: () => AvatarHandle) => {
  let source = '';
  const sync = () => {
    if (source === element.src) return;
    source = element.src;
    const loaded = element.complete && element.naturalWidth > 0;
    if (current().source.model().loaded !== loaded) current().sync({ loaded });
  };
  sync();
  return { update: sync, dispose: () => {} };
};
const imageBinding = (avatar: AvatarHandle) => domBinding(avatar, acquireImage);
/** The avatar image; reports loading and errors to the handle so the fallback can take over. */
export const AvatarImage = view<Native<'img'> & { readonly avatar: AvatarHandle }>(
  ({ avatar, onLoad, onError, ...rest }) =>
    observe(avatar.source, (state) => (
      <img
        {...rest}
        hidden={!state.loaded}
        use={imageBinding(avatar)}
        onLoad={(event) => {
          onLoad?.(event);
          if (event.defaultPrevented) return;
          avatar.sync({ loaded: true });
        }}
        onError={(event) => {
          onError?.(event);
          if (event.defaultPrevented) return;
          avatar.sync({ loaded: false });
        }}
      />
    )),
);
/** Content shown while the image loads or when it fails. */
export const AvatarFallback = view<Native<'span'> & { readonly avatar: AvatarHandle }>(
  ({ avatar, ...rest }) =>
    observe(avatar.source, (state) => <span {...rest} hidden={state.loaded} />),
);
