const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { name } = require('./package.json');
const local = join(__dirname, 'native', 'effectweb-compiler.node');
let suffix;
if (existsSync(local)) suffix = 'local';
else if (process.platform === 'linux') {
  if (!process.report.getReport().header.glibcVersionRuntime) {
    throw new Error(`${name} currently supports glibc Linux. musl requires a source build.`);
  }
  suffix = `linux-${process.arch}-gnu`;
} else if (process.platform === 'darwin') suffix = `darwin-${process.arch}`;
else if (process.platform === 'win32') suffix = `win32-${process.arch}-msvc`;
else throw new Error(`${name}: unsupported platform ${process.platform}/${process.arch}`);
try {
  const binding = existsSync(local) ? require(local) : require(`${name}-${suffix}`);
  exports.compile = binding.compile;
} catch (error) {
  throw new Error(
    `Cannot load ${name} for ${suffix}. Install optional dependencies; framework contributors should run npm run build:compiler.`,
    { cause: error },
  );
}
