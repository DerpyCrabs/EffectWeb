import { view } from 'effectweb';
import ChevronDown from '@effectweb/lucide/icons/chevron-down';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A styled native select. Supply option children and native value/change props. */
export const NativeSelect = view<
  Omit<Native<'select'>, 'size'> & Styled & { readonly size?: 'sm' | 'default' | undefined }
>(({ class: className, size, children, ...rest }) => (
  <div
    class={cn('group/native-select relative w-fit has-[select:disabled]:opacity-50', className)}
    data-slot="native-select-wrapper"
    data-size={size ?? 'default'}
  >
    <select
      data-slot="native-select"
      data-size={size ?? 'default'}
      class="h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm transition-colors outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:py-0.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
      {...rest}
    >
      {children}
    </select>
    <ChevronDown
      class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground select-none"
      aria-hidden="true"
      data-slot="native-select-icon"
    />
  </div>
));

/** An option inside NativeSelect. */
export const NativeSelectOption = view<Native<'option'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <option
      data-slot="native-select-option"
      class={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...rest}
    >
      {children}
    </option>
  ),
);

/** A labeled group of native select options. */
export const NativeSelectOptGroup = view<Native<'optgroup'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <optgroup
      data-slot="native-select-optgroup"
      class={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...rest}
    >
      {children}
    </optgroup>
  ),
);
