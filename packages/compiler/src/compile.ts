import { compile as nativeCompile } from '../native.cjs';

export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly category: 'correctness' | 'unprovable-dependency' | 'performance';
  readonly remedy: string;
}
export interface CompilerOptions {
  /** The module exporting view and slot. Defaults to effectweb. */
  importSource?: string;
  runtimeModule?: string;
  development?: boolean;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}
export interface CompilerResult {
  readonly code: string;
  readonly map: string | null;
  readonly diagnostics: readonly Diagnostic[];
}

export function compile(
  source: string,
  filename: string,
  options: CompilerOptions = {},
): CompilerResult {
  const { onDiagnostic, ...nativeOptions } = { importSource: 'effectweb', ...options };
  const result = JSON.parse(
    nativeCompile(source, filename, JSON.stringify(nativeOptions)),
  ) as CompilerResult;
  for (const diagnostic of result.diagnostics) onDiagnostic?.(diagnostic);
  return result;
}

/** Run the same view analysis as compilation, collecting one error per invalid view. */
export function diagnose(
  source: string,
  filename: string,
  options: Omit<CompilerOptions, 'onDiagnostic'> = {},
): readonly Diagnostic[] {
  return (
    JSON.parse(
      nativeCompile(
        source,
        filename,
        JSON.stringify({
          importSource: 'effectweb',
          ...options,
          development: true,
          diagnosticsOnly: true,
        }),
      ),
    ) as CompilerResult
  ).diagnostics;
}
