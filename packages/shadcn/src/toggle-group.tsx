import { createToggleGroup } from '@effectweb/base-ui';
import { ToggleGroupRoot, ToggleGroupItem as BaseItem } from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, list, view, type JSX } from 'effectweb';
import { cn, type VariantProps } from './cn.js';
import { toggleVariants } from './toggle.js';

export interface ToggleGroupItemConfig {
  readonly value: string;
  readonly label: JSX.Element;
  readonly disabled?: boolean | undefined;
  readonly 'aria-label'?: string | undefined;
}

export type ToggleGroupProps = VariantProps<typeof toggleVariants> & {
  readonly items: ReadonlyArray<ToggleGroupItemConfig>;
  /** The pressed values. One at most when `multiple` is not set. */
  readonly value: ReadonlyArray<string>;
  readonly onValueChange: (value: ReadonlyArray<string>) => void;
  readonly multiple?: boolean | undefined;
  readonly spacing?: number | undefined;
  readonly orientation?: 'horizontal' | 'vertical' | undefined;
  readonly class?: string | undefined;
  readonly 'aria-label'?: string | undefined;
};

/** Toggles that share a selection: one pressed at a time, or several with `multiple`. */
export const ToggleGroup = controllerView(
  {
    controller: (props: ToggleGroupProps) =>
      primitiveAdapter(
        props,
        createToggleGroup,
        (read) => ({
          values: props.value,
          multiple: props.multiple,
          orientation: props.orientation,
          onValuesChange: (value) => read().onValueChange(value),
        }),
        (next) => ({ values: next.value }),
        (next) => ({
          multiple: next.multiple ?? false,
          orientation: next.orientation ?? 'horizontal',
        }),
      ),
  },
  view((model) => {
    const props = model.props;
    const spacing = props.spacing ?? 2;
    return (
      <ToggleGroupRoot
        toggleGroup={model.actions.handle}
        role="group"
        aria-label={props['aria-label']}
        data-slot="toggle-group"
        data-variant={props.variant ?? 'default'}
        data-size={props.size ?? 'default'}
        data-spacing={spacing}
        data-orientation={props.orientation ?? 'horizontal'}
        style={{ '--gap': spacing }}
        class={cn(
          'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch',
          props.class,
        )}
      >
        {list(
          props.items,
          (item) => item.value,
          (item) => (
            <ToggleGroupItem
              toggleGroup={model.actions.handle}
              value={item.value}
              type="button"
              data-slot="toggle-group-item"
              data-variant={props.variant ?? 'default'}
              data-size={props.size ?? 'default'}
              data-spacing={spacing}
              data-state={props.value.includes(item.value) ? 'on' : 'off'}
              aria-pressed={props.value.includes(item.value)}
              aria-label={item['aria-label']}
              disabled={item.disabled}
              variant={props.variant}
              size={props.size}
              spacing={spacing}
            >
              {item.label}
            </ToggleGroupItem>
          ),
        )}
      </ToggleGroupRoot>
    );
  }),
);

export type ToggleGroupItemProps = Parameters<typeof BaseItem>[0] &
  VariantProps<typeof toggleVariants> & { readonly spacing?: number | undefined };
/** A styled toggle inside a group. */
export const ToggleGroupItem = view<ToggleGroupItemProps>(
  ({ class: className, variant = 'default', size = 'default', spacing = 2, ...props }) => (
    <BaseItem
      {...props}
      data-slot="toggle-group-item"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      class={cn(
        'shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t',
        toggleVariants({ variant, size }),
        className,
      )}
    />
  ),
);
