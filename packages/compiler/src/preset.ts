type Severity = 'error' | 'warn' | 'off';
export interface EffectwebLint {
  jsPlugins: string[];
  options: { reportUnusedDisableDirectives: Severity };
  rules: {
    'effectweb/valid-view': Severity;
    'effectweb/identity': Severity;
    'effectweb/render-safety': Severity;
    'effectweb/no-hook-names': Severity;
    'no-restricted-imports': [Severity, { paths: { name: string; message: string }[] }];
  };
}

const implementation = 'JSX compiler implementation API; authored modules use effectweb.';
/**
 * Lint settings for EffectWeb projects. Spread it into a JavaScript Oxlint configuration;
 * JSON configurations extend `@effectweb/compiler/oxlint-preset.json` instead. Both forms
 * carry the same rules, all as errors: agents and CI treat warnings as noise. A suppression
 * that no longer suppresses anything is an error too, so stale exceptions do not accumulate.
 */
export const effectwebLint: EffectwebLint = {
  jsPlugins: ['@effectweb/compiler/oxlint'],
  options: { reportUnusedDisableDirectives: 'error' },
  rules: {
    'effectweb/valid-view': 'error',
    'effectweb/identity': 'error',
    'effectweb/render-safety': 'error',
    'effectweb/no-hook-names': 'error',
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'effectweb/dom',
            message:
              'Compiler implementation API. Use view, domMount, mount, and owned application APIs.',
          },
          { name: 'effectweb/jsx-runtime', message: implementation },
          { name: 'effectweb/jsx-dev-runtime', message: implementation },
        ],
      },
    ],
  },
};
export default effectwebLint;
