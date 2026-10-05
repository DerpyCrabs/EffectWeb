import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yuku-parser';
import { reasons } from './reasons.mjs';

const upstream = {
  '@tanstack/router-core': 'https://tanstack.com/router/latest/docs/framework/react/api/router',
  '@tanstack/history':
    'https://tanstack.com/router/latest/docs/framework/react/guide/history-types',
  '@tanstack/table-core': 'https://tanstack.com/table/latest/docs/api/overview',
  '@json-render/core': 'https://json-render.dev/docs',
  '@json-render/core/store-utils': 'https://json-render.dev/docs',
  '@lucide/icons': 'https://lucide.dev/icons/',
  '@lucide/icons/build': 'https://lucide.dev/guide/packages/lucide',
};
const repository = 'https://github.com/DerpyCrabs/EffectWeb/blob/main/';
const modules = [
  ['runtime', 'index', 'effectweb', 'Everyday views, state, owned work and DOM access.'],
  [
    'runtime',
    'advanced',
    'effectweb/advanced',
    'Adapter building blocks and custom render comparison.',
  ],
  [
    'runtime',
    'testing',
    'effectweb/testing',
    'Helpers for testing views, programs and cancellation.',
  ],
  ['query', 'index', '@effectweb/query', 'Cached server data.'],
  [
    'compiler',
    'index',
    '@effectweb/compiler',
    'Compile JSX and read diagnostics from other build tools.',
  ],
  ['compiler', 'vite', '@effectweb/compiler/vite', 'The Vite plugin.'],
  [
    'compiler',
    'preset',
    '@effectweb/compiler/lint-preset',
    'The lint preset for JavaScript configuration files.',
  ],
  ['compiler', 'oxlint', '@effectweb/compiler/oxlint', 'The Oxlint plugin that the preset loads.'],
  ['tanstack-router', 'index', '@effectweb/tanstack-router', 'TanStack Router with typed links.'],
  [
    'tanstack-form',
    'index',
    '@effectweb/tanstack-form',
    'TanStack Form state as immutable snapshots.',
  ],
  [
    'tanstack-table',
    'index',
    '@effectweb/tanstack-table',
    'TanStack Table v9 state as immutable snapshots.',
  ],
  ['keycloak', 'index', '@effectweb/keycloak', 'Keycloak sign-in and token refresh.'],
  [
    'json-render',
    'index',
    '@effectweb/json-render',
    'Render JSON UI specs with your own components.',
  ],
  [
    'json-render',
    'schema',
    '@effectweb/json-render/schema',
    'The catalog schema for the JSON renderer.',
  ],
  ['lucide', 'types', '@effectweb/lucide/types', 'Props of Lucide icon views.'],
  ['lucide', 'dynamic', '@effectweb/lucide/dynamic', 'Load a Lucide icon chosen at runtime.'],
  ['lucide', 'build', '@effectweb/lucide/build', 'Lucide SVG builders, re-exported.'],
  ['lucide', 'data', '@effectweb/lucide/data', 'Raw Lucide icon geometry.'],
  ['antd-icons', 'attributes', '@effectweb/antd-icons/types', 'Props of Ant Design icon views.'],
];
// Reference pages, each listing one or more entry points. `categories` groups a single
// entry point's exports under topic headings; every export must appear in one.
/** @type {{ slug: string, title: string, description: string, entries: string[], categories?: [string, string[]][], internal?: boolean, icons?: boolean }[]} */
const referencePages = [
  {
    slug: 'runtime',
    title: 'effectweb',
    description: 'Every export of the main package, grouped by topic.',
    entries: ['effectweb'],
    categories: [
      ['Views', ['view', 'ViewBinding', 'slot', 'View', 'Send', 'Slot', 'JSX', 'CompiledContent']],
      ['Lists', ['list', 'entities', 'sequence', 'collection', 'Rows', 'Collection']],
      ['Components', ['component', 'ownerOf', 'ComponentOwner', 'FieldsPatch']],
      [
        'Controllers',
        [
          'modelOwner',
          'controllerView',
          'ModelOwner',
          'ViewController',
          'ControllerModel',
          'OwnedRun',
          'DisposableOwner',
          'Ownable',
        ],
      ],
      [
        'Async work',
        ['program', 'RunPolicy', 'RunKey', 'Command', 'Transition', 'Program', 'RunningProgram'],
      ],
      ['Showing results', ['available', 'resourceError']],
      ['Sources', ['observe', 'mapSource', 'clock', 'liveSource', 'Source']],
      [
        'DOM',
        [
          'domMount',
          'domBinding',
          'domHandle',
          'Portal',
          'submit',
          'DomMount',
          'DomHandle',
          'PortalProps',
        ],
      ],
      ['Mounting and services', ['mount', 'makeMount', 'errorBoundary', 'Mounted']],
      ['Snapshots', ['Snapshot', 'SnapshotOpaque', 'snapshotOpaque']],
    ],
  },
  {
    slug: 'advanced',
    title: 'effectweb/advanced',
    description: 'Building blocks for adapters and custom render comparison.',
    entries: ['effectweb/advanced'],
  },
  {
    slug: 'testing',
    title: 'effectweb/testing',
    description: 'Helpers for testing views, programs and cancellation.',
    entries: ['effectweb/testing'],
  },
  {
    slug: 'query',
    title: '@effectweb/query',
    description: 'Cached server data, grouped by topic.',
    entries: ['@effectweb/query'],
    categories: [
      [
        'Defining queries',
        ['query', 'queryGroup', 'Query', 'QueryKey', 'QueryGroup', 'QueryEncoding'],
      ],
      ['The cache', ['queryCache', 'QueryCache', 'QueryCacheOptions']],
      ['Reading queries', ['querySource', 'observeQuery', 'QueryResource']],
      [
        'Pagination',
        [
          'infiniteQuery',
          'infiniteResource',
          'fetchNextPage',
          'retryPage',
          'InfiniteData',
          'InfiniteQuery',
          'InfiniteResource',
        ],
      ],
    ],
  },
  {
    slug: 'compiler',
    title: 'Compiler packages',
    description: 'The compiler, the Vite plugin and the lint preset.',
    entries: [
      '@effectweb/compiler',
      '@effectweb/compiler/vite',
      '@effectweb/compiler/lint-preset',
      '@effectweb/compiler/oxlint',
    ],
    internal: true,
  },
  {
    slug: 'integrations',
    title: 'Integration packages',
    description: 'Router, form, table, Keycloak and JSON-render adapters.',
    entries: [
      '@effectweb/tanstack-router',
      '@effectweb/tanstack-form',
      '@effectweb/tanstack-table',
      '@effectweb/keycloak',
      '@effectweb/json-render',
      '@effectweb/json-render/schema',
    ],
  },
  {
    slug: 'icons',
    title: 'Icon packages',
    description: 'Lucide and Ant Design icon packages.',
    entries: [
      '@effectweb/lucide/types',
      '@effectweb/lucide/dynamic',
      '@effectweb/lucide/build',
      '@effectweb/lucide/data',
      '@effectweb/antd-icons/types',
    ],
    icons: true,
  },
];
export const apiSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export function createApi(root) {
  execFileSync(
    process.execPath,
    [
      path.join(root, '../node_modules/typescript/bin/tsc'),
      '-p',
      path.join(root, 'tsconfig.api.json'),
    ],
    { stdio: 'pipe' },
  );
  const covered = new Set(modules.map(([, , name]) => name));
  for (const name of [
    'effectweb/dom',
    'effectweb/jsx-runtime',
    'effectweb/jsx-dev-runtime',
    'effectweb/jsx',
    '@effectweb/compiler/oxlint-preset.json',
    '@effectweb/lucide/icons/*',
    '@effectweb/antd-icons/icons/*',
  ])
    covered.add(name);
  for (const pkg of new Set(modules.map(([name]) => name))) {
    const manifest = JSON.parse(
      readFileSync(path.join(root, '../packages', pkg, 'package.json'), 'utf8'),
    );
    for (const entry of Object.keys(manifest.exports)) {
      const name = entry === '.' ? manifest.name : manifest.name + entry.slice(1);
      if (!covered.has(name)) throw new Error(`Missing documentation for package entry: ${name}`);
    }
  }
  const cache = new Map();
  function read(file) {
    if (cache.has(file)) return cache.get(file);
    const text = readFileSync(file, 'utf8');
    const parsed = parse(text, { lang: 'dts' });
    if (parsed.diagnostics.length) throw new Error(`Cannot parse reference declarations: ${file}`);
    const declarations = new Map();
    for (const node of parsed.program.body) {
      const decl = node.declaration ?? node;
      if (decl.type === 'VariableDeclaration')
        for (const value of decl.declarations)
          declarations.set(value.id.name, [...(declarations.get(value.id.name) ?? []), node]);
      else if (decl.id?.name)
        declarations.set(decl.id.name, [...(declarations.get(decl.id.name) ?? []), node]);
    }
    const value = { text, ...parsed, declarations };
    cache.set(file, value);
    return value;
  }
  function localFile(file, name) {
    return path.resolve(path.dirname(file), name.replace(/\.js$/, '.d.ts'));
  }
  function resolveSymbol(file, name, seen = new Set()) {
    const key = file + ':' + name;
    if (seen.has(key)) return null;
    seen.add(key);
    const source = read(file);
    if (source.declarations.has(name)) return { file, name, nodes: source.declarations.get(name) };
    for (const node of source.program.body) {
      for (const spec of node.specifiers ?? []) {
        if ((spec.exported?.name ?? spec.exported?.value) !== name) continue;
        if (!node.source) return resolveSymbol(file, spec.local.name, seen);
        if (node.source.value.startsWith('.'))
          return resolveSymbol(localFile(file, node.source.value), spec.local.name, seen);
        return { external: node.source.value, name: spec.local.name };
      }
    }
    return null;
  }
  function exports(file) {
    const found = new Map();
    const source = read(file);
    for (const node of source.program.body) {
      if (node.type === 'ExportAllDeclaration') {
        if (node.source.value.startsWith('.'))
          for (const entry of exports(localFile(file, node.source.value))) found.set(...entry);
        else found.set(`* from ${node.source.value}`, { external: node.source.value, name: '*' });
      }
      if (node.type === 'ExportDefaultDeclaration')
        found.set('default', { file, name: 'default', nodes: [node] });
      if (node.type !== 'ExportNamedDeclaration') continue;
      const decl = node.declaration;
      if (decl?.id?.name) found.set(decl.id.name, resolveSymbol(file, decl.id.name));
      if (decl?.type === 'VariableDeclaration')
        for (const d of decl.declarations) found.set(d.id.name, resolveSymbol(file, d.id.name));
      for (const spec of node.specifiers ?? []) {
        const name = spec.exported.name ?? spec.exported.value;
        found.set(name, resolveSymbol(file, name));
      }
    }
    return [...found];
  }
  const describe = ([pkg, entry, importPath], symbols, level) => {
    const heading = '#'.repeat(level);
    let body = '';
    for (const [name, symbol] of symbols) {
      if (!symbol) throw new Error(`Unresolved public export ${importPath}:${name}`);
      body += `${heading} \`${name}\`\n\n`;
      if (symbol.external) {
        body += `${reasons[name] ?? `Re-exported from \`${symbol.external}\`.`} [Upstream documentation](${upstream[symbol.external] ?? 'https://github.com/DerpyCrabs/EffectWeb'}).\n\n`;
        continue;
      }
      const source = read(symbol.file);
      const snippets = symbol.nodes.map((node) => source.text.slice(node.start, node.end));
      const first = symbol.nodes[0];
      const comment = source.comments
        .filter((c) => c.end <= first.start && source.text.slice(c.end, first.start).trim() === '')
        .at(-1);
      const doc = comment?.value
        ?.replace(/^\*|\*\/$/g, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\* ?/, ''))
        .join('\n')
        .trim();
      const isType = /(?:interface|type |namespace)/.test(snippets[0].slice(0, 65));
      const why = reasons[`${importPath}:${name}`] ?? reasons[name] ?? doc;
      if (!why && !isType) throw new Error(`Missing API rationale: ${importPath}:${name}`);
      if (why) body += why + '\n\n';
      body +=
        '<details class="api-signature"><summary>Signature</summary>\n\n```ts\n' +
        snippets.join('\n') +
        '\n```\n\n</details>\n\n';
      const deps = new Set();
      for (const token of snippets.join('\n').matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
        if (token[0] === symbol.name || deps.has(token[0])) continue;
        const declarations = source.declarations.get(token[0]);
        if (declarations && !declarations[0].type.startsWith('Export')) deps.add(token[0]);
      }
      if (deps.size)
        body +=
          '<details class="api-signature"><summary>Related types</summary>\n\n```ts\n' +
          [...deps]
            .map((n) =>
              source.declarations
                .get(n)
                .map((d) => source.text.slice(d.start, d.end))
                .join('\n'),
            )
            .join('\n\n') +
          '\n```\n\n</details>\n\n';
      let relative = path.relative(path.join(root, '.api'), symbol.file).replace(/\.d\.ts$/, '.ts');
      if (relative.startsWith('..')) relative = `${pkg}/src/${entry}.ts`;
      if (
        !existsSync(path.join(root, '../packages', relative)) &&
        existsSync(path.join(root, '../packages', relative + 'x'))
      )
        relative += 'x';
      const implementation = existsSync(path.join(root, '../packages', relative))
        ? `packages/${relative}`
        : `scripts/build-${pkg}.mjs`;
      if (!existsSync(path.join(root, '..', implementation)))
        throw new Error(`Missing implementation link: ${implementation}`);
      body += `<p class="api-source"><a href="${repository}${implementation}">Source</a></p>\n\n`;
    }
    return body;
  };
  const notes = {
    '@effectweb/compiler/lint-preset':
      'For JSON configuration, extend `./node_modules/@effectweb/compiler/dist/oxlint-preset.json` instead.',
    '@effectweb/tanstack-table':
      'Targets TanStack Table v9. Use the installed core declarations for version-specific options.',
  };
  const symbolsOf = ([pkg, entry, importPath]) => {
    let file = path.join(root, '.api', pkg, 'src', entry + '.d.ts');
    if (!existsSync(file)) file = path.join(root, '../packages', pkg, 'dist', entry + '.d.ts');
    const typeOnlyEntry = importPath.endsWith('/types');
    return exports(file).filter(([, symbol]) => {
      if (!typeOnlyEntry || symbol?.external) return true;
      const declaration = symbol?.nodes[0]?.declaration ?? symbol?.nodes[0];
      return ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(declaration?.type);
    });
  };
  const intro = (module) => {
    const importPath = module[2];
    let text = `Import from \`${importPath}\`.`;
    if (importPath.endsWith('/types')) text += ' Types only: use `import type`.';
    if (notes[importPath]) text += ' ' + notes[importPath];
    return text + '\n\n';
  };
  const pages = referencePages.map((spec) => {
    const selected = spec.entries.map((name) => {
      const module = modules.find(([, , importPath]) => importPath === name);
      if (!module) throw new Error(`Unknown reference entry: ${name}`);
      return module;
    });
    let body = '';
    if (selected.length === 1 && spec.categories) {
      const [module] = selected;
      const symbols = new Map(symbolsOf(module));
      const listed = spec.categories.flatMap(([, names]) => names);
      for (const name of symbols.keys())
        if (!listed.includes(name)) throw new Error(`Uncategorized export ${module[2]}:${name}`);
      body += intro(module);
      for (const [category, names] of spec.categories) {
        for (const name of names)
          if (!symbols.has(name)) throw new Error(`Unknown export ${module[2]}:${name}`);
        body +=
          `## ${category}\n\n` +
          describe(
            module,
            names.map((name) => [name, symbols.get(name)]),
            3,
          );
      }
    } else if (selected.length === 1) {
      body += intro(selected[0]) + describe(selected[0], symbolsOf(selected[0]), 2);
    } else {
      for (const module of selected)
        body +=
          `## ${module[2]}\n\n${module[3]} ${intro(module)}` +
          describe(module, symbolsOf(module), 3);
    }
    if (spec.icons)
      body +=
        '## Per-icon modules\n\n`@effectweb/lucide/icons/<name>` and `@effectweb/antd-icons/icons/<Name>` each export one icon view as the default export. Lucide modules also export `iconNode` and `viewBox`. There is no root import with every icon. See [Integrations](/docs/integrations/#icons) for usage.\n\n';
    if (spec.internal) {
      body +=
        '## Internal entry points\n\nThese exist for compiled code and TypeScript. Do not import them in application code; the lint preset rejects imports of `effectweb/dom` and the JSX runtime.\n\n';
      for (const entry of ['dom', 'jsx-runtime', 'jsx']) {
        const file = path.join(root, '.api/runtime/src', entry + '.d.ts');
        body += `### effectweb/${entry}\n\n`;
        body +=
          entry === 'dom'
            ? 'The DOM operations that compiled JSX calls.'
            : entry === 'jsx'
              ? 'The JSX namespace: intrinsic HTML and SVG attributes, events and component types. Import the `JSX` type from `effectweb` when typing children.'
              : 'Support for the standard automatic JSX transform. `effectweb/jsx-dev-runtime` points to the same module.';
        body += ` [Source](${repository}packages/runtime/src/${entry}.ts). Exports: ${exports(file)
          .map(([name]) => `\`${name}\``)
          .join(', ')}.\n\n`;
      }
      body +=
        '### Native compiler packages\n\nThe five `@effectweb/native-*` packages contain the compiler binary for each platform and are installed as optional dependencies. They have no JavaScript API.\n\n';
    }
    return {
      title: spec.title,
      description: spec.description,
      group: 'API reference',
      url: `/docs/api-${spec.slug}/`,
      body,
      source:
        selected.length === 1
          ? existsSync(
              path.join(root, '../packages', selected[0][0], 'src', selected[0][1] + '.ts'),
            )
            ? `packages/${selected[0][0]}/src/${selected[0][1]}.ts`
            : `scripts/build-${selected[0][0]}.mjs`
          : 'website/lib/api.mjs',
    };
  });
  return { pages };
}
