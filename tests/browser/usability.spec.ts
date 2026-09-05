import { expect, test } from '@playwright/test';

test('async content keeps successful DOM through refresh and recoverable failure, including undefined', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/usabilityFixture.tsx';
    const { mountAsyncContent } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountAsyncContent(host);
    const empty = !!host.querySelector('[data-empty]');
    source.success(0);
    await Promise.resolve();
    const input = host.querySelector('input')!;
    input.value = 'keep my edit';
    input.focus();
    source.waiting();
    const refresh = {
      same: input === host.querySelector('input'),
      pending: !!host.querySelector('[data-pending]'),
      refreshing: !!host.querySelector('[data-refreshing]'),
      focused: document.activeElement === input,
      value: host.querySelector('output')!.textContent,
    };
    source.failure('offline');
    const failed = {
      same: input === host.querySelector('input'),
      refreshing: !!host.querySelector('[data-refreshing]'),
      error: host.querySelector('[role="alert"]')!.textContent!.includes('offline'),
    };
    source.success(undefined);
    const recovered = {
      same: input === host.querySelector('input'),
      edit: input.value,
      value: host.querySelector('output')!.textContent,
      error: !!host.querySelector('[role="alert"]'),
    };
    source.clear();
    const cleared = {
      empty: !!host.querySelector('[data-empty]'),
      inputs: host.querySelectorAll('input').length,
    };
    source.dispose();
    const remaining = host.childNodes.length;
    host.remove();
    return { empty, refresh, failed, recovered, cleared, lifetime: source.lifetime, remaining };
  });
  expect(result).toEqual({
    empty: true,
    refresh: { same: true, pending: false, refreshing: true, focused: true, value: '0' },
    failed: { same: true, refreshing: false, error: true },
    recovered: { same: true, edit: 'keep my edit', value: 'undefined', error: false },
    cleared: { empty: true, inputs: 0 },
    lifetime: { mounted: 1, disposed: 1 },
    remaining: 0,
  });
});

test('pending delay only applies before data and cannot reappear after settlement or disposal', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/usabilityFixture.tsx';
    const { mountAsyncContent } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountAsyncContent(host);
    source.waiting();
    const immediate = host.textContent;
    await new Promise((resolve) => setTimeout(resolve, 80));
    const delayed = host.textContent;
    source.success(1);
    source.clear();
    source.waiting();
    source.success(2);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const settled = host.textContent;
    source.clear();
    source.failure('initial failure');
    const failure = host.textContent!.includes('initial failure');
    source.waiting();
    source.dispose();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const remaining = host.childNodes.length;
    host.remove();
    return { immediate, delayed, settled, failure, remaining };
  });
  expect(result).toEqual({
    immediate: '',
    delayed: 'Loading',
    settled: '2',
    failure: true,
    remaining: 0,
  });
});

test('form adapters capture native composition values and preserve the input selection', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/usabilityFixture.tsx';
    const { mountForm } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountForm(host);
    const text = host.querySelector<HTMLInputElement>('[aria-label="Text"]')!;
    text.focus();
    text.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    text.value = '日本語';
    text.setSelectionRange(2, 2);
    text.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '語' }));
    source.set({ checked: true });
    const selection = {
      start: text.selectionStart,
      end: text.selectionEnd,
      focused: document.activeElement === text,
      same: text === host.querySelector('[aria-label="Text"]'),
    };
    text.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '語' }));
    host.querySelector<HTMLInputElement>('[aria-label="Checked"]')!.click();
    const number = host.querySelector<HTMLInputElement>('[aria-label="Number"]')!;
    number.value = '0';
    number.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const zero = source.model().number;
    number.value = '';
    number.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    host.querySelector('form')!.dispatchEvent(event);
    const model = source.model();
    source.dispose();
    host.remove();
    return {
      selection,
      zero,
      empty: model.number === undefined,
      text: model.text,
      checked: model.checked,
      submitted: model.submitted,
      prevented: event.defaultPrevented,
    };
  });
  expect(result).toEqual({
    selection: { start: 2, end: 2, focused: true, same: true },
    zero: 0,
    empty: true,
    text: '日本語',
    checked: false,
    submitted: 1,
    prevented: true,
  });
});

test('native event callbacks read the latest model, reset their input and schedule focus', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/usabilityFixture.tsx';
    const { mountForm } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountForm(host);
    source.set({ text: 'latest:' });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Native event"]')!;
    input.value = 'captured';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const result = {
      text: source.model().text,
      value: input.value,
      focus: document.activeElement?.id,
    };
    source.dispose();
    host.remove();
    return result;
  });
  expect(result).toEqual({ text: 'latest:captured', value: '', focus: 'native-followup' });
});
