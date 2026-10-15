import * as Base from '@effectweb/base-ui/dialog';
import { overlayAdapter } from './adapter.js';
import { controllerView, view, type JSX } from 'effectweb';
import X from '@effectweb/lucide/icons/x';
import { buttonVariants, type ButtonProps } from './button.js';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

export interface DialogProps {
  /** Controlled: the dialog is open exactly while this is true. Leave it out for the component's own state. */
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly title?: JSX.Element;
  readonly description?: JSX.Element;
  readonly children?: JSX.Element;
  readonly footer?: JSX.Element;
  readonly showCloseButton?: boolean | undefined;
  readonly class?: string | undefined;
  /** Whether a click on the backdrop or Escape closes it; false for an alert dialog. */
  readonly dismissible?: boolean | undefined;
  readonly role?: 'dialog' | 'alertdialog' | undefined;
  readonly 'aria-label'?: string | undefined;
}

type DivProps = Native<'div'> & Styled;

/** The title and description area inside a dialog. */
export const DialogHeader = view<DivProps>(({ class: className, children, ...rest }) => (
  <div data-slot="dialog-header" class={cn('flex flex-col gap-2', className)} {...rest}>
    {children}
  </div>
));

/** The action area inside a dialog. */
export const DialogFooter = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="dialog-footer"
    class={cn(
      '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** A styled h2 for a dialog title. */
export const DialogTitle = view<
  Omit<Native<'h2'>, 'dialog'> & Styled & { readonly dialog?: Base.DialogHandle | undefined }
>(({ dialog, class: className, children, ...rest }) => (
  <h2
    data-slot="dialog-title"
    class={cn('cn-font-heading text-base leading-none font-medium', className)}
    {...rest}
    id={dialog ? `${dialog.id}-title` : rest.id}
  >
    {children}
  </h2>
));

/** A paragraph describing a dialog. */
export const DialogDescription = view<
  Omit<Native<'p'>, 'dialog'> & Styled & { readonly dialog?: Base.DialogHandle | undefined }
>(({ dialog, class: className, children, ...rest }) => (
  <p
    data-slot="dialog-description"
    class={cn(
      'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
      className,
    )}
    {...rest}
    id={dialog ? `${dialog.id}-description` : rest.id}
  >
    {children}
  </p>
));

/** The shared classes for a centered dialog and its backdrop. */
export const dialogClass =
  'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-open:zoom-in-95 data-closed:zoom-out-95 backdrop:bg-black/10 backdrop:duration-100 backdrop:animate-in backdrop:fade-in-0 supports-backdrop-filter:backdrop:backdrop-blur-xs';

/** A modal <dialog>: focus is trapped and returned by the browser, Escape and the backdrop close it. */
export const Dialog = controllerView(
  { controller: (props: DialogProps) => overlayAdapter(props, Base.createDialog) },
  view((model) => {
    const handle = model.actions.handle;
    const dismissible = model.props.dismissible !== false;
    const id = handle.id;
    return (
      <DialogPopup
        dialog={handle}
        data-slot="dialog"
        dismissible={dismissible}
        role={model.props.role}
        aria-label={model.props['aria-label']}
        aria-labelledby={
          model.props.title && !model.props['aria-label'] ? `${id}-title` : undefined
        }
        aria-describedby={model.props.description ? `${id}-description` : undefined}
        class={model.props.class}
      >
        {model.props.title || model.props.description ? (
          <DialogHeader>
            {model.props.title ? (
              <DialogTitle id={`${id}-title`}>{model.props.title}</DialogTitle>
            ) : null}
            {model.props.description ? (
              <DialogDescription id={`${id}-description`}>
                {model.props.description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
        ) : null}
        {model.props.children}
        {model.props.footer ? <DialogFooter>{model.props.footer}</DialogFooter> : null}
        {model.props.showCloseButton !== false ? (
          <DialogClose
            dialog={handle}
            data-slot="dialog-close"
            variant="ghost"
            size="icon-sm"
            class="absolute top-2 right-2"
            aria-label="Close"
          >
            <X />
          </DialogClose>
        ) : null}
      </DialogPopup>
    );
  }),
);

export type DialogPopupProps = Parameters<typeof Base.DialogPopup>[0];
/** Styled split Dialog popup; share a parent-owned handle with its other parts. */
export const DialogPopup = view<DialogPopupProps>(({ dialog, class: className, ...rest }) => (
  <Base.DialogPopup
    {...rest}
    dialog={dialog}
    data-slot={rest['data-slot'] ?? 'dialog-content'}
    class={cn(dialogClass, className)}
  />
));
/** Styled split Dialog trigger. */
export const DialogTrigger = view<
  Styled & Omit<Native<'button'>, 'dialog'> & { readonly dialog: Base.DialogHandle }
>(({ dialog, ...rest }) => (
  <Base.DialogTrigger {...rest} dialog={dialog} data-slot="dialog-trigger" />
));
/** Styled split Dialog backdrop. */
export const DialogBackdrop = view<
  Styled & Omit<Native<'div'>, 'dialog'> & { readonly dialog: Base.DialogHandle }
>(({ dialog, class: className, ...rest }) => (
  <Base.DialogBackdrop
    {...rest}
    dialog={dialog}
    data-slot="dialog-backdrop"
    class={cn(
      'fixed inset-0 z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 supports-backdrop-filter:backdrop-blur-xs',
      className,
    )}
  />
));
/** Styled split Dialog close button, preserving Button variants. */
export const DialogClose = view<ButtonProps & { readonly dialog: Base.DialogHandle }>(
  ({ dialog, variant, size, class: className, ...rest }) => (
    <Base.DialogClose
      {...rest}
      dialog={dialog}
      data-slot="dialog-close"
      class={cn(buttonVariants({ variant, size }), className)}
    />
  ),
);
