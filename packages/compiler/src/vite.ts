import type { Plugin } from 'vite';
import { compile, type CompilerOptions } from './compile.js';
import { isCompilerFile } from './files.js';

export function effectweb(options: CompilerOptions = {}) {
  let development = false;
  return {
    config(_config: unknown, environment: { command: 'build' | 'serve' }) {
      return {
        define: { __EFFECTWEB_DEV__: JSON.stringify(environment.command === 'serve') },
        resolve: { dedupe: ['effect', 'effectweb'] },
        optimizeDeps: { exclude: ['effectweb'] },
      };
    },
    configResolved(config: { command: 'build' | 'serve' }) {
      development = config.command === 'serve';
    },
    name: 'effectweb-jsx',
    enforce: 'pre',
    transform(this: { warn(message: string): void }, code: string, id: string) {
      const filename = id.split('?')[0];
      if (!filename || !isCompilerFile(filename)) return;
      const result = compile(code, filename, {
        ...options,
        development,
        onDiagnostic:
          options.onDiagnostic ??
          ((diagnostic) =>
            this.warn(
              `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`,
            )),
      });
      return { code: result.code, map: result.map };
    },
  } satisfies Plugin;
}

export default effectweb;
