import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compile } from '../../packages/compiler/dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = path.join(root, '.snippets');
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });
let count = 0;
for (const file of await readdir(path.join(root, 'content'))) {
  if (!file.endsWith('.md')) continue;
  const markdown = await readFile(path.join(root, 'content', file), 'utf8');
  for (const match of markdown.matchAll(/^```(tsx|ts) check\n([\s\S]*?)^```/gm)) {
    count++;
    const result = compile(match[2], `${file}-${count}.${match[1]}`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length) throw new Error(`${file}: ${JSON.stringify(errors)}`);
    await writeFile(path.join(temporary, `${file.slice(0, -3)}-${count}.${match[1]}`), match[2]);
  }
}
if (!count) throw new Error('No standalone examples were found');
await writeFile(
  path.join(temporary, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../../tsconfig.json',
      compilerOptions: { noEmit: true },
      include: ['./*.ts', './*.tsx'],
      exclude: [],
    },
    null,
    2,
  ),
);
execFileSync(
  process.execPath,
  [
    path.join(root, '../node_modules/typescript/bin/tsc'),
    '-p',
    path.join(temporary, 'tsconfig.json'),
  ],
  { stdio: 'inherit' },
);
console.log(
  `Checked ${count} standalone documentation examples against workspace types and the JSX compiler.`,
);
