// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, view } from 'effectweb';
import { createSwitch, SwitchRoot } from './switch.js';
import { createCheckbox, CheckboxRoot } from './checkbox.js';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  document.body.replaceChildren();
});
it.each(['switch', 'checkbox'] as const)(
  '%s restores a rejected controlled edit and allows retry',
  async (kind) => {
    const requested: boolean[] = [];
    let reject!: (reason: Error) => void;
    let operation: Promise<void> | undefined;
    const handle = (kind === 'switch' ? createSwitch : createCheckbox)({
      checked: true,
      onCheckedChange: (checked) => {
        requested.push(checked);
        operation = new Promise<void>((_resolve, fail) => {
          reject = fail;
        }).catch(() => {});
      },
    });
    const host = document.body.appendChild(document.createElement('div'));
    const rendered = mount(
      host,
      view(() =>
        kind === 'switch' ? <SwitchRoot switch={handle} /> : <CheckboxRoot checkbox={handle} />,
      ),
      {},
    );
    cleanup.push(() => {
      rendered.dispose();
      handle.lifetime.dispose();
    });
    const input = host.querySelector('input')!;
    input.click();
    expect(requested).toEqual([false]);
    reject(new Error('Save denied'));
    await operation;
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
    input.click();
    expect(requested).toEqual([false, false]);
    reject(new Error('Still denied'));
    await operation;
    handle.sync({ checked: false });
    expect(input.checked).toBe(false);
    expect(input.getAttribute('aria-checked')).toBe('false');
  },
);
it.each(['switch', 'checkbox'] as const)(
  '%s keeps uncontrolled toggles and cancelled changes coherent',
  (kind) => {
    const changed = vi.fn();
    const handle = (kind === 'switch' ? createSwitch : createCheckbox)({
      onCheckedChange: changed,
    });
    let cancel = false;
    const onChange = (event: Event) => {
      if (cancel) event.preventDefault();
    };
    const host = document.body.appendChild(document.createElement('div'));
    const rendered = mount(
      host,
      view(() =>
        kind === 'switch' ? (
          <SwitchRoot switch={handle} onChange={onChange} />
        ) : (
          <CheckboxRoot checkbox={handle} onChange={onChange} />
        ),
      ),
      {},
    );
    cleanup.push(() => {
      rendered.dispose();
      handle.lifetime.dispose();
    });
    const input = host.querySelector('input')!;
    input.click();
    expect(input.checked).toBe(true);
    expect(changed).toHaveBeenCalledExactlyOnceWith(true);
    cancel = true;
    input.click();
    expect(input.checked).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  },
);
