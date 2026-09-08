import { defineConfig } from 'vite-plus';
import { effectweb } from './packages/compiler/src/vite';
export default defineConfig({
  plugins: [effectweb()],
  test: { environment: 'node', include: ['packages/*/src/**/*.test.ts'] },
  lint: {
    ignorePatterns: ['**/dist/**', '**/target/**', 'artifacts/**'],
    plugins: ['typescript', 'unicorn', 'oxc', 'effecttsgo'],
    jsPlugins: ['./packages/compiler/dist/oxlint.js'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'effectweb/query-key': 'error',
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
      'effecttsgo/any-unknown-in-error-context': 'off',
      'effecttsgo/floating-effect': 'error',
      'effectweb/valid-view': 'error',
    },
    overrides: [
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
    ignorePatterns: ['**/dist/**', '**/target/**', 'artifacts/**'],
    semi: true,
    singleQuote: true,
    objectWrap: 'collapse',
  },
});
