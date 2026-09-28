import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import ts from 'typescript';
import { compile } from '../packages/compiler/native.cjs';

const require = createRequire(import.meta.url);
const upstream = dirname(require.resolve('@ant-design/icons-svg/package.json'));
const directory = 'packages/antd-icons/dist';
mkdirSync(`${directory}/icons`, { recursive: true });

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  }).outputText;
writeFileSync(
  `${directory}/attributes.js`,
  transpile(readFileSync('packages/antd-icons/src/attributes.ts', 'utf8')),
);

function geometry(node) {
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => `${key}={${JSON.stringify(value)}}`)
    .join(' ');
  return `<${node.tag} ${attrs}>${(node.children ?? []).map(geometry).join('')}</${node.tag}>`;
}

let count = 0;
for (const file of readdirSync(`${upstream}/lib/asn`).sort()) {
  if (!/(Outlined|Filled)\.js$/.test(file)) continue;
  const name = file.slice(0, -3);
  const definition = require(`${upstream}/lib/asn/${file}`).default;
  const source = `import { view } from 'effectweb';
import { iconAttributes } from '../attributes.js';
const Icon = view((props) => <svg {...iconAttributes(props, ${JSON.stringify(definition.name)}, ${JSON.stringify(definition.icon.attrs.viewBox)})}>
{props.title ? <title>{props.title}</title> : null}
${(definition.icon.children ?? []).map(geometry).join('')}
{props.children}
</svg>);
export default Icon;`;
  const result = JSON.parse(
    compile(
      source,
      `${name}.tsx`,
      JSON.stringify({ importSource: 'effectweb', runtimeModule: 'effectweb/dom' }),
    ),
  );
  if (result.diagnostics.length)
    throw new Error(`Could not compile ${name}: ${JSON.stringify(result.diagnostics)}`);
  writeFileSync(
    `${directory}/icons/${name}.js`,
    `// Generated from @ant-design/icons-svg. See LICENSE.\n${transpile(result.code)}`,
  );
  writeFileSync(
    `${directory}/icons/${name}.d.ts`,
    "import type { AntDesignIcon } from '../attributes.js';\ndeclare const Icon: AntDesignIcon;\nexport default Icon;\n",
  );
  count++;
}
process.stdout.write(`Generated ${count} Ant Design icons with per-icon exports.\n`);
