// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { placeRect } from './positioning.js';
import { isHTMLElement } from './dom-host.js';
import { focusPopupInitially } from './popup-focus.js';

it('positions a popup against its own viewport rather than the runtime viewport', () => {
  const browser = new Window({ width: 240, height: 160 });
  const doc = browser.document as unknown as Document;
  const popup = doc.createElement('div');
  doc.body.append(popup);
  Object.defineProperties(popup, { offsetWidth: { value: 80 }, offsetHeight: { value: 40 } });
  placeRect({ x: 210, y: 135, width: 20, height: 20 }, popup, {
    side: 'bottom',
    align: 'start',
    offset: 0,
    collisionAvoidance: { side: 'shift', align: 'shift', fallbackAxisSide: 'none' },
  });
  expect(popup.style.left).toBe('160px');
  expect(popup.style.top).toBe('120px');
});

it('recognizes HTML triggers in another realm and restores only their focus', () => {
  const browser = new Window();
  const doc = browser.document as unknown as Document;
  const trigger = doc.createElement('button'),
    popup = doc.createElement('div');
  const unrelated = document.createElement('input');
  document.body.append(unrelated);
  doc.body.append(trigger, popup);
  popup.tabIndex = -1;
  unrelated.focus();
  trigger.focus();
  expect(isHTMLElement(trigger)).toBe(true);
  expect(isHTMLElement(doc.createElementNS('http://www.w3.org/2000/svg', 'svg'))).toBe(false);
  popup.focus();
  focusPopupInitially(false, popup, trigger, 'keyboard');
  expect(doc.activeElement).toBe(trigger);
  expect(document.activeElement).toBe(unrelated);
  unrelated.remove();
});
