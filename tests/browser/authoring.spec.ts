import { expect, test } from '@playwright/test';

test('ordinary props, explicit dispatch and spreads update without replacing DOM or leaking bindings', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/authoringFixture.tsx';
    const { mountAuthoring } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const f = mountAuthoring(host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = host.querySelector('[data-spread]') as HTMLButtonElement;
    const input = host.querySelector('input')!;
    const ordinary = () =>
      [...host.querySelectorAll('[data-ordinary]')].map((el) => el.textContent);
    (host.querySelector('[data-inline]') as HTMLButtonElement).click();
    const inlineBefore = host.querySelector('[data-inline]')!.getAttribute('data-clicked');
    const before = {
      ordinary: ordinary(),
      title: button.title,
      class: button.className,
      color: button.style.color,
      value: input.value,
    };
    button.click();
    (host.querySelector('[data-dispatched]') as HTMLButtonElement).click();
    const selectedBefore = f.source.model().selected;
    input.value = 'rejected';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const restored = input.value;
    f.replace();
    await new Promise((resolve) => setTimeout(resolve, 0));
    button.click();
    (host.querySelector('[data-dispatched]') as HTMLButtonElement).click();
    (host.querySelector('[data-inline]') as HTMLButtonElement).click();
    const inlineAfter = host.querySelector('[data-inline]')!.getAttribute('data-clicked');
    const after = {
      ordinary: ordinary(),
      title: button.title,
      class: button.className,
      color: button.style.color,
      value: input.value,
      selected: f.source.model().selected,
      same: button === host.querySelector('[data-spread]'),
    };
    input.value = 'native draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const unbound = input.value;
    f.remove();
    button.click();
    f.dispose();
    button.click();
    const result = {
      before,
      inlineBefore,
      inlineAfter,
      selectedBefore,
      restored,
      after,
      unbound,
      clicks: f.clicks,
      hosts: f.hosts,
      remaining: host.childNodes.length,
    };
    host.remove();
    return result;
  });
  expect(result).toEqual({
    before: {
      ordinary: ['first:', 'child:explicit'],
      title: 'spread',
      class: 'base active',
      color: 'red',
      value: 'controlled',
    },
    inlineBefore: 'first',
    inlineAfter: 'second',
    selectedBefore: 'first',
    restored: 'controlled',
    after: {
      ordinary: ['second:', 'changed child:explicit'],
      title: 'before',
      class: '',
      color: '',
      value: '',
      selected: 'second',
      same: true,
    },
    unbound: 'native draft',
    clicks: ['old', 'new'],
    hosts: ['start:old', 'stop:old', 'start:new', 'stop:new'],
    remaining: 0,
  });
});
