import { createCheckbox } from '@effectweb/base-ui';
import { CheckboxRoot as BaseCheckbox } from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, view } from 'effectweb';
import Check from '@effectweb/lucide/icons/check';
import Minus from '@effectweb/lucide/icons/minus';
import { cn } from './cn.js';
import type { Native } from './types.js';

export type CheckboxProps = Omit<Native<'input'>, 'type' | 'checked'> & {
  readonly class?: string | undefined;
  readonly checked: boolean | 'indeterminate';
  /** Asked for the other state; the input itself stays as the model says. */
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
};

/** A native checkbox drawn as shadcn's: the box is the input, the mark an icon shown while it is checked. */
export const Checkbox = controllerView(
  {
    controller: (props: CheckboxProps) =>
      primitiveAdapter(
        props,
        createCheckbox,
        (read) => ({
          checked: props.checked === true,
          disabled: props.disabled ?? false,
          onCheckedChange: (value) => {
            const props = read();
            props.onCheckedChange?.(value);
          },
          indeterminate: props.checked === 'indeterminate',
        }),
        (next) => ({
          checked: next.checked === true,
          disabled: next.disabled ?? false,
          indeterminate: next.checked === 'indeterminate',
        }),
      ),
  },
  view((model) => {
    const { class: className, checked, onCheckedChange: _onCheckedChange, ...rest } = model.props;
    return (
      <span
        data-slot="checkbox"
        data-state={
          checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked'
        }
        class={cn('relative inline-flex size-4 shrink-0 items-center justify-center', className)}
      >
        <BaseCheckbox
          checkbox={model.actions.handle}
          type="checkbox"
          data-slot="checkbox-input"
          aria-checked={checked === 'indeterminate' ? 'mixed' : undefined}
          class="peer absolute inset-0 size-4 cursor-default appearance-none rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 checked:border-primary checked:bg-primary aria-[checked=mixed]:border-primary aria-[checked=mixed]:bg-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:checked:bg-primary"
          {...rest}
        />
        {checked === 'indeterminate' ? (
          <Minus
            data-slot="checkbox-indicator"
            class="pointer-events-none relative size-3.5 text-primary-foreground"
          />
        ) : (
          <Check
            data-slot="checkbox-indicator"
            class="pointer-events-none relative size-3.5 text-primary-foreground opacity-0 transition-none peer-checked:opacity-100"
          />
        )}
      </span>
    );
  }),
);
