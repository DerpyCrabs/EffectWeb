import { performance } from 'node:perf_hooks';
import { collection, modelOwner } from '../packages/runtime/dist/index.js';
import { protectSnapshot } from '../packages/runtime/dist/snapshot.js';

const files = collection((file) => file.id);
for (const count of [1_000, 10_000, 50_000]) {
  const original = protectSnapshot(
    Array.from({ length: count }, (_, index) => ({
      id: String(index),
      name: `File ${index}`,
      size: index * 100,
    })),
  );
  for (const operation of ['same', 'edit', 'refresh', 'reverse', 'append']) {
    const times = [];
    for (let sample = 0; sample < 8; sample++) {
      const next =
        operation === 'same'
          ? original
          : operation === 'edit'
            ? original.map((file, index) => (index === count / 2 ? { ...file, size: 1 } : file))
            : operation === 'append'
              ? [...original, { id: 'new', name: 'New file', size: 0 }]
              : original.map((file) => ({ ...file }));
      if (operation === 'reverse') next.reverse();
      const start = performance.now();
      protectSnapshot(files.share(original, next));
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ count, operation, medianMs: times[4] }));
  }
  const library = modelOwner({ files: original });
  const playback = modelOwner({ position: 0 });
  const selection = modelOwner({ selected: '' });
  const start = performance.now();
  for (let frame = 0; frame < 1_000; frame++) {
    playback.patch({ position: frame });
    selection.patch({ selected: String(frame) });
  }
  console.log(
    JSON.stringify({
      count,
      operation: '1000 playback + selection updates',
      ms: performance.now() - start,
      sameLibrary: library.read().files === original,
    }),
  );
  library.dispose();
  playback.dispose();
  selection.dispose();
}
