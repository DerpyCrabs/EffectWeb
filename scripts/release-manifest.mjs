/** Keep every dependency on a package in this release at the same version. */
export function releaseManifest(manifest, version, releaseNames) {
  const next = { ...manifest, version };
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    if (!manifest[field]) continue;
    next[field] = Object.fromEntries(
      Object.entries(manifest[field]).map(([name, range]) => [
        name,
        releaseNames.has(name) ? version : range,
      ]),
    );
  }
  return next;
}
