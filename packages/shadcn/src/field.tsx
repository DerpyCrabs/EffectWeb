import { FieldLayout, FieldsetLayout, FieldsetLegend } from '@effectweb/base-ui';
import { list, view, type JSX } from 'effectweb';
import { cn, cva, type VariantProps } from './cn.js';
import { labelClass } from './label.js';
import { Separator } from './separator.js';
import type { Native, Styled } from './types.js';

type DivProps = Native<'div'> & Styled;

/** A native fieldset grouping related inputs. */
export const FieldSet = view<Native<'fieldset'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <FieldsetLayout
      data-slot="field-set"
      class={cn(
        'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
        className,
      )}
      {...rest}
    >
      {children}
    </FieldsetLayout>
  ),
);

/** A native legend labeling a fieldset. */
export const FieldLegend = view<
  Native<'legend'> & Styled & { readonly variant?: 'legend' | 'label' | undefined }
>(({ class: className, variant, children, ...rest }) => (
  <FieldsetLegend
    data-slot="field-legend"
    data-variant={variant ?? 'legend'}
    class={cn(
      'mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base',
      className,
    )}
    {...rest}
  >
    {children}
  </FieldsetLegend>
));

/** A layout container for several fields. */
export const FieldGroup = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="field-group"
    class={cn(
      'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** Classes for vertical, horizontal or responsive field layout. */
export const fieldVariants = cva(
  'group/field flex w-full gap-2 data-[invalid=true]:text-destructive',
  {
    variants: {
      orientation: {
        vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
        horizontal:
          'flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
        responsive:
          'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      },
    },
    defaultVariants: { orientation: 'vertical' },
  },
);

/** A field layout group with invalid and disabled styling. Set disabled on the input separately. */
export const Field = view<
  DivProps &
    VariantProps<typeof fieldVariants> & {
      readonly invalid?: boolean | undefined;
      readonly disabled?: boolean | undefined;
    }
>(({ class: className, orientation, invalid, disabled, children, ...rest }) => (
  <FieldLayout
    invalid={invalid}
    disabled={disabled}
    role="group"
    data-slot="field"
    data-orientation={orientation ?? 'vertical'}
    data-invalid={invalid ? 'true' : undefined}
    data-disabled={disabled ? 'true' : undefined}
    class={cn(fieldVariants({ orientation }), className)}
    {...rest}
  >
    {children}
  </FieldLayout>
));

/** The text area alongside a field control. */
export const FieldContent = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="field-content"
    class={cn('group/field-content flex flex-1 flex-col gap-0.5 leading-snug', className)}
    {...rest}
  >
    {children}
  </div>
));

/** A native label styled for a field; associate it with an input using for or nesting. */
export const FieldLabel = view<Native<'label'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <label
      data-slot="field-label"
      class={cn(
        labelClass,
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50 has-[>[data-slot=field]]:has-[:focus-visible]:border-ring has-[>[data-slot=field]]:has-[:focus-visible]:ring-3 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring/50 *:data-[slot=field]:p-2.5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
        className,
      )}
      {...rest}
    >
      {children}
    </label>
  ),
);

/** Field title text without native label behavior. */
export const FieldTitle = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="field-label"
    class={cn(
      'flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** Supporting text for a field. */
export const FieldDescription = view<Native<'p'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <p
      data-slot="field-description"
      class={cn(
        'text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5',
        'last:mt-0 nth-last-2:-mt-1',
        '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      {...rest}
    >
      {children}
    </p>
  ),
);

/** A divider between field groups, optionally with text. */
export const FieldSeparator = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="field-separator"
    data-content={children ? 'true' : 'false'}
    class={cn(
      'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
      className,
    )}
    {...rest}
  >
    <Separator class="absolute inset-0 top-1/2" />
    {children ? (
      <span
        class="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
        data-slot="field-separator-content"
      >
        {children}
      </span>
    ) : null}
  </div>
));

/** The errors of a field, each shown once; nothing renders while there are none and no children. */
export const FieldError = view<
  DivProps & {
    readonly errors?:
      | ReadonlyArray<{ readonly message?: string | undefined } | undefined>
      | undefined;
  }
>(({ class: className, children, errors, ...rest }) => {
  const messages = [
    ...new Set((errors ?? []).flatMap((error) => (error?.message ? [error.message] : []))),
  ];
  const content: JSX.Element =
    children ??
    (messages.length === 0 ? null : messages.length === 1 ? (
      messages[0]
    ) : (
      <ul class="ml-4 flex list-disc flex-col gap-1">
        {list(messages, (message) => (
          <li>{message}</li>
        ))}
      </ul>
    ));
  return content === null || content === undefined ? null : (
    <div
      role="alert"
      data-slot="field-error"
      class={cn('text-sm font-normal text-destructive', className)}
      {...rest}
    >
      {content}
    </div>
  );
});
