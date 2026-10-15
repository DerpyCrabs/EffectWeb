import { createRadioGroup } from '@effectweb/base-ui';
import { RadioInput, RadioGroupRoot, RadioGroupItem as BaseItem } from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, list, observe, view, type JSX } from 'effectweb';
import { cn } from './cn.js';

export interface RadioOption {
  readonly value: string;
  readonly label: JSX.Element;
  readonly description?: JSX.Element;
  readonly disabled?: boolean | undefined;
}

export interface RadioGroupProps {
  readonly name: string;
  readonly options: ReadonlyArray<RadioOption>;
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  readonly class?: string | undefined;
  readonly 'aria-label'?: string | undefined;
  readonly invalid?: boolean | undefined;
}

/** The shared classes for native radio inputs. */
export const radioClass =
  'group/radio-group-item peer relative flex aspect-square size-4 shrink-0 cursor-default appearance-none rounded-full border border-input outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 checked:border-primary checked:bg-primary dark:checked:bg-primary before:absolute before:top-1/2 before:left-1/2 before:size-2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-primary-foreground before:opacity-0 before:content-[""] checked:before:opacity-100';

/** Labelled radio buttons sharing a controller, with hidden native inputs for form submission. */
export const RadioGroup = controllerView(
  {
    controller: (props: RadioGroupProps) =>
      primitiveAdapter(
        props,
        createRadioGroup,
        (read) => ({
          value: props.value ?? '',
          onValueChange: (value) => read().onValueChange(value),
        }),
        (next) => ({ value: next.value ?? '' }),
      ),
  },
  view((model) => {
    const props = model.props;
    return (
      <RadioGroupRoot
        radioGroup={model.actions.handle}
        role="radiogroup"
        data-slot="radio-group"
        aria-label={props['aria-label']}
        class={cn('grid w-full gap-2', props.class)}
      >
        {list(
          props.options,
          (option) => option.value,
          (option) => (
            <label
              data-slot="radio-group-option"
              class="flex items-start gap-2 text-sm leading-none font-medium select-none has-disabled:opacity-50"
            >
              <RadioGroupItem
                radioGroup={model.actions.handle}
                data-slot="radio-group-item"
                name={props.name}
                value={option.value}
                disabled={option.disabled}
                aria-invalid={props.invalid ? 'true' : undefined}
              />
              <span class="flex flex-col gap-1">
                <span>{option.label}</span>
                {option.description ? (
                  <span class="text-sm font-normal text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          ),
        )}
      </RadioGroupRoot>
    );
  }),
);

export type RadioGroupItemProps = Parameters<typeof BaseItem>[0] & {
  readonly name?: string | undefined;
};
/** A styled radio button; takes the `radioGroup` handle and a `value`. */
export const RadioGroupItem = view<RadioGroupItemProps>(({ class: className, name, ...props }) => (
  <>
    <BaseItem
      {...props}
      data-slot="radio-group-item"
      class={cn(
        'group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary',
        className,
      )}
    >
      {observe(props.radioGroup.source, (state) =>
        state.value === props.value ? (
          <span data-slot="radio-group-indicator" class="flex size-4 items-center justify-center">
            <span class="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
          </span>
        ) : null,
      )}
    </BaseItem>
    {name ? (
      <RadioInput
        radioGroup={props.radioGroup}
        value={props.value}
        name={name}
        disabled={props.disabled}
        hidden
        tabindex={-1}
        aria-hidden="true"
      />
    ) : null}
  </>
));
