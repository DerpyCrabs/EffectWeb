import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function inventory(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await inventory(directory, name)));
    else files.push(name);
  }
  return files.sort();
}

/** Verify the complete published inventory and the bytes of every generated payload. */
export async function verifyRegistry(source, published) {
  const expected = await inventory(source);
  assert.deepEqual(await inventory(published), expected, 'Registry file inventory differs');
  for (const file of expected) {
    assert.deepEqual(
      await readFile(path.join(published, file)),
      await readFile(path.join(source, file)),
      `Registry payload differs: ${file}`,
    );
  }
  return expected.length;
}
