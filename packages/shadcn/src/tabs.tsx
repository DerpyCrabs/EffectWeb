import { createTabs } from '@effectweb/base-ui';
import { TabsList as BaseList, TabsTab, TabsPanel } from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { nextIndex } from '@effectweb/base-ui';
import { controllerView, list, view, type JSX } from 'effectweb';
import { cn, cva, type VariantProps } from './cn.js';

export interface TabItem {
  readonly value: string;
  readonly label: JSX.Element;
  readonly content: JSX.Element;
  readonly disabled?: boolean | undefined;
}

/** Classes for the default or line-style tab list. */
export const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: { variant: { default: 'bg-muted', line: 'gap-1 bg-transparent' } },
    defaultVariants: { variant: 'default' },
  },
);

export type TabsProps = VariantProps<typeof tabsListVariants> & {
  readonly items: ReadonlyArray<TabItem>;
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly orientation?: 'horizontal' | 'vertical' | undefined;
  readonly class?: string | undefined;
  readonly listClass?: string | undefined;
  readonly contentClass?: string | undefined;
  readonly 'aria-label'?: string | undefined;
};

const triggerClass = cn(
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
  'data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground',
  'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
);

/** The tab to move to for an arrow key, skipping disabled tabs and wrapping around. */
export const nextTab = (
  items: ReadonlyArray<Pick<TabItem, 'value' | 'disabled'>>,
  current: string,
  key: string,
  orientation: 'horizontal' | 'vertical',
): string | null => {
  const enabled = items.filter((item) => !item.disabled);
  if (!enabled.length) return null;
  const next = nextIndex(
    enabled.length,
    enabled.findIndex((item) => item.value === current),
    key,
    orientation,
  );
  return next === null ? null : enabled[next]!.value;
};

/** Tabs with their panels. Arrow keys move between tabs and select them; the active panel is the only one rendered. */
export const Tabs = controllerView(
  {
    controller: (props: TabsProps) =>
      primitiveAdapter(
        props,
        createTabs,
        (read) =>
          Object.defineProperty(
            {
              defaultValue:
                props.defaultValue ?? props.items.find((item) => !item.disabled)?.value ?? '',
              orientation: props.orientation,
              onValueChange: (value: string) => read().onValueChange?.(value),
            },
            'value',
            { get: () => read().value },
          ),
        (next) => (next.value !== undefined ? { value: next.value } : {}),
        (next) => ({ orientation: next.orientation ?? 'horizontal' }),
      ),
  },
  view((model) => (
    <div
      data-slot="tabs"
      data-orientation={model.props.orientation ?? 'horizontal'}
      class={cn('group/tabs flex gap-2 data-horizontal:flex-col', model.props.class)}
    >
      <TabsList
        tabs={model.actions.handle}
        aria-label={model.props['aria-label']}
        variant={model.props.variant}
        class={model.props.listClass}
      >
        {list(
          model.props.items,
          (item) => item.value,
          (item) => (
            <TabsTrigger
              tabs={model.actions.handle}
              value={item.value}
              disabled={item.disabled}
              data-slot="tabs-trigger"
              data-value={item.value}
            >
              {item.label}
            </TabsTrigger>
          ),
        )}
      </TabsList>
      {list(
        model.props.items,
        (item) => item.value,
        (item) => (
          <TabsContent
            tabs={model.actions.handle}
            value={item.value}
            data-slot="tabs-content"
            data-value={item.value}
            class={model.props.contentClass}
          >
            {item.content}
          </TabsContent>
        ),
      )}
    </div>
  )),
);

/** The styled tab list with `variant` default or line. */
export const TabsList = view<
  Parameters<typeof BaseList>[0] & VariantProps<typeof tabsListVariants>
>(({ class: className, variant = 'default', ...props }) => (
  <BaseList
    {...props}
    data-slot="tabs-list"
    data-variant={variant}
    class={cn(tabsListVariants({ variant }), className)}
  />
));
/** A styled tab. */
export const TabsTrigger = view<Parameters<typeof TabsTab>[0]>(({ class: className, ...props }) => (
  <TabsTab {...props} data-slot="tabs-trigger" class={cn(triggerClass, className)} />
));

/** A styled tab panel. */
export const TabsContent = view<Parameters<typeof TabsPanel>[0]>(
  ({ class: className, ...props }) => (
    <TabsPanel
      {...props}
      data-slot="tabs-content"
      class={cn('flex-1 text-sm outline-none', className)}
    />
  ),
);
