import { overlayAnchorBinding } from '@effectweb/base-ui/anchor';
import * as Base from '@effectweb/base-ui/popover';
import { overlayAdapter } from './adapter.js';
import { controllerView, view, type JSX } from 'effectweb';
import { cn } from './cn.js';
import type { Align, Side } from './placement.js';
import type { Native, Styled } from './types.js';

export interface PopoverProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** The trigger: clicking it toggles the popover, which is placed next to it. */
  readonly trigger: JSX.Element;
  readonly children?: JSX.Element;
  readonly side?: Side | undefined;
  readonly align?: Align | undefined;
  readonly sideOffset?: number | undefined;
  readonly class?: string | undefined;
}

type DivProps = Native<'div'> & Styled;

/** The heading area of a popover. */
export const PopoverHeader = view<DivProps>(({ class: className, children, ...rest }) => (
  <div data-slot="popover-header" class={cn('flex flex-col gap-0.5 text-sm', className)} {...rest}>
    {children}
  </div>
));

/** A styled h3 for a popover title. */
export const PopoverTitle = view<
  Omit<Native<'h3'>, 'popover'> &
    Styled & { readonly popover?: Base.PopoverHandle | Native<'h3'>['popover'] | undefined }
>(({ popover, class: className, children, ...rest }) => (
  <h3
    data-slot="popover-title"
    class={cn('font-medium', className)}
    {...rest}
    popover={typeof popover === 'object' ? undefined : popover}
    id={popover && typeof popover === 'object' ? `${popover.id}-title` : rest.id}
  >
    {children}
  </h3>
));

/** Supporting text inside a popover. */
export const PopoverDescription = view<
  Omit<Native<'p'>, 'popover'> &
    Styled & { readonly popover?: Base.PopoverHandle | Native<'h3'>['popover'] | undefined }
>(({ popover, class: className, children, ...rest }) => (
  <p
    data-slot="popover-description"
    class={cn('text-muted-foreground', className)}
    {...rest}
    popover={typeof popover === 'object' ? undefined : popover}
    id={popover && typeof popover === 'object' ? `${popover.id}-description` : rest.id}
  >
    {children}
  </p>
));

/** A top-layer popup next to its trigger: light dismiss and Escape close it, as does clicking the trigger again. */
export const Popover = controllerView(
  { controller: (props: PopoverProps) => overlayAdapter(props, Base.createPopover) },
  view((model) => {
    const handle = model.actions.handle;
    return (
      <span
        data-slot="popover"
        class="inline-block"
        use={overlayAnchorBinding(handle)}
        onClick={(event) => {
          const target = event.target as Element;
          const trigger = event.currentTarget.firstElementChild;
          if (trigger && trigger.contains(target)) handle.toggle();
        }}
      >
        {model.props.trigger}
        <PopoverPopup
          popover={handle}
          side={model.props.side}
          align={model.props.align}
          sideOffset={model.props.sideOffset}
          data-slot="popover-content"
          class={model.props.class}
        >
          {model.props.children}
        </PopoverPopup>
      </span>
    );
  }),
);

export type PopoverPopupProps = Parameters<typeof Base.PopoverPopup>[0];
/** Styled split Popover popup; share a parent-owned handle with its other parts. */
export const PopoverPopup = view<PopoverPopupProps>(({ popover, class: className, ...rest }) => (
  <Base.PopoverPopup
    {...rest}
    popover={popover}
    data-slot={rest['data-slot'] ?? 'popover-content'}
    class={cn(
      'z-50 flex w-72 flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:fade-in-0 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      className,
    )}
  />
));
/** Styled split Popover trigger. */
export const PopoverTrigger = view<
  Styled & Omit<Native<'button'>, 'popover'> & { readonly popover: Base.PopoverHandle }
>(({ popover, ...rest }) => (
  <Base.PopoverTrigger {...rest} popover={popover} data-slot="popover-trigger" />
));
/** Styled split Popover backdrop. */
export const PopoverBackdrop = view<
  Styled & Omit<Native<'div'>, 'popover'> & { readonly popover: Base.PopoverHandle }
>(({ popover, class: className, ...rest }) => (
  <Base.PopoverBackdrop
    {...rest}
    popover={popover}
    data-slot="popover-backdrop"
    class={cn(
      'fixed inset-0 z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 supports-backdrop-filter:backdrop-blur-xs',
      className,
    )}
  />
));
/** Styled split Popover close button. */
export const PopoverClose = view<
  Styled & Omit<Native<'button'>, 'popover'> & { readonly popover: Base.PopoverHandle }
>(({ popover, ...rest }) => (
  <Base.PopoverClose {...rest} popover={popover} data-slot="popover-close" />
));
