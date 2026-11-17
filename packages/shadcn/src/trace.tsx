import { view } from 'effectweb';
import type { Native, Styled } from './types.js';
import { cn } from './cn.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './collapsible.js';
import ChevronRight from '@effectweb/lucide/icons/chevron-right';

/** Trace part of the trace component. */
export const Trace = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="trace"
      class={cn(
        'flex w-full min-w-0 flex-col gap-2 *:has-[>[data-slot=trace-line]]:flex *:has-[>[data-slot=trace-line]]:w-fit *:has-[>[data-slot=trace-line]]:max-w-full *:has-[>[data-slot=trace-line]]:min-w-0 *:has-[>[data-slot=trace-line]]:rounded-md *:has-[>[data-slot=trace-line]]:text-left *:has-[>[data-slot=trace-line]]:outline-none *:has-[>[data-slot=trace-line]]:focus-visible:ring-3 *:has-[>[data-slot=trace-line]]:focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
});

/** Trace line part of the trace component. */
export const TraceLine = view<
  (Native<'span'> & Styled) & { status?: 'running' | 'error' | 'pending' }
>(({ class: className, status, ...props }) => {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      class={cn(
        'flex w-fit max-w-full min-w-0 items-center gap-2 text-sm text-muted-foreground transition-colors in-[a,button]:cursor-pointer in-[a:hover,button:hover]:text-foreground data-[status=error]:text-destructive data-[status=error]:in-[a:hover,button:hover]:text-destructive data-[status=pending]:opacity-60 data-[status=running]:*:data-[slot=trace-title]:shimmer',
        className,
      )}
      {...props}
    />
  );
});

/** Trace icon part of the trace component. */
export const TraceIcon = view<Native<'span'> & Styled>(({ class: className, ...props }) => {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      class={cn(
        "flex size-4 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [[data-slot=trace-title]~&]:-ml-1",
        className,
      )}
      {...props}
    />
  );
});

/** Trace title part of the trace component. */
export const TraceTitle = view<Native<'span'> & Styled>(({ class: className, ...props }) => {
  return (
    <span
      data-slot="trace-title"
      class={cn('min-w-0 truncate motion-reduce:shimmer-none', className)}
      {...props}
    />
  );
});

/** Trace description part of the trace component. */
export const TraceDescription = view<Native<'span'> & Styled>(({ class: className, ...props }) => {
  return (
    <span
      data-slot="trace-description"
      class={cn('shrink-0 text-muted-foreground/70 tabular-nums', className)}
      {...props}
    />
  );
});

/** Trace collapsible part of the trace component. */
export const TraceCollapsible = view<Parameters<typeof Collapsible>[0]>(
  ({ class: className, ...props }) => {
    return (
      <Collapsible
        data-slot="trace-collapsible"
        class={cn('flex w-full min-w-0 flex-col', className)}
        {...props}
      />
    );
  },
);

/** Trace collapsible trigger part of the trace component. */
export const TraceCollapsibleTrigger = view<Parameters<typeof CollapsibleTrigger>[0]>(
  ({ class: className, children, ...props }) => {
    return (
      <CollapsibleTrigger
        data-slot="trace-collapsible-trigger"
        class={cn(
          'group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 has-[[data-status=error]]:text-destructive',
          className,
        )}
        {...props}
      >
        {children}
        <TraceIcon class="transition-transform group-aria-expanded/trace-collapsible-trigger:rotate-90">
          <ChevronRight />
        </TraceIcon>
      </CollapsibleTrigger>
    );
  },
);

/** Trace collapsible content part of the trace component. */
export const TraceCollapsibleContent = view<Parameters<typeof CollapsibleContent>[0]>(
  ({ class: className, children, ...props }) => {
    return (
      <CollapsibleContent
        data-slot="trace-collapsible-content"
        class="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0"
        {...props}
      >
        <div
          data-slot="trace-collapsible-content-inner"
          class={cn(
            'mt-2 mb-1 ml-[calc(--spacing(2)-1px)] min-w-0 border-l pr-1 pl-4 leading-relaxed wrap-break-word text-muted-foreground',
            className,
          )}
        >
          {children}
        </div>
      </CollapsibleContent>
    );
  },
);
