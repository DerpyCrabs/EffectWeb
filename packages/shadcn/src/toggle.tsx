import { createToggle } from '@effectweb/base-ui';
import { Toggle as BaseToggle } from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, view } from 'effectweb';
import { cn, cva, type VariantProps } from './cn.js';
import type { Native, Styled } from './types.js';

/** Classes for toggle sizes and default or outline variants. */
export const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-muted',
      },
      size: {
        default:
          'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ToggleProps = Omit<Native<'button'>, 'onClick'> &
  Styled &
  VariantProps<typeof toggleVariants> & {
    readonly pressed: boolean;
    readonly onPressedChange?: ((pressed: boolean) => void) | undefined;
  };

/** A two-state button; `pressed` is the state and `onPressedChange` asks for the other one. */
export const Toggle = controllerView(
  {
    controller: (props: ToggleProps) =>
      primitiveAdapter(
        props,
        createToggle,
        (read) => ({
          checked: props.pressed,
          disabled: props.disabled ?? false,
          onCheckedChange: (value) => read().onPressedChange?.(value),
        }),
        (next) => ({ checked: next.pressed, disabled: next.disabled ?? false }),
      ),
  },
  view((model) => {
    const {
      class: className,
      variant,
      size,
      pressed,
      onPressedChange: _onPressedChange,
      children,
      ...rest
    } = model.props;
    return (
      <BaseToggle
        toggle={model.actions.handle}
        type="button"
        data-slot="toggle"
        aria-pressed={pressed}
        data-state={pressed ? 'on' : 'off'}
        class={cn(toggleVariants({ variant, size }), className)}
        {...rest}
      >
        {children}
      </BaseToggle>
    );
  }),
);
