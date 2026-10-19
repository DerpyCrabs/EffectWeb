// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mount } from 'effectweb';
import { createNumberField, NumberFieldInput, NumberFieldIncrement } from './number-field.js';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});
function fixture(controlled = false) {
  const changed = vi.fn(),
    committed = vi.fn();
  const field = createNumberField({
    ...(controlled ? { value: 2 } : { defaultValue: 2 }),
    onValueChange: changed,
    onValueCommitted: committed,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const inputHost = document.createElement('div'),
    buttonHost = document.createElement('div');
  host.append(inputHost, buttonHost);
  const app = mount(inputHost, NumberFieldInput, { numberField: field }),
    buttonApp = mount(buttonHost, NumberFieldIncrement, { numberField: field });
  cleanups.push(() => {
    app.dispose();
    buttonApp.dispose();
    field.lifetime.dispose();
  });
  return {
    field,
    changed,
    committed,
    input: host.querySelector('input')!,
    button: host.querySelector('button')!,
  };
}
it('commits typed edits on blur once and keyboard steps immediately', () => {
  const { input, changed, committed } = fixture();
  input.value = '8';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(changed).toHaveBeenLastCalledWith(8);
  expect(committed).not.toHaveBeenCalled();
  input.dispatchEvent(new FocusEvent('blur'));
  expect(committed).toHaveBeenCalledExactlyOnceWith(
    8,
    expect.objectContaining({ reason: 'input-blur' }),
  );
  input.dispatchEvent(new FocusEvent('blur'));
  expect(committed).toHaveBeenCalledTimes(1);
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
  );
  expect(committed).toHaveBeenLastCalledWith(9, expect.objectContaining({ reason: 'keyboard' }));
});
it('commits the requested value for a controlled field before a parent echoes it', () => {
  const { button, changed, committed, field } = fixture(true);
  button.click();
  expect(changed).toHaveBeenLastCalledWith(3);
  expect(field.source.model().value).toBe(2);
  expect(committed).toHaveBeenCalledExactlyOnceWith(
    3,
    expect.objectContaining({ reason: 'increment-press' }),
  );
});
it('commits held-button repetition on release without duplicating the following click', () => {
  vi.useFakeTimers();
  const { button, committed } = fixture();
  button.setPointerCapture = () => {};
  button.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true }));
  vi.advanceTimersByTime(520);
  expect(committed).not.toHaveBeenCalled();
  button.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  expect(committed).toHaveBeenCalledExactlyOnceWith(
    4,
    expect.objectContaining({ reason: 'increment-press' }),
  );
  button.click();
  expect(committed).toHaveBeenCalledTimes(1);
});
it('does not commit prevented edits or work after owner disposal', () => {
  const { input, committed, field } = fixture();
  field.setValue(7);
  field.lifetime.dispose();
  input.dispatchEvent(new FocusEvent('blur'));
  expect(committed).not.toHaveBeenCalled();
});
