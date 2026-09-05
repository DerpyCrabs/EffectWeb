/** npm pack removes @ and replaces the scope separator with a dash. */
export const packageFilename = (name, version) =>
  `${name.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`;
