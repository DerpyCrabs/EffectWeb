interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
export function releaseManifest<T extends Manifest>(
  manifest: T,
  version: string,
  releaseNames: ReadonlySet<string>,
): T;
