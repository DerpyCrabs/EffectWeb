import { FormFieldError, FormRoot, type FormHandle } from '@effectweb/base-ui';
import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

export {
  createForm,
  formFieldBinding,
  type FormHandle,
  type FormOptions,
} from '@effectweb/base-ui/form';
/** A form with external field errors: invalid controls are focused before submit and errors clear as the user edits. */
export const Form = view<Native<'form'> & Styled & { readonly form: FormHandle }>(
  ({ form, class: className, children, ...rest }) => (
    <FormRoot form={form} data-slot="form" class={cn('flex flex-col gap-6', className)} {...rest}>
      {children}
    </FormRoot>
  ),
);
/** The message for a field's form error, in the Field error style. */
export const FormMessage = view<
  Omit<Parameters<typeof FormFieldError>[0], 'class'> & { readonly class?: string | undefined }
>(({ class: className, ...rest }) => (
  <FormFieldError
    data-slot="form-message"
    class={cn('text-sm font-normal text-destructive', className)}
    {...rest}
  />
));
