import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { releaseManifest } from '../../scripts/release-manifest.mjs';

it('bumps shadcn package dependencies while preserving external dependencies and Effect peers', () => {
  const original = JSON.parse(readFileSync('packages/shadcn/package.json', 'utf8')) as {
    version: string;
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
  const before = structuredClone(original);
  const bumped = releaseManifest(
    original,
    '0.99.0',
    new Set(['effectweb', '@effectweb/base-ui', '@effectweb/lucide', '@effectweb/shadcn']),
  );
  expect(bumped.version).toBe('0.99.0');
  expect(bumped.dependencies).toEqual({
    ...original.dependencies,
    '@effectweb/base-ui': '0.99.0',
    '@effectweb/lucide': '0.99.0',
  });
  expect(bumped.peerDependencies).toEqual({ ...original.peerDependencies, effectweb: '0.99.0' });
  expect(original).toEqual(before);
});

it('updates native optional and workspace dev dependencies without changing third-party ranges', () => {
  expect(
    releaseManifest(
      {
        version: '0.1.0',
        optionalDependencies: { '@effectweb/compiler-linux-x64-gnu': '0.1.0', unrelated: '^2.0.0' },
        devDependencies: { effectweb: '0.1.0', effect: '4.0.0' },
      },
      '0.99.0',
      new Set(['effectweb', '@effectweb/compiler-linux-x64-gnu']),
    ),
  ).toEqual({
    version: '0.99.0',
    optionalDependencies: { '@effectweb/compiler-linux-x64-gnu': '0.99.0', unrelated: '^2.0.0' },
    devDependencies: { effectweb: '0.99.0', effect: '4.0.0' },
  });
});
