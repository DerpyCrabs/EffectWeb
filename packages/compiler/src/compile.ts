import { compile as nativeCompile } from '../native.cjs';

export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
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

/** JSX analysis and lowering run in Rust/Oxc; this boundary only transports options and results. */
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
