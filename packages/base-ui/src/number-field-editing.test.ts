// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mount } from 'effectweb';
import { createNumberField, NumberFieldInput, type NumberFieldOptions } from './number-field.js';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});
function fixture(options: NumberFieldOptions = {}) {
  const changed = vi.fn(),
    committed = vi.fn();
  const field = createNumberField({
    onValueChange: changed,
    onValueCommitted: committed,
    ...options,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const app = mount(host, NumberFieldInput, { numberField: field });
  cleanups.push(() => {
    app.dispose();
    field.lifetime.dispose();
  });
  const input = host.querySelector('input')!;
  const type = (text: string, composing = false) => {
    input.value = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
    expect(input.value).toBe(text);
  };
  const blur = () => input.dispatchEvent(new FocusEvent('blur'));
  return { field, input, type, blur, changed, committed };
}
it('keeps partial and out-of-range text until blur, without step-rounding typed decimals', () => {
  const f = fixture({ min: 10, max: 20 });
  f.type('1');
  expect(f.field.source.model().value).toBe(1);
  f.type('12');
  f.type('12.');
  f.type('12.5');
  f.blur();
  expect(f.input.value).toBe('12.5');
  expect(f.committed).toHaveBeenLastCalledWith(
    12.5,
    expect.objectContaining({ reason: 'input-blur' }),
  );
  f.type('25');
  f.blur();
  expect(f.input.value).toBe('20');
  expect(f.changed).toHaveBeenLastCalledWith(20);
});
it('preserves localized signs and separators, and restores invalid text on blur', () => {
  const f = fixture({ locale: 'de-DE' });
  f.type('-');
  expect(f.changed).not.toHaveBeenCalled();
  f.type('-1');
  f.type('-1,');
  f.type('-1,25');
  f.blur();
  expect(f.input.value).toBe('-1,25');
  expect(f.field.source.model().value).toBe(-1.25);
  f.type('-');
  f.blur();
  expect(f.input.value).toBe('-1,25');
  f.type('');
  f.blur();
  expect(f.field.source.model().value).toBeNull();
  expect(f.input.value).toBe('');
});
it('does not publish numeric composition until the composition ends', () => {
  const f = fixture();
  f.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  f.type('12', true);
  expect(f.changed).not.toHaveBeenCalled();
  f.input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', isComposing: true, bubbles: true }),
  );
  expect(f.changed).not.toHaveBeenCalled();
  f.input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  expect(f.changed).toHaveBeenCalledExactlyOnceWith(12);
  f.blur();
  expect(f.committed).toHaveBeenCalledExactlyOnceWith(
    12,
    expect.objectContaining({ reason: 'input-blur' }),
  );
});
it('preserves a controlled draft but restores the accepted value on blur without duplicate requests', () => {
  const f = fixture({ value: 2 });
  f.type('8');
  f.input.dispatchEvent(new Event('change', { bubbles: true }));
  f.blur();
  expect(f.changed).toHaveBeenCalledExactlyOnceWith(8);
  expect(f.field.source.model().value).toBe(2);
  expect(f.input.value).toBe('2');
});
it('keeps intermediate formatting when a controlled parent echoes, and accepts external replacements', () => {
  const f = fixture({ value: 1, locale: 'de-DE' });
  f.type('1,');
  f.field.sync({ value: 1, locale: 'de-DE' });
  expect(f.input.value).toBe('1,');
  f.type('1,5');
  f.field.sync({ value: 1.5, locale: 'de-DE' });
  expect(f.input.value).toBe('1,5');
  f.field.sync({ value: 7, locale: 'de-DE' });
  expect(f.input.value).toBe('7');
});

it('commits a controlled value once after its parent synchronously accepts the edit', () => {
  const committed = vi.fn();
  let field: ReturnType<typeof createNumberField>;
  const changed = vi.fn((value: number | null) =>
    field.sync({ value, onValueChange: changed, onValueCommitted: committed }),
  );
  const f = fixture({ value: 1, onValueChange: changed, onValueCommitted: committed });
  field = f.field;
  f.type('2.');
  expect(f.input.value).toBe('2.');
  f.blur();
  expect(f.input.value).toBe('2');
  expect(changed).toHaveBeenCalledExactlyOnceWith(2);
  expect(committed).toHaveBeenCalledExactlyOnceWith(
    2,
    expect.objectContaining({ reason: 'input-blur' }),
  );
});
