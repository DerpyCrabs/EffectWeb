import { defineConfig } from 'vite-plus';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { effectweb } from './packages/compiler/src/vite';

// The dev server behind the browser tests resolves workspace packages to their sources, so a test
// never runs against a stale dist. Generated packages (icons) and the compiler keep their builds.
const sourcePackages = [
  'runtime',
  'query',
  'json-render',
  'tanstack-router',
  'tanstack-form',
  'tanstack-table',
  'keycloak',
  'base-ui',
  'shadcn',
];
const sourceAliases = sourcePackages.flatMap((directory) => {
  const root = fileURLToPath(new URL(`./packages/${directory}/`, import.meta.url)).replaceAll(
    '\\',
    '/',
  );
  const manifest = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as {
    name: string;
    exports: Record<string, string | { import?: string }>;
  };
  return Object.entries(manifest.exports).flatMap(([entry, target]) => {
    const file = typeof target === 'string' ? target : target.import;
    if (!file?.endsWith('.js')) return [];
    const subpath = entry === '.' ? '' : entry.slice(1);
    const source = file.replace(/^\.\/dist\//, `${root}src/`).replace(/\.js$/, '');
    if (!subpath.includes('*'))
      return [
        {
          find: new RegExp(`^${(manifest.name + subpath).replace(/[/.]/g, '\\$&')}$`),
          replacement: source,
        },
      ];
    const [before] = subpath.split('*');
    return [
      {
        find: new RegExp(`^${(manifest.name + before).replace(/[/.]/g, '\\$&')}([a-z0-9-]+)$`),
        replacement: source.replace('*', '$1'),
      },
    ];
  });
});
export default defineConfig({
  resolve: { alias: sourceAliases },
  // Tailwind serves the shadcn fixture's CSS; it touches nothing that does not import it.
  plugins: [effectweb(), tailwindcss()],
  // Scan dynamically imported browser fixtures and the excluded linked runtime's dependencies.
  // Foreign .jsx fixtures use stubs supplied only by the package smoke test.
  optimizeDeps: {
    entries: [
      'index.html',
      'tests/fixtures/**/*.{ts,tsx}',
      'packages/runtime/src/**/*.{ts,tsx}',
      '!packages/runtime/src/**/*.{test,typecheck}.{ts,tsx}',
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['**/dist/**', '**/target/**', 'artifacts/**', 'vendor/**', 'website/**'],
    plugins: ['typescript', 'unicorn', 'oxc', 'effecttsgo'],
    jsPlugins: ['./packages/compiler/dist/oxlint.js'],
    options: { typeAware: true, typeCheck: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'effecttsgo/missing-effect-context': 'error',
      'effecttsgo/missing-effect-error': 'error',
      'effecttsgo/missing-layer-context': 'error',
      'effecttsgo/missing-return-yield-star': 'error',
      'effecttsgo/missing-star-in-yield-effect-gen': 'error',
      'effecttsgo/class-self-mismatch': 'error',
      'effecttsgo/non-object-effect-service-type': 'error',
      'typescript/no-misused-promises': 'error',
      'typescript/switch-exhaustiveness-check': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-floating-promises': ['error', { ignoreVoid: false }],
      'typescript/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'effectweb/dom',
              message:
                'Compiler implementation API. Use view, domMount, mountView, and owned application APIs.',
            },
            {
              name: 'effectweb/jsx-runtime',
              message: 'JSX compiler implementation API; authored modules use effectweb.',
            },
            {
              name: 'effectweb/jsx-dev-runtime',
              message: 'JSX compiler implementation API; authored modules use effectweb.',
            },
          ],
        },
      ],
      // @effect/tsgo 0.47.1 stability rules panic on aliased symbols in this workspace.
      'effecttsgo/experimental-api-usage': 'off',
      'effecttsgo/unstable-api-usage': 'off',
      'effecttsgo/any-unknown-in-error-context': 'off',
      'effecttsgo/floating-effect': 'error',
      'effectweb/valid-view': 'error',
      'effectweb/identity': 'error',
      'effectweb/no-hook-names': 'error',
    },
    overrides: [
      {
        // Negative type contracts pass Effects that deliberately miss services or errors. The
        // type-aware Effect rules report them inconsistently between runs, so they are off here.
        files: ['**/*.typecheck.ts', '**/*.typecheck.tsx'],
        rules: {
          'effecttsgo/missing-effect-context': 'off',
          'effecttsgo/missing-effect-error': 'off',
        },
      },
      {
        files: ['packages/runtime/src/**'],
        rules: { 'effectweb/valid-view': ['error', { importSource: './index.js' }] },
      },
      {
        files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
        rules: {
          'typescript/no-unsafe-argument': 'error',
          'typescript/no-unsafe-assignment': 'error',
          'typescript/no-unsafe-call': 'error',
          'typescript/no-unsafe-member-access': 'error',
          'typescript/no-unsafe-return': 'error',
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: [
      '**/dist/**',
      '**/target/**',
      'artifacts/**',
      'vendor/**',
      'website/node_modules/**',
      'website/.astro/**',
      'packages/shadcn/registry/**',
      'website/public/r/**',
    ],
    semi: true,
    singleQuote: true,
    objectWrap: 'collapse',
  },
});
