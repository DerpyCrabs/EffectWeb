import type { Plugin } from 'vite';
import { compile, type CompilerOptions } from './compile.js';
import { isCompilerFile } from './files.js';

export interface EffectWebOptions extends CompilerOptions {
  /** Install bounded JSON profiling at globalThis.__EFFECTWEB_PROFILE__ in development only. */
  profile?: boolean;
}
export function effectweb(options: EffectWebOptions = {}) {
  let development = false;
  const profile = options.profile ?? process.env.EFFECTWEB_PROFILE === '1';
  return {
    config(_config: unknown, environment: { command: 'build' | 'serve' }) {
      return {
        define: {
          __EFFECTWEB_DEV__: JSON.stringify(environment.command === 'serve'),
          __EFFECTWEB_PROFILE_ENABLED__: JSON.stringify(environment.command === 'serve' && profile),
        },
        resolve: { dedupe: ['effect', 'effectweb'] },
        optimizeDeps: { exclude: ['effectweb'] },
      };
    },
    configResolved(config: { command: 'build' | 'serve' }) {
      development = config.command === 'serve';
    },
    resolveId(id: string) {
      if (id === 'virtual:effectweb-profiler' && development && profile)
        return '\0virtual:effectweb-profiler';
      return undefined;
    },
    load(id: string) {
      if (id === '\0virtual:effectweb-profiler' && development && profile)
        return "import { installProfiler } from 'effectweb/profiling'; const profiler = installProfiler(); if(new URL(location.href).searchParams.has('effectweb-profile')) profiler.start();";
      return undefined;
    },
    transformIndexHtml() {
      if (!development || !profile) return;
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/@id/__x00__virtual:effectweb-profiler' },
          injectTo: 'head-prepend' as const,
        },
      ];
    },
    name: 'effectweb-jsx',
    enforce: 'pre',
    transform(this: { warn(message: string): void }, code: string, id: string) {
      const filename = id.split('?')[0];
      if (!filename || !isCompilerFile(filename)) return;
      const result = compile(code, filename, {
        ...options,
        development,
        profile: development && profile,
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
