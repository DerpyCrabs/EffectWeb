// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, view } from 'effectweb';
import {
  CheckboxGroupItem,
  CheckboxGroupParent,
  CheckboxGroupRoot,
  createCheckboxGroup,
} from './checkbox-group.js';
import { MeterRoot } from './meter.js';
import { createOtpField, OtpFieldHiddenInput, OtpFieldRoot, OtpFieldSlots } from './otp-field.js';
import { createForm, FormFieldError, FormRoot, formFieldBinding } from './form.js';
import { createField, FieldControl, FieldRoot } from './field.js';
import { createPreviewCard, PreviewCardPopup, PreviewCardTrigger } from './preview-card.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const render = (element: () => ReturnType<typeof view>) => {
  const host = document.body.appendChild(document.createElement('div'));
  const rendered = mount(host, element() as never, {
    model: () => ({}),
    subscribe: () => () => {},
  });
  cleanup.push(() => rendered.dispose());
  return host;
};
const input = (event: Element, value: string) => {
  (event as HTMLInputElement).value = value;
  event.dispatchEvent(new Event('input', { bubbles: true }));
};

it('a checkbox group keeps values and a parent checkbox selects, clears and shows mixed state', async () => {
  const changes: (readonly string[])[] = [];
  const group = createCheckboxGroup({
    allValues: ['a', 'b', 'c'],
    defaultValues: ['a'],
    onValuesChange: (values) => changes.push(values),
  });
  cleanup.push(() => group.lifetime.dispose());
  const host = render(() =>
    view(() => (
      <CheckboxGroupRoot checkboxGroup={group}>
        <CheckboxGroupParent checkboxGroup={group} data-testid="parent" />
        <CheckboxGroupItem checkboxGroup={group} value="a" />
        <CheckboxGroupItem checkboxGroup={group} value="b" />
        <CheckboxGroupItem checkboxGroup={group} value="c" />
      </CheckboxGroupRoot>
    )),
  );
  await tick();
  await tick();
  const parent = host.querySelector<HTMLInputElement>('[data-testid=parent]')!;
  const items = [...host.querySelectorAll<HTMLInputElement>('input[value]')];
  expect(items.map((item) => item.checked)).toEqual([true, false, false]);
  expect(parent.getAttribute('aria-checked')).toBe('mixed');
  items[1]!.click();
  await tick();
  expect(group.source.model().values).toEqual(['a', 'b']);
  parent.click();
  await tick();
  expect(group.source.model().values).toEqual(['a', 'b', 'c']);
  expect(parent.getAttribute('aria-checked')).toBe('true');
  parent.click();
  await tick();
  expect(group.source.model().values).toEqual([]);
  expect(changes.at(-1)).toEqual([]);
  group.reset();
  expect(group.source.model()).toMatchObject({ values: ['a'], dirty: false });
});

it('a meter clamps its value and reports the region', () => {
  const host = render(() => view(() => <MeterRoot value={130} max={100} low={30} high={80} />));
  const meter = host.querySelector('[role=meter]')!;
  expect(meter.getAttribute('aria-valuenow')).toBe('100');
  expect(meter.getAttribute('data-region')).toBe('high');
  expect(meter.hasAttribute('data-complete')).toBe(true);
});

it('an OTP field advances, retreats, accepts a paste and completes', async () => {
  const completed: string[] = [];
  const otp = createOtpField({ length: 4, onComplete: (value) => completed.push(value) });
  cleanup.push(() => otp.lifetime.dispose());
  const host = render(() =>
    view(() => (
      <form>
        <OtpFieldRoot otpField={otp}>
          <OtpFieldSlots otpField={otp} />
          <OtpFieldHiddenInput otpField={otp} name="code" />
        </OtpFieldRoot>
      </form>
    )),
  );
  await tick();
  await tick();
  const slots = () => [...host.querySelectorAll<HTMLInputElement>('[data-otp-slot]')];
  expect(slots()).toHaveLength(4);
  slots()[0]!.focus();
  input(slots()[0]!, '1');
  expect(otp.source.model().value).toBe('1');
  expect(document.activeElement).toBe(slots()[1]);
  input(slots()[1]!, 'x');
  expect(otp.source.model().value).toBe('1');
  slots()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  expect(otp.source.model().value).toBe('');
  expect(document.activeElement).toBe(slots()[0]);
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: () => string };
  };
  paste.clipboardData = { getData: () => '98 76' };
  slots()[0]!.dispatchEvent(paste);
  expect(otp.source.model().value).toBe('9876');
  expect(completed).toEqual(['9876']);
  await tick();
  expect(host.querySelector<HTMLInputElement>('input[name=code]')!.value).toBe('9876');
  expect(host.querySelector('[data-otp-root]')!.hasAttribute('data-complete')).toBe(true);
  host.querySelector('form')!.dispatchEvent(new Event('reset', { bubbles: true }));
  await tick();
  expect(otp.source.model().value).toBe('');
});

it('a form shows external errors on their fields, focuses the first and clears on edit', async () => {
  const form = createForm();
  const name = createField();
  cleanup.push(
    () => form.lifetime.dispose(),
    () => name.lifetime.dispose(),
  );
  const host = render(() =>
    view(() => (
      <FormRoot form={form}>
        <FieldRoot field={name}>
          <FieldControl
            field={name}
            name="name"
            use={formFieldBinding({ form, field: name, name: 'name' })}
          />
          <FormFieldError form={form} field={name} name="name" />
        </FieldRoot>
      </FormRoot>
    )),
  );
  await tick();
  await tick();
  const control = host.querySelector<HTMLInputElement>('input')!;
  form.setErrors({ name: 'Already taken' });
  await tick();
  expect(name.source.model().invalid).toBe(true);
  expect(document.activeElement).toBe(control);
  const error = host.querySelector('[data-field-error]')!;
  expect(error.hasAttribute('hidden')).toBe(false);
  expect(error.textContent).toBe('Already taken');
  input(control, 'other');
  await tick();
  expect(form.source.model().errors).toEqual({});
  expect(error.hasAttribute('hidden')).toBe(true);
});

it('a preview card opens after hovering its link and closes after leaving', async () => {
  vi.useFakeTimers();
  const card = createPreviewCard({ delay: 100, closeDelay: 50 });
  cleanup.push(() => card.lifetime.dispose());
  const host = render(() =>
    view(() => (
      <div>
        <PreviewCardTrigger previewCard={card} href="/docs">
          Docs
        </PreviewCardTrigger>
        <PreviewCardPopup previewCard={card}>Preview</PreviewCardPopup>
      </div>
    )),
  );
  await tick();
  await tick();
  const trigger = host.querySelector('a')!;
  trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  vi.advanceTimersByTime(99);
  expect(card.source.model().open).toBe(false);
  vi.advanceTimersByTime(1);
  expect(card.source.model().open).toBe(true);
  await tick();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  trigger.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
  vi.advanceTimersByTime(50);
  expect(card.source.model().open).toBe(false);
});

it('a pending hover close does not cancel a preview opened by keyboard focus', async () => {
  vi.useFakeTimers();
  const card = createPreviewCard({ delay: 100, closeDelay: 50 });
  cleanup.push(() => card.lifetime.dispose());
  const host = render(() =>
    view(() => (
      <PreviewCardTrigger previewCard={card} href="/docs">
        Docs
      </PreviewCardTrigger>
    )),
  );
  await tick();
  await tick();
  const trigger = host.querySelector('a')!;
  trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  vi.advanceTimersByTime(100);
  card.hide();
  trigger.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
  trigger.focus();
  vi.advanceTimersByTime(100);
  expect(card.source.model().open).toBe(true);
  trigger.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
  vi.advanceTimersByTime(50);
  expect(card.source.model().open).toBe(true);
  trigger.blur();
  expect(card.source.model().open).toBe(false);
});
