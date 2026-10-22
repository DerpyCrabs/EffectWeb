import { domBinding, list, observe, sequence, view } from 'effectweb';
import { createStateController, type ControllerOptions, type DisabledState } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned OTPField handle; pass it to the parts and own its lifetime. */
export interface OtpFieldState extends DisabledState {
  readonly value: string;
  readonly length: number;
  readonly readOnly: boolean;
  readonly dirty: boolean;
}
export interface OtpFieldOptions extends ControllerOptions {
  readonly value?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly dirty?: boolean | undefined;
  /** The number of characters; defaults to 6. */
  readonly length?: number | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  /** Called once every slot is filled. */
  readonly onComplete?: ((value: string) => void) | undefined;
  /** Accepted characters; defaults to digits. */
  readonly pattern?: RegExp | undefined;
}
const digits = /^[0-9]$/u;
/** Create an OTPField handle: the code, its length and per-slot edits shared by the slots and the hidden input. */
export const createOtpField = (options: OtpFieldOptions = {}) => {
  const length = Math.max(1, Math.floor(options.length ?? 6));
  const pattern = options.pattern ?? digits;
  const accept = (text: string) =>
    // oxlint-disable-next-line typescript/no-misused-spread -- A slot holds one code point; the pattern decides which.
    [...text]
      .filter((character) => pattern.test(character))
      .slice(0, length)
      .join('');
  const state = createStateController<OtpFieldState>(
    {
      value: accept(options.value ?? options.defaultValue ?? ''),
      length,
      disabled: options.disabled ?? false,
      readOnly: options.readOnly ?? false,
      dirty: options.dirty ?? false,
    },
    options,
  );
  const initial = state.source.model().value;
  const setValue = (next: string) => {
    const current = state.source.model();
    if (current.disabled || current.readOnly) return;
    const value = accept(next);
    if (value === current.value) return;
    if (options.value === undefined) state.sync({ value, dirty: true });
    options.onValueChange?.(value);
    if (value.length === length) options.onComplete?.(value);
  };
  return Object.assign(state, {
    length,
    pattern,
    setValue,
    /** Replace one slot; a shorter code keeps its position by padding with the removed slot. */
    setCharacter(index: number, character: string) {
      const value = state.source.model().value;
      const accepted = accept(character).slice(-1);
      if (!accepted) return;
      const slots = Array.from(value.padEnd(index, ' '), (character) => character);
      slots[index] = accepted;
      setValue(slots.join('').replace(/\s+$/u, ''));
    },
    /** Clear a slot and everything after it. */
    clearFrom(index: number) {
      setValue(state.source.model().value.slice(0, index));
    },
    reset: () => {
      if (options.value === undefined) state.sync({ value: initial, dirty: false });
      else options.onValueChange?.(initial);
    },
  });
};
export type OtpFieldHandle = ReturnType<typeof createOtpField>;
const slot = (root: HTMLElement, index: number) =>
  root.querySelector<HTMLInputElement>(`[data-otp-slot="${index}"]`);
const focusSlot = (element: HTMLElement, index: number) => {
  const root = element.closest<HTMLElement>('[data-otp-root]');
  const target = root && slot(root, index);
  if (target) {
    target.focus();
    target.select();
  }
};
/** The `group` container of the slots; publishes disabled, read-only and complete attributes. */
export const OtpFieldRoot = view<Native<'div'> & { readonly otpField: OtpFieldHandle }>(
  ({ otpField, ...rest }) =>
    observe(otpField.source, (state) => (
      <div
        {...rest}
        role="group"
        data-otp-root=""
        data-disabled={state.disabled ? '' : undefined}
        data-readonly={state.readOnly ? '' : undefined}
        data-complete={state.value.length === state.length ? '' : undefined}
      />
    )),
);
export type OtpFieldSlotProps = Native<'input'> & {
  readonly otpField: OtpFieldHandle;
  readonly index: number;
  /** Mask the character like a password field. */
  readonly mask?: boolean | undefined;
};
/** One character of the code. Typing advances, Backspace retreats, arrows move, and a paste fills the following slots. */
export const OtpFieldSlot = view<OtpFieldSlotProps>(
  ({ otpField, index, mask, onInput, onKeyDown, onPaste, onFocus, ...rest }) =>
    observe(otpField.source, (state) => {
      const character = state.value[index] ?? '';
      return (
        <input
          {...rest}
          type={mask ? 'password' : 'text'}
          inputmode={rest.inputmode ?? (otpField.pattern === digits ? 'numeric' : 'text')}
          autocomplete={rest.autocomplete ?? (index === 0 ? 'one-time-code' : 'off')}
          maxlength={1}
          value={character}
          disabled={state.disabled || rest.disabled}
          readonly={state.readOnly || rest.readonly}
          aria-label={rest['aria-label'] ?? `Character ${index + 1} of ${state.length}`}
          data-otp-slot={index}
          data-filled={character ? '' : undefined}
          data-active={index === Math.min(state.value.length, state.length - 1) ? '' : undefined}
          onFocus={(event) => {
            onFocus?.(event);
            if (!event.defaultPrevented) event.currentTarget.select();
          }}
          onInput={(event) => {
            onInput?.(event);
            if (event.defaultPrevented) return;
            const text = event.currentTarget.value;
            if (!text) {
              otpField.clearFrom(index);
              return;
            }
            if (text.length > 1) {
              otpField.setValue(state.value.slice(0, index) + text);
              focusSlot(
                event.currentTarget,
                Math.min(otpField.source.model().value.length, state.length - 1),
              );
              return;
            }
            otpField.setCharacter(index, text);
            const accepted = otpField.source.model().value[index];
            event.currentTarget.value = accepted ?? '';
            if (accepted && index < state.length - 1) focusSlot(event.currentTarget, index + 1);
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key === 'Backspace' && !event.currentTarget.value && index > 0) {
              event.preventDefault();
              otpField.clearFrom(index - 1);
              focusSlot(event.currentTarget, index - 1);
            } else if (event.key === 'ArrowLeft' && index > 0) {
              event.preventDefault();
              focusSlot(event.currentTarget, index - 1);
            } else if (event.key === 'ArrowRight' && index < state.length - 1) {
              event.preventDefault();
              focusSlot(event.currentTarget, index + 1);
            }
          }}
          onPaste={(event) => {
            onPaste?.(event);
            if (event.defaultPrevented) return;
            const text = event.clipboardData?.getData('text') ?? '';
            if (!text) return;
            event.preventDefault();
            otpField.setValue(state.value.slice(0, index) + text);
            focusSlot(
              event.currentTarget,
              Math.min(otpField.source.model().value.length, state.length - 1),
            );
          }}
        />
      );
    }),
);
/** Every slot of the field in order, for the common layout. */
export const OtpFieldSlots = view<
  Omit<OtpFieldSlotProps, 'index'> & { readonly otpField: OtpFieldHandle }
>(({ otpField, ...rest }) =>
  list(sequence(Array.from({ length: otpField.length }, (_, index) => index)), (index) => (
    <OtpFieldSlot {...rest} otpField={otpField} index={index} />
  )),
);
const acquireReset = (element: HTMLInputElement, current: () => OtpFieldHandle) => {
  const form = element.form;
  const reset = () => queueMicrotask(() => current().reset());
  form?.addEventListener('reset', reset);
  return () => form?.removeEventListener('reset', reset);
};
/** A hidden input that submits the whole code under `name` and resets with its form. */
export const OtpFieldHiddenInput = view<Native<'input'> & { readonly otpField: OtpFieldHandle }>(
  ({ otpField, ...rest }) =>
    observe(otpField.source, (state) => (
      <input
        {...rest}
        type="hidden"
        value={state.value}
        disabled={state.disabled || rest.disabled}
        use={domBinding(otpField, acquireReset)}
      />
    )),
);
