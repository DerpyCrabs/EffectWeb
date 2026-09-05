import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostPlatform } from './platforms.mjs';
const platform = hostPlatform();
const compiler = JSON.parse(readFileSync('packages/compiler/package.json', 'utf8'));
const root = resolve(`artifacts/native/native-${platform.suffix}`);
mkdirSync(root, { recursive: true });
copyFileSync('packages/compiler/native/effectweb-compiler.node', `${root}/compiler.node`);
copyFileSync('LICENSE', `${root}/LICENSE`);
writeFileSync(
  `${root}/package.json`,
  JSON.stringify(
    {
      name: `${compiler.name}-${platform.suffix}`,
      version: compiler.version,
      description: `EffectWeb compiler binary for ${platform.suffix}`,
      license: 'MIT',
      main: './compiler.node',
      files: ['compiler.node', 'LICENSE', 'README.md'],
      os: [platform.os],
      cpu: [platform.cpu],
      ...(platform.libc ? { libc: [platform.libc] } : {}),
      engines: compiler.engines,
      repository: compiler.repository,
      publishConfig: { access: 'public' },
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  `${root}/README.md`,
  `# EffectWeb native compiler\n\nPlatform package for ${platform.suffix}. Install @effectweb/compiler instead; npm selects this dependency automatically.\n`,
);
process.stdout.write(`${root}\n`);
