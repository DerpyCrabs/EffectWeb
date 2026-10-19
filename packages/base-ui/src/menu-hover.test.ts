// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { mount, modelOwner } from 'effectweb';
import * as Effect from 'effect/Effect';
import { createMenu, MenuItem } from './menu.js';
it('preserves keyboard focus when hover highlighting is disabled and reads later changes', async () => {
  const menu = createMenu({ highlightItemOnHover: false });
  const outside = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(outside, host);
  const owner = modelOwner({ menu, children: 'Run' });
  const root = mount(host, MenuItem, owner.source);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const item = host.querySelector('button')!;
  outside.focus();
  item.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
  expect(document.activeElement).toBe(outside);
  menu.sync({ highlightItemOnHover: true });
  item.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
  expect(document.activeElement).toBe(item);
  outside.focus();
  item.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' }));
  expect(document.activeElement).toBe(outside);
  await Effect.runPromise(root.close());
  owner.dispose();
  menu.lifetime.dispose();
  document.body.replaceChildren();
});
