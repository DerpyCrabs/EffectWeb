import { Input as BaseInput } from '@effectweb/base-ui';
import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native } from './types.js';

/** The shared classes for a native text input. */
export const inputClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40';

/** A styled native input accepting its HTML attributes and events. */
export const Input = view<Native<'input'> & { readonly class?: string | undefined }>(
  ({ class: className, ...rest }) => (
    <BaseInput data-slot="input" class={cn(inputClass, className)} {...rest} />
  ),
);
