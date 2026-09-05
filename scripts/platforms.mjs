export const platforms = [
  { suffix: 'linux-x64-gnu', os: 'linux', cpu: 'x64', libc: 'glibc' },
  { suffix: 'linux-arm64-gnu', os: 'linux', cpu: 'arm64', libc: 'glibc' },
  { suffix: 'darwin-x64', os: 'darwin', cpu: 'x64' },
  { suffix: 'darwin-arm64', os: 'darwin', cpu: 'arm64' },
  { suffix: 'win32-x64-msvc', os: 'win32', cpu: 'x64' },
];
export function hostPlatform() {
  const value = platforms.find((item) => item.os === process.platform && item.cpu === process.arch);
  if (!value || (value.libc && !process.report.getReport().header.glibcVersionRuntime))
    throw new Error(`Unsupported host: ${process.platform}/${process.arch}`);
  return value;
}
