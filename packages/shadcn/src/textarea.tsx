import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native } from './types.js';

/** A styled native textarea accepting its HTML attributes and events. */
export const Textarea = view<Native<'textarea'> & { readonly class?: string | undefined }>(
  ({ class: className, ...rest }) => (
    <textarea
      data-slot="textarea"
      class={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...rest}
    />
  ),
);
