import * as Base from '@effectweb/base-ui/drawer';
import { overlayAdapter } from './adapter.js';
import { controllerView, view, type JSX } from 'effectweb';
import X from '@effectweb/lucide/icons/x';
import { buttonVariants, type ButtonProps } from './button.js';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

export interface SheetProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  readonly title?: JSX.Element;
  readonly description?: JSX.Element;
  readonly children?: JSX.Element;
  readonly footer?: JSX.Element;
  readonly showCloseButton?: boolean | undefined;
  readonly class?: string | undefined;
  readonly 'aria-label'?: string | undefined;
}

type DivProps = Native<'div'> & Styled;

/** The heading area of a sheet. */
export const SheetHeader = view<DivProps>(({ class: className, children, ...rest }) => (
  <div data-slot="sheet-header" class={cn('flex flex-col gap-0.5 p-4', className)} {...rest}>
    {children}
  </div>
));

/** The action area at the bottom of a sheet. */
export const SheetFooter = view<DivProps>(({ class: className, children, ...rest }) => (
  <div data-slot="sheet-footer" class={cn('mt-auto flex flex-col gap-2 p-4', className)} {...rest}>
    {children}
  </div>
));

/** A styled h2 for a sheet title. */
export const SheetTitle = view<
  Omit<Native<'h2'>, 'sheet'> & Styled & { readonly sheet?: Base.DrawerHandle | undefined }
>(({ sheet, class: className, children, ...rest }) => (
  <h2
    data-slot="sheet-title"
    class={cn('cn-font-heading text-base font-medium text-foreground', className)}
    {...rest}
    id={sheet ? `${sheet.id}-title` : rest.id}
  >
    {children}
  </h2>
));

/** Supporting text inside a sheet. */
export const SheetDescription = view<
  Omit<Native<'p'>, 'sheet'> & Styled & { readonly sheet?: Base.DrawerHandle | undefined }
>(({ sheet, class: className, children, ...rest }) => (
  <p
    data-slot="sheet-description"
    class={cn('text-sm text-muted-foreground', className)}
    {...rest}
    id={sheet ? `${sheet.id}-description` : rest.id}
  >
    {children}
  </p>
));

/** A dialog pinned to one edge of the screen. */
export const Sheet = controllerView(
  { controller: (props: SheetProps) => overlayAdapter(props, Base.createDrawer) },
  view((model) => {
    const handle = model.actions.handle;
    const side = model.props.side ?? 'right';
    const id = handle.id;
    return (
      <SheetPopup
        sheet={handle}
        data-slot="sheet"
        side={side}
        aria-label={model.props['aria-label']}
        aria-labelledby={
          model.props.title && !model.props['aria-label'] ? `${id}-title` : undefined
        }
        aria-describedby={model.props.description ? `${id}-description` : undefined}
        class={model.props.class}
      >
        {model.props.title || model.props.description ? (
          <SheetHeader>
            {model.props.title ? (
              <SheetTitle id={`${id}-title`}>{model.props.title}</SheetTitle>
            ) : null}
            {model.props.description ? (
              <SheetDescription id={`${id}-description`}>
                {model.props.description}
              </SheetDescription>
            ) : null}
          </SheetHeader>
        ) : null}
        {model.props.children}
        {model.props.footer ? <SheetFooter>{model.props.footer}</SheetFooter> : null}
        {model.props.showCloseButton !== false ? (
          <SheetClose
            sheet={handle}
            data-slot="sheet-close"
            variant="ghost"
            size="icon-sm"
            class="absolute top-3 right-3"
            aria-label="Close"
          >
            <X />
          </SheetClose>
        ) : null}
      </SheetPopup>
    );
  }),
);

export type SheetPopupProps = Omit<Parameters<typeof Base.DrawerPopup>[0], 'drawer'> & {
  readonly sheet: Base.DrawerHandle;
} & { readonly side?: SheetProps['side'] };
/** Styled split Sheet popup; share a parent-owned handle with its other parts. */
export const SheetPopup = view<SheetPopupProps>(
  ({ sheet, class: className, side = 'right', ...rest }) => (
    <Base.DrawerPopup
      {...rest}
      drawer={sheet}
      data-side={side}
      data-slot={rest['data-slot'] ?? 'sheet-content'}
      class={cn(
        'fixed z-50 flex max-h-none max-w-none flex-col gap-4 bg-popover bg-clip-padding p-0 text-sm text-popover-foreground shadow-lg duration-200 ease-in-out data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 backdrop:bg-black/10 backdrop:animate-in backdrop:fade-in-0 supports-backdrop-filter:backdrop:backdrop-blur-xs',
        'data-[side=bottom]:inset-x-0 data-[side=bottom]:top-auto data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:w-full data-[side=bottom]:border-t data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=bottom]:data-closed:slide-out-to-bottom-10',
        'data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-open:slide-in-from-left-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=left]:sm:max-w-sm',
        'data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:left-auto data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-open:slide-in-from-right-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=right]:sm:max-w-sm',
        'data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:w-full data-[side=top]:border-b data-[side=top]:data-open:slide-in-from-top-10 data-[side=top]:data-closed:slide-out-to-top-10',
        className,
      )}
    />
  ),
);
/** Styled split Sheet trigger. */
export const SheetTrigger = view<
  Styled & Omit<Native<'button'>, 'sheet'> & { readonly sheet: Base.DrawerHandle }
>(({ sheet, ...rest }) => (
  <Base.DrawerTrigger {...rest} drawer={sheet} data-slot="sheet-trigger" />
));
/** Styled split Sheet backdrop. */
export const SheetBackdrop = view<
  Styled & Omit<Native<'div'>, 'sheet'> & { readonly sheet: Base.DrawerHandle }
>(({ sheet, class: className, ...rest }) => (
  <Base.DrawerBackdrop
    {...rest}
    drawer={sheet}
    data-slot="sheet-backdrop"
    class={cn(
      'fixed inset-0 z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 supports-backdrop-filter:backdrop-blur-xs',
      className,
    )}
  />
));
/** Styled split Sheet close button, preserving Button variants. */
export const SheetClose = view<ButtonProps & { readonly sheet: Base.DrawerHandle }>(
  ({ sheet, variant, size, class: className, ...rest }) => (
    <Base.DrawerClose
      {...rest}
      drawer={sheet}
      data-slot="sheet-close"
      class={cn(buttonVariants({ variant, size }), className)}
    />
  ),
);
