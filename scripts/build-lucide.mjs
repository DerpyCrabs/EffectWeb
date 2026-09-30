import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as upstream from '@lucide/icons';

const directory = 'packages/lucide/dist';
mkdirSync(`${directory}/icons`, { recursive: true });
const canonical = new Map();
for (const [name, data] of Object.entries(upstream).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (name === 'icons') continue;
  if (!data.name || !data.node) throw new Error(`Unexpected Lucide export: ${name}`);
  canonical.set(data.name, data);
}

// Geometry ships as data; the shared icon factory builds the markup once per icon.
function geometry(nodes) {
  return nodes.map(([tag, attributes, children]) => {
    if (!/^[a-zA-Z][\w-]*$/.test(tag)) throw new Error(`Invalid SVG tag: ${tag}`);
    const attrs = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'key') continue;
      if (!/^[a-zA-Z][\w:-]*$/.test(name)) throw new Error(`Invalid SVG attribute: ${name}`);
      if (typeof value !== 'string' && typeof value !== 'number')
        throw new Error(`Unsupported SVG attribute value: ${name}`);
      attrs[name] = value;
    }
    return children ? [tag, attrs, geometry(children)] : [tag, attrs];
  });
}

for (const [name, data] of canonical) {
  const names = [name, ...(data.aliases ?? [])].map((name) => `lucide-${name}`).join(' ');
  const width = 'size' in data ? data.size : data.width;
  const height = 'size' in data ? data.size : data.height;
  const output = `import { lucideIcon } from '../attributes.js';
export const iconNode = ${JSON.stringify(geometry(data.node))};
export const viewBox = ${JSON.stringify(`0 0 ${width} ${height}`)};
export default /* @__PURE__ */ lucideIcon(${JSON.stringify(names)}, ${width}, ${height}, iconNode);
`;
  writeFileSync(
    `${directory}/icons/${name}.js`,
    `// Generated from @lucide/icons; see LICENSE in the package root.\n${output}`,
  );
  writeFileSync(
    `${directory}/icons/${name}.d.ts`,
    "import type { LucideIcon, IconNode } from '../attributes.js';\nexport declare const iconNode: readonly IconNode[];\nexport declare const viewBox: string;\ndeclare const Icon: LucideIcon;\nexport default Icon;\n",
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
        `export { default, iconNode, viewBox } from './${name}.js';\n`,
      );
  }
}
// Do not expose a root barrel: ESM development servers follow every re-export.
// Remove stale barrels even when this generator is run without a full clean build.
for (const extension of ['js', 'd.ts']) rmSync(`${directory}/index.${extension}`, { force: true });
const registry = [...slugs]
  .map(([slug, name]) => `${JSON.stringify(slug)}: () => import('./icons/${name}.js')`)
  .join(',\n');
writeFileSync(
  `${directory}/dynamic.js`,
  `import * as Effect from 'effect/Effect';
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
  `Generated ${canonical.size} Lucide icons, ${slugs.size} paths, no root barrel from ${version}.\n`,
);
