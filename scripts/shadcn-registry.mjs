// Generated output: edit sources and re-run; never hand-edit packages/shadcn/registry.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const outputDirectory = join(root, 'packages/shadcn/registry');
const sourceDirectory = join(root, 'packages/shadcn/src');
const manifest = JSON.parse(readFileSync(join(root, 'packages/shadcn/package.json'), 'utf8'));
const helpers = new Set(['utils', 'types', 'adapter', 'placement']);

export function toConsumerSource(source) {
  return source
    .replace(
      /import\s+(type\s+)?\{([^}]+)\}\s*from\s*(['"])\.\/cn\.(?:js|tsx?|jsx)\3;?/gu,
      (_match, type = '', body) => {
        const groups = new Map();
        for (const part of body
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)) {
          const name = part.replace(/^type\s+/u, '').split(/\s+as\s+/u)[0];
          if (!['cn', 'cva', 'VariantProps'].includes(name))
            throw new Error(`registry: unknown cn export ${name}`);
          const spec = name === 'cn' ? '@/lib/utils' : 'class-variance-authority';
          groups.set(spec, [...(groups.get(spec) ?? []), part]);
        }
        return [...groups]
          .map(([spec, parts]) => `import ${type}{ ${parts.join(', ')} } from '${spec}';`)
          .join('\n');
      },
    )
    .replace(/(['"])\.\/([\w-]+)\.(?:js|tsx?|jsx)\1/gu, (_match, quote, original) => {
      const name = original === 'cn' ? 'utils' : original;
      return `${quote}@/${helpers.has(name) ? 'lib' : 'components/ui'}/${name}${quote}`;
    });
}

export function collectDependencies(source, dependencies = manifest.dependencies) {
  const npm = new Set();
  const registry = new Set();
  for (const [, spec] of source.matchAll(
    /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|@import\s*)['"]([^'"]+)['"]/gu,
  )) {
    const local = /^@\/(?:lib|components\/ui|hooks)\/([\w-]+)$/u.exec(spec);
    if (local) {
      registry.add(`@effectweb/${local[1]}`);
      continue;
    }
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (name === 'effectweb') continue;
    if (!Object.hasOwn(dependencies, name))
      throw new Error(`registry: undeclared dependency "${spec}" imported by a component`);
    npm.add(name.startsWith('@effectweb/') ? `${name}@${dependencies[name]}` : name);
  }
  return {
    ...(npm.size ? { dependencies: [...npm].sort((a, b) => a.localeCompare(b)) } : {}),
    ...(registry.size
      ? { registryDependencies: [...registry].sort((a, b) => a.localeCompare(b)) }
      : {}),
  };
}

export function buildItems() {
  const definitions = [
    ['utils', 'registry:lib', 'lib/utils.ts', 'lib/utils.ts', "export { cn } from 'cn';\n"],
    ...['types', 'adapter', 'placement'].map((name) => [
      name,
      'registry:lib',
      `lib/${name}.ts`,
      `lib/${name}.ts`,
      readFileSync(join(sourceDirectory, `${name}.ts`), 'utf8'),
    ]),
    [
      'theme',
      'registry:file',
      'styles/theme.css',
      '~/styles/effectweb-shadcn-theme.css',
      readFileSync(join(sourceDirectory, 'theme.css'), 'utf8'),
    ],
    ...readdirSync(sourceDirectory)
      .filter((file) => file.endsWith('.tsx'))
      .sort()
      .map((file) => [
        file.slice(0, -4),
        'registry:ui',
        `ui/${file}`,
        `components/ui/${file}`,
        readFileSync(join(sourceDirectory, file), 'utf8'),
      ]),
  ];
  const items = definitions.map(([name, type, path, target, source]) => {
    const content = type === 'registry:file' ? source : toConsumerSource(source);
    // CSS comments contain setup examples, not actual dependencies.
    const scanned = type === 'registry:file' ? content.replace(/\/\*[\s\S]*?\*\//gu, '') : content;
    return {
      $schema: 'https://ui.shadcn.com/schema/registry-item.json',
      name,
      type,
      title: name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' '),
      ...collectDependencies(scanned),
      files: [{ path, type, target, content }],
    };
  });
  const names = new Set(items.map((item) => `@effectweb/${item.name}`));
  for (const item of items)
    for (const dep of item.registryDependencies ?? [])
      if (!names.has(dep)) throw new Error(`registry: unknown item ${dep}`);
  return items;
}

export function renderRegistry() {
  const items = buildItems();
  const catalog = {
    $schema: 'https://ui.shadcn.com/schema/registry.json',
    name: 'effectweb',
    homepage: 'https://effectweb.netlify.app',
    items: items.map(({ files, ...item }) => ({
      ...item,
      files: files.map(({ content: _content, ...file }) => file),
    })),
  };
  return new Map([
    ...items.map((item) => [`${item.name}.json`, JSON.stringify(item, null, 2) + '\n']),
    ['registry.json', JSON.stringify(catalog, null, 2) + '\n'],
  ]);
}

export function writeRegistry(directory = outputDirectory) {
  const rendered = renderRegistry();
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [file, content] of rendered) writeFileSync(join(directory, file), content);
}

export function checkRegistry(directory = outputDirectory) {
  const rendered = renderRegistry();
  const issues = [];
  for (const [file, expected] of rendered)
    if (
      !existsSync(join(directory, file)) ||
      readFileSync(join(directory, file), 'utf8') !== expected
    )
      issues.push(`stale: ${file}`);
  if (existsSync(directory))
    for (const file of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (!file.isDirectory()) {
        const relative = resolve(file.parentPath, file.name).slice(resolve(directory).length + 1);
        if (!rendered.has(relative)) issues.push(`orphaned: ${relative}`);
      }
    }
  return issues;
}

export async function serveRegistry(port = 4517, directory = outputDirectory) {
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (!/^\/[\w-]+\.json$/u.test(pathname) || !existsSync(join(directory, pathname.slice(1)))) {
      response.writeHead(404).end();
      return;
    }
    let content;
    try {
      content = readFileSync(join(directory, pathname.slice(1)));
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    response.end(content);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const issues = checkRegistry();
    if (issues.length) {
      console.error(issues.join('\n') + '\nregistry is stale — run: npm run registry:build');
      process.exitCode = 1;
    } else console.log('registry is current');
  } else {
    writeRegistry();
    console.log('registry built: 53 items, 54 files');
    if (process.argv.includes('--serve')) {
      const index = process.argv.indexOf('--port');
      const server = await serveRegistry(index < 0 ? 4517 : Number(process.argv[index + 1]));
      console.log(`registry serving: http://127.0.0.1:${server.address().port}/{name}.json`);
    }
  }
}
