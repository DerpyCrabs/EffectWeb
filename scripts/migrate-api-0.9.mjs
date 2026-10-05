// Idempotent, binding-aware migration. Only calls bound to EffectWeb imports are renamed.
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)(process.env.TYPESCRIPT_API ?? 'typescript');
if (!ts.createProgram)
  throw new Error(
    'This migration needs the TypeScript 6 compiler API. Install typescript@6 in a temporary directory and set TYPESCRIPT_API to its absolute package path. Modes: rows, keys, controllers, discard.',
  );

import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? '.');
const mode = process.argv[3] ?? 'rows';
const skip = new Set([
  'node_modules',
  '.git',
  'vendor',
  'repos',
  'target',
  'dist',
  'dist.next',
  'artifacts',
  'playwright-report',
  'test-results',
]);
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      skip.has(e.name) || e.name.startsWith('.')
        ? []
        : e.isDirectory()
          ? files(path.join(dir, e.name))
          : /\.[cm]?[jt]sx?$/.test(e.name)
            ? [path.join(dir, e.name)]
            : [],
    );
}
const paths = files(root);
const program = ts.createProgram(paths, {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowJs: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
let count = 0;
for (const file of paths) {
  const source = program.getSourceFile(file);
  if (!source) continue;
  const imports = new Map();
  const names = new Set();
  function scan(n) {
    if (ts.isIdentifier(n)) names.add(n.text);
    ts.forEachChild(n, scan);
  }
  scan(source);
  for (const n of source.statements)
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      (n.moduleSpecifier.text === 'effectweb' ||
        n.moduleSpecifier.text.startsWith('effectweb/') ||
        (root.endsWith('/EffectWeb') &&
          /^\.\/(program|index|component)\.js$/.test(n.moduleSpecifier.text)))
    ) {
      for (const s of n.importClause?.namedBindings?.elements ?? [])
        imports.set(checker.getSymbolAtLocation(s.name), {
          imported: s.propertyName?.text ?? s.name.text,
          local: s.name.text,
          node: s,
        });
    }
  const added = new Map();
  function runtime(name) {
    const old = [...imports.values()].find((i) => i.imported === name);
    if (old) return old.local;
    if (added.has(name)) return added.get(name);
    let local = name;
    while (names.has(local)) local = 'ew' + local[0].toUpperCase() + local.slice(1);
    names.add(local);
    added.set(name, local);
    return local;
  }
  const edits = [];
  const unwrap = (n) =>
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isNonNullExpression(n)
      ? unwrap(n.expression)
      : n;
  function jsx(n) {
    n = unwrap(n);
    return (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n) ||
      (ts.isConditionalExpression(n) && (jsx(n.whenTrue) || jsx(n.whenFalse))) ||
      (ts.isBinaryExpression(n) && (jsx(n.left) || jsx(n.right)))
    );
  }
  function returns(n) {
    if (!ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) return false;
    if (!ts.isBlock(n.body)) return jsx(n.body);
    let found = false;
    function visit(x) {
      if (ts.isReturnStatement(x) && x.expression && jsx(x.expression)) found = true;
      if (
        x !== n.body &&
        (ts.isFunctionExpression(x) || ts.isArrowFunction(x) || ts.isFunctionDeclaration(x))
      )
        return;
      ts.forEachChild(x, visit);
    }
    visit(n.body);
    return found;
  }
  function text(n) {
    let s = n.getText(source);
    for (const e of edits
      .filter((e) => e.start >= n.getStart(source) && e.end <= n.end)
      .sort((a, b) => b.start - a.start))
      s = s.slice(0, e.start - n.getStart(source)) + e.text + s.slice(e.end - n.getStart(source));
    return s;
  }
  function replace(n, value) {
    const start = n.getStart(source);
    for (let i = edits.length - 1; i >= 0; i--)
      if (edits[i].start >= start && edits[i].end <= n.end) edits.splice(i, 1);
    edits.push({ start, end: n.end, text: value });
  }
  function commandObject(node) {
    const context = checker.getContextualType(node);
    if (
      context &&
      checker.getPropertyOfType(context, 'key') &&
      checker.getPropertyOfType(context, 'policy')
    )
      return true;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        imports.get(checker.getSymbolAtLocation(parent.expression))?.imported === 'ownedTasks'
      )
        return true;
    }
    return false;
  }
  function visit(n) {
    ts.forEachChild(n, visit);
    if (
      mode === 'keys' &&
      ts.isPropertyAssignment(n) &&
      n.name.getText(source) === 'slot' &&
      ts.isObjectLiteralExpression(n.parent) &&
      n.parent.properties.some((p) => p.name?.getText(source) === 'policy') &&
      commandObject(n.parent)
    )
      replace(n.name, 'key');

    if (mode === 'discard' && ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)) {
      try {
        const type = checker.getTypeAtLocation(n.expression);
        if (checker.typeToString(type).includes('RunOutcome'))
          replace(n.expression, `void ${text(n.expression)}`);
      } catch {
        /* Invalid scratch definitions may not have a serializable type. */
      }
    }

    if (mode === 'controllers' && ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const binding = imports.get(checker.getSymbolAtLocation(n.expression));
      if (binding?.imported === 'controllerView') {
        const definition = n.arguments[0];
        if (definition && ts.isObjectLiteralExpression(definition))
          for (const property of definition.properties) {
            if (property.name?.getText(source) === 'create') {
              if (ts.isShorthandPropertyAssignment(property))
                replace(property, `controller: ${property.name.text}`);
              else replace(property.name, 'controller');
            }
          }
      }
    }
    if (mode === 'keys' && ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const binding = imports.get(checker.getSymbolAtLocation(n.expression));
      if (binding?.imported === 'commandSlot') replace(n, text(n.arguments[0]));
      if (binding?.imported === 'commandSlots')
        replace(n, `((key: string | number) => [${text(n.arguments[0])}, key] as const)`);
    }
    if (
      mode === 'keys' &&
      ts.isIdentifier(n) &&
      [...imports.values()].some((i) => i.imported === 'CommandSlot' && i.local === n.text)
    ) {
      const binding = imports.get(checker.getSymbolAtLocation(n));
      if (binding?.imported === 'CommandSlot') replace(n, runtime('RunKey'));
    }
    if (
      mode === 'rows' &&
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'map' &&
      n.arguments.length === 1 &&
      returns(unwrap(n.arguments[0]))
    ) {
      const receiver = n.expression.expression,
        callback = n.arguments[0];
      if (unwrap(callback).parameters.length > 2) {
        console.log(
          'REVIEW map array parameter',
          path.relative(root, file),
          source.getLineAndCharacterOfPosition(n.pos).line + 1,
        );
        return;
      }
      const type = checker.getTypeAtLocation(receiver);
      const item = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (!item) {
        console.log(
          'REVIEW non-array',
          path.relative(root, file),
          source.getLineAndCharacterOfPosition(n.pos).line + 1,
        );
        return;
      }
      const parts = item.isUnion() ? item.types : [item];
      const scalar = parts.every(
        (t) =>
          !!(
            t.flags &
            (ts.TypeFlags.StringLike |
              ts.TypeFlags.NumberLike |
              ts.TypeFlags.BooleanLike |
              ts.TypeFlags.Null |
              ts.TypeFlags.Undefined)
          ),
      );
      const identity = ['id', 'key', 'code', 'value', 'name', 'path'].find((k) =>
        checker.getPropertyOfType(item, k),
      );
      let rows = text(receiver);
      let identityArg = '';
      if (!scalar) {
        if (identity === 'id') rows = `${runtime('entities')}(${rows})`;
        else if (identity) identityArg = `, (row) => row.${identity}`;
        else {
          rows = `${runtime('sequence')}(${rows})`;
          console.log(
            'REVIEW positional',
            path.relative(root, file),
            source.getLineAndCharacterOfPosition(n.pos).line + 1,
          );
        }
      }
      replace(n, `${runtime('list')}(${rows}${identityArg}, ${text(callback)})`);
    }
  }
  visit(source);
  if (mode === 'keys')
    for (const n of source.statements)
      if (
        ts.isImportDeclaration(n) &&
        n.importClause?.namedBindings &&
        ts.isNamedImports(n.importClause.namedBindings)
      ) {
        const elements = n.importClause.namedBindings.elements;
        const removed = elements.filter((e) =>
          (mode === 'keys'
            ? ['commandSlot', 'commandSlots', 'CommandSlot']
            : ['controllerView']
          ).includes(imports.get(checker.getSymbolAtLocation(e.name))?.imported),
        );
        if (removed.length) {
          const kept = elements.filter((e) => !removed.includes(e));
          if (!kept.length && !n.importClause.name) replace(n, '');
          else replace(n.importClause.namedBindings, `{ ${kept.map((e) => text(e)).join(', ')} }`);
        }
      }

  if (added.size)
    edits.push({
      start: source.statements[0]?.getStart(source) ?? 0,
      end: source.statements[0]?.getStart(source) ?? 0,
      text: `import { ${[...added].map(([a, b]) => (a === b ? a : `${a} as ${b}`)).join(', ')} } from 'effectweb';\n`,
    });
  if (edits.length) {
    let result = source.text;
    for (const e of edits.sort((a, b) => b.start - a.start))
      result = result.slice(0, e.start) + e.text + result.slice(e.end);
    fs.writeFileSync(file, result);
    count++;
  }
}
console.log(`${root}: ${count} files migrated (${mode})`);
