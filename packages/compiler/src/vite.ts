import type { Plugin } from 'vite';
import { compile, type CompilerOptions } from './compile.js';

export function effectweb(options: CompilerOptions = {}): Plugin {
  let development = false;
  return {
    config(_config, environment) {
      return {
        define: { __EFFECTWEB_DEV__: JSON.stringify(environment.command === 'serve') },
        resolve: { dedupe: ['effect'] },
      };
    },
    configResolved(config) {
      development = config.command === 'serve';
    },
    name: 'effectweb-jsx',
    enforce: 'pre',
    transform(code, id) {
      const filename = id.split('?')[0];
      if (!filename?.endsWith('.tsx')) return;
      const result = compile(code, filename, {
        ...options,
        development,
        onDiagnostic:
          options.onDiagnostic ??
          ((diagnostic) =>
            this.warn(
              `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
            )),
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default effectweb;
