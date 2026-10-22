import {
  createOtpField,
  OtpFieldHiddenInput,
  OtpFieldRoot,
  OtpFieldSlot,
  type OtpFieldHandle,
  type OtpFieldOptions,
} from '@effectweb/base-ui';
export { createOtpField, type OtpFieldHandle } from '@effectweb/base-ui/otp-field';
import Minus from '@effectweb/lucide/icons/minus';
import { controllerView, modelOwner, view, type JSX } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

export interface InputOTPProps extends OtpFieldOptions {
  /** The form field name of the whole code. */
  readonly name?: string | undefined;
  readonly class?: string | undefined;
  readonly containerClass?: string | undefined;
  readonly children: (otp: OtpFieldHandle) => JSX.Element;
}
function otpController(props: InputOTPProps) {
  const owner = modelOwner({ props });
  const handle = createOtpField({
    id: props.id,
    length: props.length,
    pattern: props.pattern,
    defaultValue: props.defaultValue,
    disabled: props.disabled,
    readOnly: props.readOnly,
    get value() {
      return owner.read().props.value;
    },
    onValueChange: (value) => owner.read().props.onValueChange?.(value),
    onComplete: (value) => owner.read().props.onComplete?.(value),
  });
  owner.own(handle.lifetime);
  return {
    source: owner.source,
    handle,
    lifetime: owner,
    receive: (next: InputOTPProps) => {
      owner.patch({ props: next });
      if (next.value !== undefined) handle.sync({ value: next.value });
      if (next.disabled !== undefined) handle.sync({ disabled: next.disabled });
    },
  };
}
/** A one-time code input: `children` places groups and slots around the shared handle. */
export const InputOTP = controllerView(
  { controller: otpController },
  view((model) => (
    <OtpFieldRoot
      otpField={model.actions.handle}
      data-slot="input-otp"
      class={cn(
        'flex items-center gap-2 has-disabled:opacity-50',
        model.props.containerClass,
        model.props.class,
      )}
    >
      {model.props.children(model.actions.handle)}
      {model.props.name ? (
        <OtpFieldHiddenInput otpField={model.actions.handle} name={model.props.name} />
      ) : null}
    </OtpFieldRoot>
  )),
);
/** Slots that visually join into one box. */
export const InputOTPGroup = view<Native<'div'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <div data-slot="input-otp-group" class={cn('flex items-center', className)} {...rest}>
      {children}
    </div>
  ),
);
/** One character box of the code. */
export const InputOTPSlot = view<
  Omit<Parameters<typeof OtpFieldSlot>[0], 'class' | 'otpField'> & {
    readonly otp: OtpFieldHandle;
    readonly class?: string | undefined;
  }
>(({ otp, class: className, ...rest }) => (
  <OtpFieldSlot
    otpField={otp}
    data-slot="input-otp-slot"
    class={cn(
      'relative flex h-9 w-9 items-center justify-center border-y border-r border-input bg-transparent text-center text-sm shadow-xs transition-all outline-none first:rounded-l-md first:border-l last:rounded-r-md aria-invalid:border-destructive focus:z-10 focus:border-ring focus:ring-[3px] focus:ring-ring/50 focus:aria-invalid:border-destructive focus:aria-invalid:ring-destructive/20 disabled:cursor-not-allowed dark:bg-input/30 dark:focus:aria-invalid:ring-destructive/40',
      className,
    )}
    {...rest}
  />
));
/** A dash between slot groups. */
export const InputOTPSeparator = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div data-slot="input-otp-separator" role="separator" class={className} {...rest}>
    <Minus />
  </div>
));
