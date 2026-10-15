import { view } from 'effectweb';
import {
  NumberFieldRoot,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
  type NumberFieldHandle,
} from '@effectweb/base-ui/number-field';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';
export {
  createNumberField,
  NumberFieldScrubArea,
  type NumberFieldHandle,
} from '@effectweb/base-ui/number-field';
/** No base-nova registry family exists; uses the Input and ButtonGroup visual language. */
export const NumberField = view<
  Native<'div'> &
    Styled & { readonly numberField: NumberFieldHandle; readonly 'aria-label'?: string | undefined }
>(({ numberField, class: className, 'aria-label': label, ...rest }) => (
  <NumberFieldRoot
    {...rest}
    numberField={numberField}
    data-slot="number-field"
    class={cn('flex w-fit items-stretch rounded-lg border border-input shadow-xs', className)}
  >
    <NumberFieldDecrement
      numberField={numberField}
      class="flex size-9 items-center justify-center rounded-l-lg hover:bg-muted disabled:opacity-50"
    >
      −
    </NumberFieldDecrement>
    <NumberFieldInput
      numberField={numberField}
      aria-label={label}
      class="h-9 w-20 border-x border-input bg-transparent px-3 text-center text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    />
    <NumberFieldIncrement
      numberField={numberField}
      class="flex size-9 items-center justify-center rounded-r-lg hover:bg-muted disabled:opacity-50"
    >
      +
    </NumberFieldIncrement>
  </NumberFieldRoot>
));
