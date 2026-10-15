import * as Base from '@effectweb/base-ui/drawer';
import { controllerView, view } from 'effectweb';
import { overlayAdapter } from './adapter.js';
import type { DialogProps } from './dialog.js';
import type { Native } from '@effectweb/base-ui/types';
import X from '@effectweb/lucide/icons/x';
import { buttonVariants, type ButtonProps } from './button.js';
import { cn } from './cn.js';
export { createDrawer, type DrawerHandle } from '@effectweb/base-ui/drawer';
type Direction = 'top' | 'right' | 'bottom' | 'left';
export interface DrawerProps extends DialogProps {
  readonly direction?: Direction | undefined;
  readonly side?: Direction | undefined;
}
/** An edge drawer with native modal focus. Swipe gestures and snap points are not supported. */
export const Drawer = controllerView(
  { controller: (props: DrawerProps) => overlayAdapter(props, Base.createDrawer) },
  view((model) => (
    <DrawerContent
      drawer={model.actions.handle}
      direction={model.props.direction ?? model.props.side ?? 'bottom'}
      class={model.props.class}
      dismissible={model.props.dismissible}
      aria-label={model.props['aria-label']}
      aria-labelledby={
        model.props.title && !model.props['aria-label']
          ? `${model.actions.handle.id}-title`
          : undefined
      }
      aria-describedby={
        model.props.description ? `${model.actions.handle.id}-description` : undefined
      }
    >
      {model.props.title || model.props.description ? (
        <DrawerHeader>
          {model.props.title ? (
            <DrawerTitle drawer={model.actions.handle}>{model.props.title}</DrawerTitle>
          ) : null}
          {model.props.description ? (
            <DrawerDescription drawer={model.actions.handle}>
              {model.props.description}
            </DrawerDescription>
          ) : null}
        </DrawerHeader>
      ) : null}
      {model.props.children}
      {model.props.footer ? <DrawerFooter>{model.props.footer}</DrawerFooter> : null}
      {model.props.showCloseButton !== false ? (
        <DrawerClose
          drawer={model.actions.handle}
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          class="absolute top-2 right-2"
        >
          <X />
        </DrawerClose>
      ) : null}
    </DrawerContent>
  )),
);
export type DrawerContentProps = Base.DrawerPopupProps & {
  readonly direction?: Direction | undefined;
  readonly side?: Direction | undefined;
};
// data-direction replaces vaul's data-vaul-drawer-direction because this drawer uses a base-ui handle.
/** The drawer popup with `direction` and the handle bar. */
export const DrawerContent = view<DrawerContentProps>(
  ({ class: className, children, direction, side, ...props }) => (
    <Base.DrawerPopup
      {...props}
      data-slot="drawer-content"
      data-direction={direction ?? side ?? 'bottom'}
      class={cn(
        'group/drawer-content fixed z-50 flex h-auto max-w-none flex-col p-0 bg-background text-sm outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-[direction=top]:inset-x-0 data-[direction=top]:bottom-auto data-[direction=top]:top-0 data-[direction=top]:w-full data-[direction=top]:mb-24 data-[direction=top]:max-h-[80vh] data-[direction=top]:rounded-b-xl data-[direction=top]:border-b data-[direction=bottom]:inset-x-0 data-[direction=bottom]:top-auto data-[direction=bottom]:bottom-0 data-[direction=bottom]:w-full data-[direction=bottom]:mt-24 data-[direction=bottom]:max-h-[80vh] data-[direction=bottom]:rounded-t-xl data-[direction=bottom]:border-t data-[direction=right]:inset-y-0 data-[direction=right]:left-auto data-[direction=right]:right-0 data-[direction=right]:h-full data-[direction=right]:max-h-none data-[direction=right]:w-3/4 data-[direction=right]:border-l data-[direction=right]:sm:max-w-sm data-[direction=left]:inset-y-0 data-[direction=left]:left-0 data-[direction=left]:h-full data-[direction=left]:max-h-none data-[direction=left]:w-3/4 data-[direction=left]:border-r data-[direction=left]:sm:max-w-sm backdrop:bg-black/10 supports-backdrop-filter:backdrop:backdrop-blur-xs',
        className,
      )}
    >
      <div
        aria-hidden="true"
        class="bg-muted mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full group-data-[direction=bottom]/drawer-content:block"
      />
      {children}
    </Base.DrawerPopup>
  ),
);
/** The drawer popup element; `DrawerContent` adds the upstream layout. */
export const DrawerPopup = DrawerContent;
/** A button that opens the drawer. */
export const DrawerTrigger = view<Base.DrawerTriggerProps>((props) => (
  <Base.DrawerTrigger {...props} data-slot="drawer-trigger" />
));
/** A button that closes the drawer. */
export const DrawerClose = view<ButtonProps & { readonly drawer: Base.DrawerHandle }>(
  ({ variant, size, class: className, ...props }) => (
    <Base.DrawerClose
      {...props}
      data-slot="drawer-close"
      class={cn(buttonVariants({ variant, size }), className)}
    />
  ),
);
/** The drawer overlay. */
export const DrawerOverlay = view<Base.DrawerBackdropProps>(({ class: className, ...props }) => (
  <Base.DrawerBackdrop
    {...props}
    data-slot="drawer-overlay"
    class={cn(
      'fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
      className,
    )}
  />
));
/** The drawer backdrop element behind `DrawerOverlay`. */
export const DrawerBackdrop = DrawerOverlay;
/** The heading area of a drawer. */
export const DrawerHeader = view<Native<'div'>>(({ class: className, ...props }) => (
  <div
    {...props}
    data-slot="drawer-header"
    class={cn(
      'flex flex-col gap-0.5 p-4 group-data-[direction=bottom]/drawer-content:text-center group-data-[direction=top]/drawer-content:text-center md:gap-0.5 md:text-left',
      className,
    )}
  />
));
/** The action area of a drawer. */
export const DrawerFooter = view<Native<'div'>>(({ class: className, ...props }) => (
  <div
    {...props}
    data-slot="drawer-footer"
    class={cn('mt-auto flex flex-col gap-2 p-4', className)}
  />
));
/** The drawer title. */
export const DrawerTitle = view<Base.DrawerTitleProps>(({ class: className, ...props }) => (
  <Base.DrawerTitle
    {...props}
    data-slot="drawer-title"
    class={cn('cn-font-heading text-base font-medium text-foreground', className)}
  />
));
/** The drawer description. */
export const DrawerDescription = view<Base.DrawerDescriptionProps>(
  ({ class: className, ...props }) => (
    <Base.DrawerDescription
      {...props}
      data-slot="drawer-description"
      class={cn('text-sm text-muted-foreground', className)}
    />
  ),
);
