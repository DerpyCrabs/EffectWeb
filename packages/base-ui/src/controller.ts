import { modelOwner, mapSource, type ControllerLifetime, type DisposableOwner } from 'effectweb';

let sequence = 0;
/** Common controller identity and keyboard configuration, without family state. */
export interface ControllerOptions {
  readonly id?: string | undefined;
  readonly orientation?: 'horizontal' | 'vertical' | undefined;
  readonly multiple?: boolean | undefined;
}
/** Disabled state shared by interactive controls. */
export interface DisabledState {
  readonly disabled: boolean;
}
/** Visibility state for overlays and disclosures. */
export interface OpenState extends DisabledState {
  readonly open: boolean;
}
/** Single string selection state. */
export interface ValueState extends DisabledState {
  readonly value: string;
  readonly dirty: boolean;
}
/** Multiple string selection state. */
export interface ValuesState extends DisabledState {
  readonly values: readonly string[];
  readonly dirty: boolean;
}
/** Native checked control state. */
export interface CheckedState extends DisabledState {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly dirty: boolean;
}
export interface OpenOptions extends ControllerOptions, Omit<Partial<OpenState>, 'open'> {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}
export interface ValueOptions extends ControllerOptions, Partial<ValueState> {
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
}
export interface ValuesOptions extends ControllerOptions, Partial<ValuesState> {
  readonly defaultValues?: readonly string[] | undefined;
  readonly onValuesChange?: ((values: readonly string[]) => void) | undefined;
}
export interface CheckedOptions extends ControllerOptions, Partial<CheckedState> {
  readonly defaultChecked?: boolean | undefined;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
}
/** Own exactly the supplied state; family factories add only their valid actions. */
export function createStateController<S extends object>(state: S, options: ControllerOptions = {}) {
  const owner = modelOwner<{ state: S }>({ state });
  let orientation = options.orientation ?? 'horizontal';
  let multiple = options.multiple ?? false;
  return {
    id: options.id ?? `base-ui-${++sequence}`,
    source: mapSource(owner.source, (model) => model.state),
    lifetime: owner as ControllerLifetime & DisposableOwner,
    get orientation() {
      return orientation;
    },
    get multiple() {
      return multiple;
    },
    configure: (next: ControllerOptions) => {
      orientation = next.orientation ?? orientation;
      multiple = next.multiple ?? multiple;
      owner.patch({ state: { ...owner.read().state } });
    },
    sync: (next: Partial<S>) => owner.patch({ state: { ...owner.read().state, ...next } }),
  };
}
/** Create visibility actions without selection or checked state. */
export function createOpenController(options: OpenOptions = {}) {
  const state = createStateController<OpenState>(
    { open: options.open ?? options.defaultOpen ?? false, disabled: options.disabled ?? false },
    options,
  );
  const setOpen = (open: boolean) => {
    if (state.source.model().disabled || state.source.model().open === open) return;
    if (options.open === undefined) state.sync({ open });
    options.onOpenChange?.(open);
  };
  return Object.assign(state, { setOpen, toggle: () => setOpen(!state.source.model().open) });
}
export type OpenHandle = ReturnType<typeof createOpenController>;
/** Create single-selection actions without visibility or checked state. */
export function createValueController(options: ValueOptions = {}) {
  const state = createStateController<ValueState>(
    {
      value: options.value ?? options.defaultValue ?? '',
      disabled: options.disabled ?? false,
      dirty: options.dirty ?? false,
    },
    options,
  );
  const initial = state.source.model().value;
  return Object.assign(state, {
    reset: () => {
      if (options.value === undefined) state.sync({ value: initial, dirty: false });
      else options.onValueChange?.(initial);
    },
    setValue: (value: string) => {
      if (state.source.model().disabled || state.source.model().value === value) return;
      if (options.value === undefined) state.sync({ value, dirty: true });
      options.onValueChange?.(value);
    },
  });
}
/** Create set-selection actions for accordion and toggle groups. */
export function createValuesController(options: ValuesOptions = {}) {
  const state = createStateController<ValuesState>(
    {
      values: options.values ?? options.defaultValues ?? [],
      disabled: options.disabled ?? false,
      dirty: options.dirty ?? false,
    },
    options,
  );
  return Object.assign(state, {
    toggleValue: (value: string) => {
      if (state.source.model().disabled) return;
      const current = state.source.model().values;
      const values = current.includes(value)
        ? current.filter((v) => v !== value)
        : state.multiple
          ? [...current, value]
          : [value];
      if (options.values === undefined) state.sync({ values, dirty: true });
      options.onValuesChange?.(values);
    },
  });
}
/** Create checked actions for native checkbox-style controls. */
export function createCheckedController(options: CheckedOptions = {}) {
  const state = createStateController<CheckedState>(
    {
      checked: options.checked ?? options.defaultChecked ?? false,
      indeterminate: options.indeterminate ?? false,
      disabled: options.disabled ?? false,
      dirty: options.dirty ?? false,
    },
    options,
  );
  const initial = state.source.model();
  return Object.assign(state, {
    reset: () => {
      if (options.checked === undefined)
        state.sync({
          checked: initial.checked,
          indeterminate: initial.indeterminate,
          dirty: false,
        });
      else options.onCheckedChange?.(initial.checked);
    },
    setChecked: (checked: boolean) => {
      if (state.source.model().disabled) return;
      if (options.checked === undefined) state.sync({ checked, indeterminate: false, dirty: true });
      options.onCheckedChange?.(checked);
    },
  });
}
