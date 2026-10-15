import { createSwitch } from '@effectweb/base-ui';
import { SwitchRoot as BaseSwitch } from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, view } from 'effectweb';
import { cn } from './cn.js';
import type { Native } from './types.js';

export type SwitchProps = Omit<Native<'input'>, 'type' | 'checked'> & {
  readonly class?: string | undefined;
  readonly checked: boolean;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
  readonly size?: 'sm' | 'default' | undefined;
};

/** A native checkbox with `role="switch"`, drawn as a track whose thumb is a pseudo-element. */
export const Switch = controllerView(
  {
    controller: (props: SwitchProps) =>
      primitiveAdapter(
        props,
        createSwitch,
        (read) => ({
          checked: props.checked,
          disabled: props.disabled ?? false,
          onCheckedChange: (value) => {
            const props = read();
            props.onCheckedChange?.(value);
          },
        }),
        (next) => ({ checked: next.checked, disabled: next.disabled ?? false }),
      ),
  },
  view((model) => {
    const {
      class: className,
      checked,
      onCheckedChange: _onCheckedChange,
      size,
      ...rest
    } = model.props;
    return (
      <BaseSwitch
        switch={model.actions.handle}
        type="checkbox"
        role="switch"
        data-slot="switch"
        data-size={size ?? 'default'}
        data-state={checked ? 'checked' : 'unchecked'}
        class={cn(
          'peer group/switch relative inline-flex shrink-0 cursor-default appearance-none items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 checked:bg-primary bg-input dark:bg-input/80 disabled:cursor-not-allowed disabled:opacity-50',
          "before:pointer-events-none before:absolute before:top-1/2 before:left-0 before:block before:-translate-y-1/2 before:rounded-full before:bg-background before:transition-transform before:content-[''] data-[size=default]:before:size-4 data-[size=sm]:before:size-3 data-[size=default]:checked:before:translate-x-[calc(100%-2px)] data-[size=sm]:checked:before:translate-x-[calc(100%-2px)] dark:before:bg-foreground dark:checked:before:bg-primary-foreground",
          className,
        )}
        {...rest}
      />
    );
  }),
);
