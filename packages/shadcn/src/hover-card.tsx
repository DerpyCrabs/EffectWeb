import { controllerView, domBinding, modelOwner, view, type JSX } from 'effectweb';
import {
  createPopover,
  PopoverPopup,
  type OverlayHandle,
  type PositionOptions,
} from '@effectweb/base-ui';
import { cn } from './cn.js';
export interface HoverCardProps extends PositionOptions {
  readonly trigger: JSX.Element;
  readonly children?: JSX.Element;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly openDelay?: number | undefined;
  readonly closeDelay?: number | undefined;
  readonly class?: string | undefined;
}
const acquireAnchor = (host: HTMLElement, current: () => OverlayHandle) => {
  const trigger = host.firstElementChild;
  if (trigger instanceof HTMLElement) current().attachTrigger(trigger);
  return () => current().attachTrigger(undefined);
};
const anchorBinding = (handle: OverlayHandle) => ({
  ...domBinding(handle, acquireAnchor),
  identity: handle,
});
function hoverController(props: HoverCardProps) {
  const owner = modelOwner({ props });
  const handle = createPopover({
    restoreFocus: false,
    get open() {
      return owner.read().props.open;
    },
    defaultOpen: props.defaultOpen,
    onOpenChange: (open) => owner.read().props.onOpenChange?.(open),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  owner.own(handle.lifetime);
  owner.own(() => clearTimeout(timer));
  const schedule = (open: boolean) => {
    clearTimeout(timer);
    timer = setTimeout(
      () => handle.setOpen(open),
      open ? (owner.read().props.openDelay ?? 300) : (owner.read().props.closeDelay ?? 150),
    );
  };
  return {
    source: owner.source,
    handle,
    schedule,
    dismiss: () => {
      clearTimeout(timer);
      handle.hide();
    },
    lifetime: owner,
    receive: (next: HoverCardProps) => {
      owner.patch({ props: next });
      if (next.open !== undefined) handle.sync({ open: next.open });
    },
  };
}
/** Interactive preview content stays open while pointer or focus is inside either part. */
export const HoverCard = controllerView(
  { controller: hoverController },
  view((model) => (
    <span
      data-slot="hover-card"
      class="inline-block"
      use={anchorBinding(model.actions.handle)}
      onPointerEnter={() => model.actions.schedule(true)}
      onPointerLeave={() => model.actions.schedule(false)}
      onFocusIn={() => model.actions.schedule(true)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          model.actions.schedule(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') model.actions.dismiss();
      }}
    >
      {model.props.trigger}
      <PopoverPopup
        popover={model.actions.handle}
        side={model.props.side}
        align={model.props.align}
        sideOffset={model.props.sideOffset}
        alignOffset={model.props.alignOffset}
        data-slot="hover-card-content"
        class={cn(
          'z-50 w-64 origin-(--transform-origin) rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          model.props.class,
        )}
      >
        {model.props.children}
      </PopoverPopup>
    </span>
  )),
);
