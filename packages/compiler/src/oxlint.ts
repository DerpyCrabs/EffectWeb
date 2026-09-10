import { diagnose, lint, type CompilerOptions, type Diagnostic } from './compile.js';
import { isCompilerFile } from './files.js';

type Source = { text: string };
type Context = {
  filename: string;
  sourceCode: Source;
  options: readonly Pick<CompilerOptions, 'importSource'>[];
  report: (diagnostic: { loc: { line: number; column: number }; message: string }) => void;
};
const results = new WeakMap<
  Source,
  { text: string; diagnostics: Map<string, readonly Diagnostic[]> }
>();
function rule(category: Diagnostic['category'] | 'errors' | 'render-safety') {
  return {
    meta: {
      type: category !== 'performance' ? ('problem' as const) : ('suggestion' as const),
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
          if (!isCompilerFile(context.filename)) return;
          const importSource = context.options[0]?.importSource ?? 'effectweb';
          let cached = results.get(context.sourceCode);
          if (!cached || cached.text !== context.sourceCode.text) {
            cached = { text: context.sourceCode.text, diagnostics: new Map() };
            results.set(context.sourceCode, cached);
          }
          const heuristic = category === 'render-safety' || category === 'unprovable-dependency';
          const key = `${context.filename}\0${importSource}\0${heuristic}`;
          let diagnostics = cached.diagnostics.get(key);
          if (!diagnostics) {
            try {
              diagnostics = (heuristic ? lint : diagnose)(
                context.sourceCode.text,
                context.filename,
                { importSource },
              );
            } catch (error) {
              // Parser failures and unavailable native binaries must not silently pass lint.
              diagnostics = [
                {
                  file: context.filename,
                  line: 1,
                  column: 1,
                  severity: 'error',
                  code: 'EW1000',
                  category: 'correctness',
                  remedy:
                    'Fix the parser error or install the native compiler binary for this platform.',
                  message: error instanceof Error ? error.message : String(error),
                },
              ];
            }
            cached.diagnostics.set(key, diagnostics);
          }
          for (const diagnostic of diagnostics) {
            const selected =
              category === 'render-safety'
                ? ['EW1000', 'EW1003', 'EW2001'].includes(diagnostic.code)
                : category === 'unprovable-dependency'
                  ? diagnostic.code === 'EW2002' || diagnostic.code === 'EW1000'
                  : category === 'errors'
                    ? diagnostic.severity === 'error'
                    : diagnostic.category === category;
            if (!selected) continue;
            context.report({
              loc: { line: diagnostic.line, column: diagnostic.column - 1 },
              message: `[${diagnostic.code}] ${diagnostic.message}`,
            });
          }
        },
      };
    },
  };
}
export default {
  meta: { name: 'effectweb' },
  rules: {
    'valid-view': rule('errors'),
    'render-safety': rule('render-safety'),
    'query-key': rule('unprovable-dependency'),
  },
};
