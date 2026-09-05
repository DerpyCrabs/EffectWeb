import { expect, it } from 'vitest';
import { patchModel } from './state.js';

it('patches fields atomically, preserves other references and skips unchanged updates', () => {
  const nested = { title: 'first' };
  const model = { text: 'draft' as string | undefined, count: 0, nested };
  expect(patchModel(model, {})).toBe(model);
  expect(patchModel(model, { nested, count: 0 })).toBe(model);
  const next = patchModel(model, { text: undefined, count: 1 });
  expect(next).toEqual({ text: undefined, count: 1, nested });
  expect(next.nested).toBe(nested);
  expect(model).toEqual({ text: 'draft', count: 0, nested });
});

it('matches shallow spread for symbol fields and explicit undefined property additions', () => {
  const key = Symbol('field');
  const model: { [key]: number; optional?: string | undefined } = { [key]: 1 };
  expect(patchModel(model, { [key]: 2 })[key]).toBe(2);
  const added = patchModel(model, { optional: undefined });
  expect(Object.hasOwn(added, 'optional')).toBe(true);
  expect(Object.hasOwn(model, 'optional')).toBe(false);
  expect(patchModel(added, { optional: undefined })).toBe(added);
  const hidden = Object.defineProperty({}, 'optional', { value: 'hidden', enumerable: false });
  expect(patchModel(model, hidden)).toBe(model);
});
