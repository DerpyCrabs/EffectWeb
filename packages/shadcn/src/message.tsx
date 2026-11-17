import { view } from 'effectweb';
import type { Native, Styled } from './types.js';
import { cn } from './cn.js';

/** Message group part of the message component. */
export const MessageGroup = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="message-group"
      class={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    />
  );
});

/** Message part of the message component. */
export const Message = view<(Native<'div'> & Styled) & { align?: 'start' | 'end' }>(
  ({ class: className, align = 'start', ...props }) => {
    return (
      <div
        data-slot="message"
        data-align={align}
        class={cn(
          'group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse',
          className,
        )}
        {...props}
      />
    );
  },
);

/** Message avatar part of the message component. */
export const MessageAvatar = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="message-avatar"
      class={cn(
        'flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted group-has-data-[slot=message-footer]/message:-translate-y-8',
        className,
      )}
      {...props}
    />
  );
});

/** Message content part of the message component. */
export const MessageContent = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="message-content"
      class={cn(
        'flex w-full min-w-0 flex-col gap-2.5 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end',
        className,
      )}
      {...props}
    />
  );
});

/** Message header part of the message component. */
export const MessageHeader = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="message-header"
      class={cn(
        'flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0',
        className,
      )}
      {...props}
    />
  );
});

/** Message footer part of the message component. */
export const MessageFooter = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="message-footer"
      class={cn(
        'flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end',
        className,
      )}
      {...props}
    />
  );
});
