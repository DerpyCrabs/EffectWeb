import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);
const upstream = dirname(require.resolve('@ant-design/icons-svg/package.json'));
const directory = 'packages/antd-icons/dist';
mkdirSync(`${directory}/icons`, { recursive: true });

const transpile = (source) =>
  transformSync(source, {
    target: 'es2022',
    supported: { 'import-attributes': true },
    format: 'esm',
    loader: 'ts',
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  }).code;
writeFileSync(
  `${directory}/attributes.js`,
  transpile(readFileSync('packages/antd-icons/src/attributes.ts', 'utf8')),
);

// Geometry ships as data; the shared icon factory builds the markup once per icon.
function geometry(node) {
  if (!/^[a-zA-Z][\w-]*$/.test(node.tag)) throw new Error(`Invalid SVG tag: ${node.tag}`);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!/^[a-zA-Z][\w:-]*$/.test(name)) throw new Error(`Invalid SVG attribute: ${name}`);
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new Error(`Unsupported SVG attribute value: ${name}`);
  }
  return node.children?.length
    ? { tag: node.tag, attrs: node.attrs, children: node.children.map(geometry) }
    : { tag: node.tag, attrs: node.attrs };
}

let count = 0;
for (const file of readdirSync(`${upstream}/lib/asn`).sort()) {
  if (!/(Outlined|Filled)\.js$/.test(file)) continue;
  const name = file.slice(0, -3);
  const definition = require(`${upstream}/lib/asn/${file}`).default;
  const output = `import { antDesignIcon } from '../attributes.js';
export default /* @__PURE__ */ antDesignIcon(${JSON.stringify(definition.name)}, ${JSON.stringify(definition.icon.attrs.viewBox)}, ${JSON.stringify((definition.icon.children ?? []).map(geometry))});
`;
  writeFileSync(
    `${directory}/icons/${name}.js`,
    `// Generated from @ant-design/icons-svg. See LICENSE.\n${output}`,
  );
  writeFileSync(
    `${directory}/icons/${name}.d.ts`,
    "import type { AntDesignIcon } from '../attributes.js';\ndeclare const Icon: AntDesignIcon;\nexport default Icon;\n",
  );
  count++;
}
process.stdout.write(`Generated ${count} Ant Design icons with per-icon exports.\n`);
