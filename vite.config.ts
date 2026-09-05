import { defineConfig } from 'vite-plus';
import { effectweb } from './packages/compiler/src/vite';
export default defineConfig({
  plugins: [effectweb()],
  test: { environment: 'node', include: ['packages/*/src/**/*.test.ts'] },
  lint: {
    ignorePatterns: ['**/dist/**', '**/target/**', 'artifacts/**'],
    plugins: ['typescript', 'unicorn', 'oxc', 'effecttsgo'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'effecttsgo/any-unknown-in-error-context': 'off',
      'effecttsgo/floating-effect': 'error',
    },
  },
  fmt: {
    ignorePatterns: ['**/dist/**', '**/target/**', 'artifacts/**'],
    semi: true,
    singleQuote: true,
    objectWrap: 'collapse',
  },
});
