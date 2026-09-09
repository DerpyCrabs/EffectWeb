import { expect, it } from 'vitest';
import { collection } from './collection.js';
import { modelOwner } from './owner.js';
import { protectSnapshot } from './snapshot.js';

it('shares 50k file records across refresh, rename, reorder and append without losing immutability', () => {
  const files = collection<{ id: number; name: string; meta: { size: number } }>((file) => file.id);
  const previous = protectSnapshot(
    Array.from({ length: 50_000 }, (_, id) => ({ id, name: `File ${id}`, meta: { size: id } })),
  );
  const refresh = files.share(
    previous,
    previous.map((file) => ({ ...file, meta: { ...file.meta } })),
  );
  expect(refresh).toBe(previous);
  const renamed = protectSnapshot(
    files.share(
      previous,
      previous.map((file) =>
        file.id === 25_000 ? { ...file, name: 'Renamed', meta: { ...file.meta } } : file,
      ),
    ),
  );
  expect(renamed[25_000]).not.toBe(previous[25_000]);
  expect(renamed[25_000]!.meta).toBe(previous[25_000]!.meta);
  expect(renamed.filter((file, index) => file === previous[index]).length).toBe(49_999);
  const reversed = files.share(renamed, [...renamed].reverse());
  expect(reversed[0]).toBe(renamed[49_999]);
  const appended = protectSnapshot(
    files.share(reversed, [...reversed, { id: 50_000, name: 'New', meta: { size: 0 } }]),
  );
  expect(appended[0]).toBe(reversed[0]);
  expect(Object.isFrozen(appended)).toBe(true);
  expect(Object.isFrozen(appended[50_000]!.meta)).toBe(true);
});

it('page publication preserves other chunks and playback updates leave the library snapshot untouched', () => {
  const chunks = protectSnapshot(
    Array.from({ length: 100 }, (_, page) =>
      Array.from({ length: 500 }, (_, index) => ({ id: page * 500 + index })),
    ),
  );
  const library = modelOwner({ chunks });
  const playback = modelOwner({ position: 0, selected: 0 });
  let publications = 0;
  library.source.subscribe(() => {
    publications++;
  });
  for (let frame = 0; frame < 1_000; frame++)
    playback.patch({ position: frame / 60, selected: frame });
  expect(library.read().chunks).toBe(chunks);
  expect(publications).toBe(0);
  library.edit('chunks', (previous) =>
    previous.map((page, index) => (index === 50 ? [...page, { id: 50_001 }] : page)),
  );
  expect(library.read().chunks.filter((page, index) => page === chunks[index]).length).toBe(99);
  expect(publications).toBe(1);
  library.dispose();
  playback.dispose();
});
