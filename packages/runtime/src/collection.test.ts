import { expect, it } from 'vitest';
import { entities } from './collection.js';

it('keeps entity identity through reorder, filtering and immutable revisions', () => {
  const a = { id: 'a', title: 'A' },
    b = { id: 'b', title: 'B' };
  const items = [a, b];
  const rows = entities(items);
  expect(entities(items)).toBe(rows);
  expect(rows.map((item) => item.title)).toEqual(['A', 'B']);
  const reversed = entities([b, a]);
  expect(reversed.items.map(reversed.identity)).toEqual(['b', 'a']);
  const revised = entities([{ ...a, title: 'Updated' }, b]);
  expect(revised.filter((item) => item.id === 'a').items.map(revised.identity)).toEqual(['a']);
  expect(rows.items[0]?.title).toBe('A');
  expect(revised.items[0]?.title).toBe('Updated');
});

it('represents unavailable entities with stable empty rows', () => {
  expect(entities(undefined)).toBe(entities(undefined));
  expect(entities(undefined).length).toBe(0);
});

it('shares refetched entities across insertions, removal and reorder without hiding edits', async () => {
  const { collection } = await import('./collection.js');
  const items = collection<{ id: number; title: string; nested: { value: string } }>(
    (item) => item.id,
  );
  const before = [
    { id: 1, title: 'A', nested: { value: 'same' } },
    { id: 2, title: 'B', nested: { value: 'same' } },
  ];
  expect(items.share(before, structuredClone(before))).toBe(before);
  const next = [
    { id: 3, title: 'C', nested: { value: 'new' } },
    { ...structuredClone(before[1]!), title: 'Edited' },
    structuredClone(before[0]!),
  ];
  const result = items.share(before, next);
  expect(result).toEqual(next);
  expect(items.share(before, next)).toBe(result);
  expect(result[0]).toBe(next[0]);
  expect(result[1]).not.toBe(before[1]);
  expect(result[1]!.nested).toBe(before[1]!.nested);
  expect(result[2]).toBe(before[0]);
  expect(items.share(before, [structuredClone(before[1]!)])[0]).toBe(before[1]);
  expect(before[1]!.title).toBe('B');
  const reordered = [before[1]!, before[0]!];
  expect(items.share(before, reordered)).toBe(reordered);
});

it('uses collection scope and composite identities without conflating entities', async () => {
  const { collection } = await import('./collection.js');
  const messages = collection<{ peer: string; id: number; body: string }>(
    (item) => `${item.peer}:${item.id}`,
  );
  const old = [
    { peer: 'a', id: 1, body: 'first' },
    { peer: 'b', id: 1, body: 'second' },
  ];
  const result = messages.share(old, structuredClone([...old].reverse()));
  expect(result[0]).toBe(old[1]);
  expect(result[1]).toBe(old[0]);
  expect(messages.share([], structuredClone(old))).toEqual(old);
  expect(() => messages.share(old, [old[0]!, { ...old[0]! }])).toThrow(
    'Duplicate collection identity',
  );
});

it('rejects duplicate identities at construction and on unchanged share fast paths', async () => {
  const { collection } = await import('./collection.js');
  const domain = collection<{ id: number }>((item) => item.id);
  const duplicate = [{ id: 3 }, { id: 3 }];
  for (const operation of [
    () => domain.from(duplicate),
    () => domain.share(duplicate, duplicate),
    () => domain.share([], duplicate),
    () => domain.share(duplicate, []),
  ]) {
    expect(operation).toThrow('indices 0 and 1');
  }
  expect(() => domain.from([{ id: undefined as unknown as number }])).toThrow('at index 0');
});
