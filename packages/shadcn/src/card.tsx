import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

type DivProps = Native<'div'> & Styled;

/** A card container with default or small spacing. */
export const Card = view<
  Native<'section'> &
    Styled & {
      readonly size?: 'default' | 'sm' | undefined;
      readonly as?: 'div' | 'section' | 'article' | undefined;
    }
>(({ class: className, size, as = 'div', children, ...rest }) => {
  const props = {
    ...rest,
    'data-slot': 'card',
    'data-size': size ?? 'default',
    class: cn(
      'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
      className,
    ),
  };
  if (as === 'section') return <section {...props}>{children}</section>;
  if (as === 'article') return <article {...props}>{children}</article>;
  return <div {...props}>{children}</div>;
});

/** The heading area of a card, with room for an action. */
export const CardHeader = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="card-header"
    class={cn(
      'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** The title text of a card. */
export const CardTitle = view<
  DivProps & { readonly as?: 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | undefined }
>(({ class: className, as = 'div', children, ...rest }) => {
  const props = {
    ...rest,
    'data-slot': 'card-title',
    class: cn(
      'cn-font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm',
      className,
    ),
  };
  if (as === 'h1') return <h1 {...props}>{children}</h1>;
  if (as === 'h2') return <h2 {...props}>{children}</h2>;
  if (as === 'h3') return <h3 {...props}>{children}</h3>;
  if (as === 'h4') return <h4 {...props}>{children}</h4>;
  if (as === 'h5') return <h5 {...props}>{children}</h5>;
  if (as === 'h6') return <h6 {...props}>{children}</h6>;
  return <div {...props}>{children}</div>;
});

/** Supporting text in a card header. */
export const CardDescription = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="card-description"
    class={cn('text-sm text-muted-foreground', className)}
    {...rest}
  >
    {children}
  </div>
));

/** An action aligned alongside the card title and description. */
export const CardAction = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="card-action"
    class={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
    {...rest}
  >
    {children}
  </div>
));

/** The padded body of a card. */
export const CardContent = view<DivProps>(({ class: className, children, ...rest }) => (
  <div data-slot="card-content" class={cn('px-(--card-spacing)', className)} {...rest}>
    {children}
  </div>
));

/** The action area at the bottom of a card. */
export const CardFooter = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="card-footer"
    class={cn('flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)', className)}
    {...rest}
  >
    {children}
  </div>
));
