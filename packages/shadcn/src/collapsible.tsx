import { createCollapsible } from '@effectweb/base-ui';
import {
  CollapsibleRoot,
  CollapsibleTrigger as BaseTrigger,
  CollapsiblePanel,
} from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, view, type JSX } from 'effectweb';
import { cn } from './cn.js';

export interface CollapsibleProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** The summary line the user clicks. */
  readonly trigger: JSX.Element;
  readonly children?: JSX.Element;
  readonly class?: string | undefined;
  readonly triggerClass?: string | undefined;
  readonly contentClass?: string | undefined;
}

/** A disclosure with explicit trigger/panel relationships. */
export const Collapsible = controllerView(
  {
    controller: (props: CollapsibleProps) =>
      primitiveAdapter(
        props,
        createCollapsible,
        (read) => ({
          get open() {
            return read().open;
          },
          defaultOpen: props.defaultOpen,
          onOpenChange: (open) => read().onOpenChange?.(open),
        }),
        (next) => (next.open !== undefined ? { open: next.open } : {}),
      ),
  },
  view((model) => (
    <CollapsibleRoot
      collapsible={model.actions.handle}
      data-slot="collapsible"
      class={cn('group/collapsible', model.props.class)}
    >
      <CollapsibleTrigger
        collapsible={model.actions.handle}
        data-slot="collapsible-trigger"
        class={model.props.triggerClass}
      >
        {model.props.trigger}
      </CollapsibleTrigger>
      <CollapsibleContent
        collapsible={model.actions.handle}
        data-slot="collapsible-content"
        class={model.props.contentClass}
      >
        {model.props.children}
      </CollapsibleContent>
    </CollapsibleRoot>
  )),
);

/** The styled collapsible trigger. */
export const CollapsibleTrigger = view<Parameters<typeof BaseTrigger>[0]>((props) => (
  <BaseTrigger {...props} data-slot="collapsible-trigger" />
));
/** The styled collapsible panel. */
export const CollapsibleContent = view<Parameters<typeof CollapsiblePanel>[0]>((props) => (
  <CollapsiblePanel {...props} data-slot="collapsible-content" />
));
