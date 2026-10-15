// Checks the documentation contract of every public export from the TypeScript sources, so a
// missing description fails the unit tests in seconds instead of the end of `npm run build:js`.
// A value export needs a JSDoc comment on its declaration or an entry in reasons.mjs; a page
// with categories must list every export of its entry point.
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yuku-parser';
import { modules, referencePages } from './api.mjs';
import { reasons } from './reasons.mjs';

const packagesRoot = new URL('../../packages/', import.meta.url).pathname;
// Built on first use: api.mjs imports this module, so its lists are not ready at load time.
let packageDirectory;
const directories = () =>
  (packageDirectory ??= new Map(
    modules.map(([directory, , importPath]) => [
      importPath
        .split('/')
        .slice(0, importPath.startsWith('@') ? 2 : 1)
        .join('/'),
      directory,
    ]),
  ));

function sourceOf(directory, entry) {
  for (const extension of ['.ts', '.tsx']) {
    const file = `${packagesRoot}${directory}/src/${entry}${extension}`;
    if (existsSync(file)) return file;
  }
  return undefined;
}

// A workspace specifier such as `@effectweb/base-ui/dialog` maps to that package's source.
function workspaceSource(specifier) {
  for (const [name, directory] of directories()) {
    if (specifier === name) return sourceOf(directory, 'index');
    if (specifier.startsWith(name + '/'))
      return sourceOf(directory, specifier.slice(name.length + 1));
  }
  return undefined;
}

const parsed = new Map();
function read(file) {
  let value = parsed.get(file);
  if (!value) {
    const text = readFileSync(file, 'utf8');
    value = { text, ...parse(text, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) };
    parsed.set(file, value);
  }
  return value;
}

function resolve(file, specifier) {
  if (specifier.startsWith('.')) {
    const base = new URL(specifier.replace(/\.js$/, ''), `file://${file}`).pathname;
    for (const extension of ['.ts', '.tsx'])
      if (existsSync(base + extension)) return base + extension;
    return undefined;
  }
  return workspaceSource(specifier);
}

const commentBefore = (source, node) =>
  source.comments.some(
    (comment) =>
      comment.value.startsWith('*') &&
      comment.end <= node.start &&
      source.text.slice(comment.end, node.start).trim() === '',
  );

const isTypeDeclaration = (node) =>
  /^(TSInterfaceDeclaration|TSTypeAliasDeclaration|TSModuleDeclaration|TSDeclareFunction)$/.test(
    node?.type ?? '',
  );

// name -> { documented, type, origin } for every export of a module, following re-exports.
function exportsOf(file, seen = new Set()) {
  const result = new Map();
  if (!file || seen.has(file)) return result;
  seen.add(file);
  const source = read(file);
  const locals = new Map();
  for (const node of source.program.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    const holder = node.type === 'ExportNamedDeclaration' ? node : node;
    if (!declaration) continue;
    const names =
      declaration.type === 'VariableDeclaration'
        ? declaration.declarations.map((d) => d.id?.name)
        : [declaration.id?.name];
    for (const name of names)
      if (name)
        locals.set(name, {
          documented: commentBefore(source, holder) || commentBefore(source, declaration),
          type: isTypeDeclaration(declaration),
          origin: file,
        });
  }
  for (const node of source.program.body) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        const declaration = node.declaration;
        const names =
          declaration.type === 'VariableDeclaration'
            ? declaration.declarations.map((d) => d.id?.name)
            : [declaration.id?.name];
        for (const name of names) if (name) result.set(name, locals.get(name));
        continue;
      }
      const target = node.source ? resolve(file, node.source.value) : undefined;
      const targetExports = target ? exportsOf(target, new Set(seen)) : undefined;
      for (const specifier of node.specifiers ?? []) {
        const exported = specifier.exported.name ?? specifier.exported.value;
        const local = specifier.local.name ?? specifier.local.value;
        const typeOnly = node.exportKind === 'type' || specifier.exportKind === 'type';
        const resolved = node.source ? targetExports?.get(local) : locals.get(local);
        result.set(exported, {
          documented: resolved?.documented && exported === local,
          type: typeOnly || resolved?.type === true,
          origin: resolved?.origin,
          external: node.source && !target ? node.source.value : resolved?.external,
        });
      }
    } else if (node.type === 'ExportAllDeclaration') {
      const target = resolve(file, node.source.value);
      for (const [name, value] of exportsOf(target, new Set(seen)))
        if (!result.has(name)) result.set(name, value);
    }
  }
  return result;
}

const originPath = (origin) => {
  const directory = origin?.match(/packages\/([^/]+)\/src\//)?.[1];
  return directory === 'runtime' ? 'effectweb' : directory ? `@effectweb/${directory}` : undefined;
};

/** Public exports without a description, and categorized pages that miss an export. */
export function apiCoverageProblems() {
  const problems = [];
  for (const [directory, entry, importPath] of modules) {
    const file = sourceOf(directory, entry);
    if (!file) continue;
    for (const [name, symbol] of exportsOf(file)) {
      if (!symbol || symbol.type || symbol.external || symbol.documented) continue;
      const origin = originPath(symbol.origin);
      if (
        reasons[`${importPath}:${name}`] ??
        (origin && reasons[`${origin}:${name}`]) ??
        reasons[name]
      )
        continue;
      problems.push(`${importPath}:${name} has no JSDoc or reasons.mjs entry`);
    }
  }
  for (const page of referencePages) {
    if (!page.categories || page.entries.length !== 1) continue;
    const module = modules.find(([, , importPath]) => importPath === page.entries[0]);
    const file = module && sourceOf(module[0], module[1]);
    if (!file) continue;
    const listed = new Set(page.categories.flatMap(([, names]) => names));
    for (const name of exportsOf(file).keys())
      if (!listed.has(name))
        problems.push(
          `${page.entries[0]}:${name} is not in a category of the ${page.slug} reference page`,
        );
  }
  return problems;
}
