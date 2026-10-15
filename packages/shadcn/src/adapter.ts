import { modelOwner, mapSource, type ControllerLifetime } from 'effectweb';
import type { ControllerOptions } from '@effectweb/base-ui';
/** Own a family handle and synchronize controlled props on receipt. */
export function primitiveAdapter<
  Props,
  Options,
  Handle extends {
    readonly lifetime: ControllerLifetime;
    readonly configure: (options: ControllerOptions) => void;
    readonly sync: (state: never) => void;
  },
>(
  props: Props,
  create: (options: Options) => Handle,
  options: (read: () => Props) => Options,
  state: (props: Props) => Parameters<Handle['sync']>[0],
  configure: (props: Props) => ControllerOptions = () => ({}),
) {
  let current = props;
  const owner = modelOwner({ revision: 0 });
  const handle = create(options(() => current));
  owner.own(handle.lifetime);
  return {
    source: mapSource(owner.source, () => ({ props: current })),
    handle,
    lifetime: owner,
    receive: (next: Props) => {
      current = next;
      owner.edit('revision', (revision) => revision + 1);
      handle.configure(configure(next));
      handle.sync(state(next));
    },
  };
}

/** Own visibility while reading current change callbacks. */
export function overlayAdapter<
  Props extends {
    readonly open?: boolean | undefined;
    readonly defaultOpen?: boolean | undefined;
    readonly onOpenChange?: ((open: boolean) => void) | undefined;
  },
>(
  props: Props,
  create: (
    options: import('@effectweb/base-ui').OverlayOptions,
  ) => import('@effectweb/base-ui').OverlayHandle,
) {
  return primitiveAdapter(
    props,
    create,
    (read) => ({
      get open() {
        return read().open;
      },
      defaultOpen: props.defaultOpen,
      onOpenChange: (open) => read().onOpenChange?.(open),
    }),
    (next) => (next.open === undefined ? {} : { open: next.open }),
  );
}
