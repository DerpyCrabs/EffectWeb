import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import * as upstream from '@lucide/icons';
import { compile } from '../packages/compiler/native.cjs';

const directory = 'packages/lucide/dist';
mkdirSync(`${directory}/icons`, { recursive: true });
const canonical = new Map();
const exports = [];
for (const [name, data] of Object.entries(upstream).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (name === 'icons') continue;
  if (!data.name || !data.node) throw new Error(`Unexpected Lucide export: ${name}`);
  canonical.set(data.name, data);
  exports.push(`export { default as ${name} } from './icons/${data.name}.js';`);
}

function geometry(nodes) {
  return nodes
    .map(([tag, attributes, children]) => {
      if (!/^[a-zA-Z][\w-]*$/.test(tag)) throw new Error(`Invalid SVG tag: ${tag}`);
      const attrs = Object.entries(attributes)
        .filter(([name]) => name !== 'key')
        .map(([name, value]) => {
          if (!/^[a-zA-Z][\w:-]*$/.test(name)) throw new Error(`Invalid SVG attribute: ${name}`);
          return `${name}={${JSON.stringify(value)}}`;
        })
        .join(' ');
      return `<${tag} vector-effect={props.absoluteStrokeWidth ? 'non-scaling-stroke' : undefined} ${attrs}>${children ? geometry(children) : ''}</${tag}>`;
    })
    .join('');
}

for (const [name, data] of canonical) {
  const names = [name, ...(data.aliases ?? [])].map((name) => `lucide-${name}`).join(' ');
  const width = 'size' in data ? data.size : data.width;
  const height = 'size' in data ? data.size : data.height;
  const source = `import { view } from 'effectweb';
import { withIconAttributes } from '../attributes.js';
const Geometry = view((props, _send) => <svg>
{props.title ? <title>{props.title}</title> : null}
${geometry(data.node)}
{props.children}
</svg>);
const Icon = withIconAttributes(Geometry, ${JSON.stringify(names)}, ${width}, ${height});
export default Icon;`;
  const result = JSON.parse(
    compile(
      source,
      `${name}.tsx`,
      JSON.stringify({ importSource: 'effectweb', runtimeModule: 'effectweb/dom' }),
    ),
  );
  if (result.diagnostics.length || !result.code.includes('_ew_dom.compiled'))
    throw new Error(`Icon was not compiled: ${name}: ${JSON.stringify(result.diagnostics)}`);
  const output = ts.transpileModule(result.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  writeFileSync(
    `${directory}/icons/${name}.js`,
    `// Generated from @lucide/icons; see LICENSE in the package root.\n${output}`,
  );
  writeFileSync(
    `${directory}/icons/${name}.d.ts`,
    "import type { LucideIcon } from '../attributes.js';\ndeclare const Icon: LucideIcon;\nexport default Icon;\n",
  );
}

// Read upstream file paths, then add aliases from metadata with the same view identity.
const upstreamDirectory = join(
  dirname(fileURLToPath(import.meta.resolve('@lucide/icons'))),
  'icons',
);
const slugs = new Map();
for (const file of readdirSync(upstreamDirectory).sort()) {
  if (!file.endsWith('.mjs') || file === 'index.mjs') continue;
  const slug = file.slice(0, -4);
  const { default: data } = await import(`@lucide/icons/icons/${slug}`);
  if (!canonical.has(data.name)) throw new Error(`Missing canonical icon: ${data.name}`);
  slugs.set(slug, data.name);
}
for (const [name, data] of canonical) {
  for (const alias of data.aliases ?? []) {
    if (slugs.has(alias) && slugs.get(alias) !== name)
      throw new Error(`Conflicting Lucide alias: ${alias}`);
    slugs.set(alias, name);
  }
}
for (const [slug, name] of slugs) {
  if (slug !== name) {
    for (const extension of ['js', 'd.ts'])
      writeFileSync(
        `${directory}/icons/${slug}.${extension}`,
        `export { default } from './${name}.js';\n`,
      );
  }
}
const barrel = exports.join('\n') + '\n';
writeFileSync(`${directory}/index.js`, barrel);
writeFileSync(
  `${directory}/index.d.ts`,
  "export type { LucideIcon, LucideProps } from './attributes.js';\n" + barrel,
);
const registry = [...slugs]
  .map(([slug, name]) => `${JSON.stringify(slug)}: () => import('./icons/${name}.js')`)
  .join(',\n');
writeFileSync(
  `${directory}/dynamic.js`,
  `import { Effect } from 'effect';
export const dynamicIconImports = Object.freeze({${registry}});
export const iconNames = Object.freeze(Object.keys(dynamicIconImports));
export const isIconName = name => Object.hasOwn(dynamicIconImports, name);
export class IconLoadError extends Error {
  _tag = 'IconLoadError';
  constructor(name, cause) { super('Could not load Lucide icon: ' + name, { cause }); this.name = 'IconLoadError'; this.iconName = name; }
}
export const loadIcon = name => Effect.tryPromise({
  try: async () => {
    if (!isIconName(name)) throw new Error('Unknown icon');
    return (await dynamicIconImports[name]()).default;
  },
  catch: cause => new IconLoadError(name, cause)
});
`,
);
writeFileSync(
  `${directory}/dynamic.d.ts`,
  `import type { Effect } from 'effect';
import type { LucideIcon } from './attributes.js';
export type IconName = ${[...slugs.keys()].map((name) => JSON.stringify(name)).join(' | ')};
export declare const dynamicIconImports: Readonly<Record<IconName, () => Promise<{ default: LucideIcon }>>>;
export declare const iconNames: readonly IconName[];
export declare function isIconName(name: string): name is IconName;
export declare class IconLoadError extends Error { readonly _tag: 'IconLoadError'; readonly iconName: string; constructor(name: string, cause: unknown); }
export declare function loadIcon(name: IconName): Effect.Effect<LucideIcon, IconLoadError>;
`,
);
const { version } = JSON.parse(readFileSync('node_modules/@lucide/icons/package.json', 'utf8'));
const expected = JSON.parse(readFileSync('packages/lucide/package.json', 'utf8')).dependencies[
  '@lucide/icons'
];
if (version !== expected) throw new Error(`Lucide version mismatch: ${version} / ${expected}`);
process.stdout.write(
  `Generated ${canonical.size} Lucide icons, ${slugs.size} paths, ${exports.length} named exports from ${version}.\n`,
);
