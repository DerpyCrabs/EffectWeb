export function isCompilerFile(filename: string): boolean {
  return /\.(?:tsx?|jsx)$/u.test(filename) && !filename.endsWith('.d.ts');
}
