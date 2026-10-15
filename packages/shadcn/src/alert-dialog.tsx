import type { Native, Styled } from './types.js';
import * as Base from '@effectweb/base-ui/alert-dialog';
import { overlayAdapter } from './adapter.js';
import { controllerView, view, type JSX } from 'effectweb';
import { buttonVariants, type ButtonProps } from './button.js';
import { cn } from './cn.js';

export interface AlertDialogProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly title: JSX.Element;
  readonly description?: JSX.Element;
  readonly media?: JSX.Element;
  readonly children?: JSX.Element;
  /** The confirming button's label and what it does; the dialog closes after. Leave both out for a dialog that
   * only informs, with its cancel button as the one way out. */
  readonly action?: JSX.Element;
  readonly onAction?: (() => void) | undefined;
  readonly actionVariant?: ButtonProps['variant'];
  readonly cancel?: JSX.Element;
  readonly size?: 'default' | 'sm' | undefined;
  readonly class?: string | undefined;
  readonly 'aria-label'?: string | undefined;
}

/** A dialog that needs an answer: Escape and the backdrop do not close it, the two buttons do. */
export const AlertDialog = controllerView(
  { controller: (props: AlertDialogProps) => overlayAdapter(props, Base.createAlertDialog) },
  view((model) => {
    const handle = model.actions.handle;
    const size = model.props.size ?? 'default';
    const id = handle.id;
    return (
      <AlertDialogPopup
        alertDialog={handle}
        data-slot="alert-dialog"
        role="alertdialog"
        aria-label={model.props['aria-label']}
        aria-labelledby={model.props['aria-label'] ? undefined : `${id}-title`}
        aria-describedby={model.props.description ? `${id}-description` : undefined}
        data-size={size}
        class={model.props.class}
      >
        <div
          data-slot="alert-dialog-header"
          class="grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]"
        >
          {model.props.media ? (
            <div
              data-slot="alert-dialog-media"
              class="mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6"
            >
              {model.props.media}
            </div>
          ) : null}
          <AlertDialogTitle
            alertDialog={handle}
            id={`${id}-title`}
            data-slot="alert-dialog-title"
            class="cn-font-heading text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2"
          >
            {model.props.title}
          </AlertDialogTitle>
          {model.props.description ? (
            <AlertDialogDescription
              alertDialog={handle}
              id={`${id}-description`}
              data-slot="alert-dialog-description"
              class="text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground"
            >
              {model.props.description}
            </AlertDialogDescription>
          ) : null}
        </div>
        {model.props.children}
        <div
          data-slot="alert-dialog-footer"
          class="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end"
        >
          <AlertDialogClose alertDialog={handle} data-slot="alert-dialog-cancel" variant="outline">
            {model.props.cancel ?? 'Cancel'}
          </AlertDialogClose>
          {model.props.action ? (
            <AlertDialogClose
              alertDialog={handle}
              data-slot="alert-dialog-action"
              variant={model.props.actionVariant}
              onClick={() => {
                model.props.onAction?.();
              }}
            >
              {model.props.action}
            </AlertDialogClose>
          ) : null}
        </div>
      </AlertDialogPopup>
    );
  }),
);

export type AlertDialogPopupProps = Parameters<typeof Base.AlertDialogPopup>[0];
/** Styled split AlertDialog popup; share a parent-owned handle with its other parts. */
export const AlertDialogPopup = view<AlertDialogPopupProps>(
  ({ alertDialog, class: className, ...rest }) => (
    <Base.AlertDialogPopup
      {...rest}
      alertDialog={alertDialog}
      data-slot={rest['data-slot'] ?? 'alert-dialog-content'}
      class={cn(
        'group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:fade-in-0 data-open:zoom-in-95 backdrop:bg-black/10 backdrop:animate-in backdrop:fade-in-0 supports-backdrop-filter:backdrop:backdrop-blur-xs',
        className,
      )}
    />
  ),
);
/** Styled split AlertDialog trigger. */
export const AlertDialogTrigger = view<
  Styled & Omit<Native<'button'>, 'alertDialog'> & { readonly alertDialog: Base.AlertDialogHandle }
>(({ alertDialog, ...rest }) => (
  <Base.AlertDialogTrigger {...rest} alertDialog={alertDialog} data-slot="alert-dialog-trigger" />
));
/** Styled split AlertDialog backdrop. */
export const AlertDialogBackdrop = view<
  Styled & Omit<Native<'div'>, 'alertDialog'> & { readonly alertDialog: Base.AlertDialogHandle }
>(({ alertDialog, class: className, ...rest }) => (
  <Base.AlertDialogBackdrop
    {...rest}
    alertDialog={alertDialog}
    data-slot="alert-dialog-backdrop"
    class={cn(
      'fixed inset-0 z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 supports-backdrop-filter:backdrop-blur-xs',
      className,
    )}
  />
));
/** Styled split AlertDialog close button. */
export const AlertDialogClose = view<
  ButtonProps & { readonly alertDialog: Base.AlertDialogHandle }
>(({ alertDialog, variant, size, class: className, ...rest }) => (
  <Base.AlertDialogClose
    {...rest}
    alertDialog={alertDialog}
    data-slot={rest['data-slot'] ?? 'alert-dialog-close'}
    class={cn(buttonVariants({ variant, size }), className)}
  />
));
/** Styled alert title with the handle-owned accessible ID. */
export const AlertDialogTitle = view<Parameters<typeof Base.AlertDialogTitle>[0]>(
  ({ class: className, ...rest }) => (
    <Base.AlertDialogTitle
      {...rest}
      data-slot="alert-dialog-title"
      class={cn('cn-font-heading text-base font-medium', className)}
    />
  ),
);
/** Styled alert description with the handle-owned accessible ID. */
export const AlertDialogDescription = view<Parameters<typeof Base.AlertDialogDescription>[0]>(
  ({ class: className, ...rest }) => (
    <Base.AlertDialogDescription
      {...rest}
      data-slot="alert-dialog-description"
      class={cn('text-sm text-muted-foreground', className)}
    />
  ),
);
