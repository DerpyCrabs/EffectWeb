import { controllerView, modelOwner, view, type JSX } from 'effectweb';
import { createTooltip, TooltipPopup } from '@effectweb/base-ui';
import { tooltipHostBinding } from '@effectweb/base-ui/tooltip-host';
import { cn } from './cn.js';
import type { Align, Side } from './placement.js';
export interface TooltipProps {
  readonly content: JSX.Element;
  /** The trigger: a button or link. The tooltip describes it (`aria-describedby`). */
  readonly children: JSX.Element;
  readonly side?: Side | undefined;
  readonly align?: Align | undefined;
  readonly sideOffset?: number | undefined;
  readonly delay?: number | undefined;
  readonly class?: string | undefined;
}

function tooltipController(props: TooltipProps) {
  const owner = modelOwner({ props });
  const tooltip = createTooltip();
  owner.own(tooltip.lifetime);
  return {
    source: owner.source,
    tooltip,
    lifetime: owner,
    receive: (next: TooltipProps) => owner.patch({ props: next }),
  };
}
/** Shown while the trigger is hovered or focused; Escape hides it. A manual popover, so it sits in the top layer. */
export const Tooltip = controllerView(
  { controller: tooltipController },
  view((model) => {
    const props = model.props;
    return (
      <span
        data-slot="tooltip"
        class="contents"
        data-side={props.side ?? 'top'}
        data-align={props.align ?? 'center'}
        data-offset={props.sideOffset ?? 4}
        data-delay={props.delay ?? 0}
        use={tooltipHostBinding({ handle: model.actions.tooltip, delay: props.delay ?? 0 })}
      >
        {props.children}
        <TooltipPopup
          tooltip={model.actions.tooltip}
          side={props.side ?? 'top'}
          align={props.align}
          sideOffset={props.sideOffset}
          data-slot="tooltip-content"
          class={cn(
            'z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 open:animate-in open:fade-in-0 open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            props.class,
          )}
        >
          {props.content}
        </TooltipPopup>
      </span>
    );
  }),
);
