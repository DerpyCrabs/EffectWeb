// @vitest-environment happy-dom
import { expect, it } from 'vitest';

it('renderView mounts components with fixed input, updates, records messages and disposes', async () => {
  const result = await (async () => {
    const { renderFixtures } = await import('../fixtures/renderViewFixture');
    const parent = document.createElement('main');
    document.body.append(parent);
    const { counter, row, closeRow, forwarded, counterHost, rowHost } = renderFixtures(parent);
    const button = counterHost.querySelector('button')!;
    button.click();
    const clicked = button.textContent;
    counter.update({ label: 'second' });
    const updated = counterHost.querySelector('button')!.textContent;
    const preserved = counterHost.querySelector('button') === button;
    rowHost.querySelector('button')!.click();
    const sent = [...row.sent];
    counter.dispose();
    await closeRow();
    return { clicked, updated, preserved, sent, forwarded, empty: parent.textContent };
  })();
  expect(result).toEqual({
    clicked: 'first:1',
    updated: 'second:1',
    preserved: true,
    sent: ['picked'],
    forwarded: ['picked'],
    empty: '',
  });
});
