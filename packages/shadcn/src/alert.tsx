import { view } from 'effectweb';
import { cn, cva, type VariantProps } from './cn.js';
import type { Native, Styled } from './types.js';

type DivProps = Native<'div'> & Styled;

/** Classes for the default and destructive alert variants. */
export const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** A styled alert region. Compose its title, description and action as children. */
export const Alert = view<DivProps & VariantProps<typeof alertVariants>>(
  ({ class: className, variant, children, ...rest }) => (
    <div data-slot="alert" role="alert" class={cn(alertVariants({ variant }), className)} {...rest}>
      {children}
    </div>
  ),
);

/** The alert heading text. */
export const AlertTitle = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="alert-title"
    class={cn(
      'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** Supporting content inside an alert. */
export const AlertDescription = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="alert-description"
    class={cn(
      'text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** An action placed at the upper right of an alert. */
export const AlertAction = view<DivProps>(({ class: className, children, ...rest }) => (
  <div data-slot="alert-action" class={cn('absolute top-2 right-2', className)} {...rest}>
    {children}
  </div>
));
