import { expect, it } from 'vitest';
import { intrinsic } from './intrinsic';

it('follows immutable native File and Blob getters when validating nested data operations', () => {
  const value = { attachments: [{ file: new File(['data'], 'test.png', { type: 'image/png' }) }] };
  expect(intrinsic(value, ['attachments', null, 'file', 'type'], 'startsWith')).toBe(value);
  expect(intrinsic(value, ['attachments', null, 'file', 'name'], 'toLowerCase')).toBe(value);
});

it('rejects user accessors before invoking them, even with a native receiver behind them', () => {
  let reads = 0;
  const value = {
    get file() {
      reads++;
      return new File([], 'test.png');
    },
  };
  expect(() => intrinsic(value, ['file', 'type'], 'startsWith')).toThrow(/accessor/u);
  expect(reads).toBe(0);
});

it('rejects an overridden method without invoking it', () => {
  let calls = 0;
  const value = {
    slice() {
      calls++;
      return [];
    },
  };
  expect(() => intrinsic(value, [], 'slice')).toThrow(/standard data operation/u);
  expect(calls).toBe(0);
});
