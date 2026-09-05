import { compile } from '../native.cjs';

export interface SnapshotDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}
export interface SnapshotCompilerOptions {
  /** An additional public module exporting view; relative imports ending in /mvu also work. */
  importSource?: string;
  runtimeModule?: string;
  development?: boolean;
  onDiagnostic?: (diagnostic: SnapshotDiagnostic) => void;
}
export interface SnapshotCompilerResult {
  readonly code: string;
  readonly map: string | null;
  readonly diagnostics: readonly SnapshotDiagnostic[];
}

/** JSX analysis and lowering run in Rust/Oxc; this boundary only transports options and results. */
export function compileSnapshot(
  source: string,
  filename: string,
  options: SnapshotCompilerOptions = {},
): SnapshotCompilerResult {
  const { onDiagnostic, ...nativeOptions } = { importSource: 'effectweb', ...options };
  const result = JSON.parse(
    compile(source, filename, JSON.stringify(nativeOptions)),
  ) as SnapshotCompilerResult;
  for (const diagnostic of result.diagnostics) onDiagnostic?.(diagnostic);
  return result;
}
