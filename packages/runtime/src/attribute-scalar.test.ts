// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { attribute } from './dom.js';

it('does not read diagnostic element metadata for valid scalar attributes', () => {
  const element = document.createElement('div');
  element.setAttribute('data-value', '5');
  let inspected = 0;
  Object.defineProperty(element, 'localName', {
    get: () => {
      inspected++;
      return 'div';
    },
  });
  for (const value of ['5', 5, 5n]) attribute(element, 'data-value', value);
  expect(element.getAttribute('data-value')).toBe('5');
  expect(inspected).toBe(0);
  expect(() => attribute(element, 'data-value', {})).toThrow('<div> attribute "data-value"');
  expect(inspected).toBe(1);
});

it('preserves the element and attribute in invalid value property errors', () => {
  const element = document.createElement('input');
  attribute(element, 'value', 42);
  expect(element.value).toBe('42');
  expect(() => attribute(element, 'value', {})).toThrow('<input> attribute "value"');
  expect(element.value).toBe('42');
});
