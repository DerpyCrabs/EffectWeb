import { diagnose, type Diagnostic } from './compile.js';

// Only the standard ESLint-compatible APIs used here are required by the plugin.
type Source = { text: string };
type Context = {
  filename: string;
  sourceCode: Source;
  options: readonly { importSource?: string }[];
  report: (diagnostic: { loc: { line: number; column: number }; message: string }) => void;
};
const results = new WeakMap<
  Source,
  { text: string; diagnostics: Map<string, readonly Diagnostic[]> }
>();
function rule(severity: Diagnostic['severity']) {
  return {
    meta: {
      type: severity === 'error' ? ('problem' as const) : ('suggestion' as const),
      schema: [
        {
          type: 'object',
          properties: { importSource: { type: 'string' } },
          additionalProperties: false,
        },
      ],
    },
    create(context: Context) {
      return {
        Program() {
          if (!context.filename.endsWith('.tsx')) return;
          const importSource = context.options[0]?.importSource ?? 'effectweb';
          let cached = results.get(context.sourceCode);
          if (!cached || cached.text !== context.sourceCode.text) {
            cached = { text: context.sourceCode.text, diagnostics: new Map() };
            results.set(context.sourceCode, cached);
          }
          const key = `${context.filename}\0${importSource}`;
          let diagnostics = cached.diagnostics.get(key);
          if (!diagnostics) {
            try {
              diagnostics = diagnose(context.sourceCode.text, context.filename, { importSource });
            } catch (error) {
              // Parser failures and unavailable native binaries must not silently pass lint.
              diagnostics = [
                {
                  file: context.filename,
                  line: 1,
                  column: 1,
                  severity: 'error',
                  message: error instanceof Error ? error.message : String(error),
                },
              ];
            }
            cached.diagnostics.set(key, diagnostics);
          }
          for (const diagnostic of diagnostics) {
            if (diagnostic.severity !== severity) continue;
            context.report({
              loc: { line: diagnostic.line, column: diagnostic.column - 1 },
              message: diagnostic.message,
            });
          }
        },
      };
    },
  };
}
export default {
  meta: { name: 'effectweb' },
  rules: { 'valid-view': rule('error'), 'whole-model-dependency': rule('warning') },
};
