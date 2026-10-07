import { expect, it } from 'vitest';
import { lint } from './compile';

const codes = (source: string) => lint(source, 'work.tsx').map((diagnostic) => diagnostic.code);

it('reports an update that calls a prop callback, runs an Effect or writes to its model', () => {
  const component = (body: string) =>
    `import { component, view } from 'effectweb'; import { Effect } from 'effect';
export const C = component({ init: (props) => ({ props, n: 0 }), update: (model, message) => { ${body} } }, view((m) => <p>{m.n}</p>));`;
  expect(codes(component(`model.props.onChange(1); return { model };`))).toEqual(['EW1004']);
  expect(codes(component(`Effect.runFork(Effect.void); return { model };`))).toEqual(['EW1004']);
  expect(codes(component(`model.rows.push(1); return { model };`))).toEqual(['EW1004']);
  expect(codes(component(`model.n = 2; return { model };`))).toEqual(['EW1004']);
  expect(codes(component(`const rows = [...model.rows]; rows.push(1); return { model };`))).toEqual(
    [],
  );
  expect(
    codes(
      `import { program } from 'effectweb'; import { Effect } from 'effect';
export const p = program({ initial: { n: 0 }, update(model) { Effect.runSync(Effect.void); return { model }; } });`,
    ),
  ).toEqual(['EW1004']);
});

it('accepts an update that returns the work as a command or reads prop data', () => {
  const source = `import { component, view } from 'effectweb'; import { Effect } from 'effect';
export const C = component({ init: (props) => ({ props, n: 0 }), update: (model, message) => ({
  model: { ...model, n: model.props.rows.filter(Boolean).length + model.props.title.trim().length },
  commands: [{ key: 'notify', policy: 'queue', effect: Effect.sync(() => model.props.onChange(1)) }],
}) }, view((m) => <p>{m.n}</p>));`;
  expect(codes(source)).toEqual([]);
});

it('reports a patch in a finalizer of replaced work, and not under other policies', () => {
  const run = (policy: string, finalizer: string) =>
    `import { modelOwner } from 'effectweb'; import { Effect } from 'effect';
const owner = modelOwner({ busy: false, rows: [] });
export const load = (work) => owner.run('load', work.pipe(Effect.tap((rows) => Effect.sync(() => owner.patch({ rows }))), ${finalizer}), '${policy}');`;
  const reset = `Effect.ensuring(Effect.sync(() => owner.patch({ busy: false })))`;
  expect(codes(run('replace', reset))).toEqual(['EW1005']);
  expect(
    codes(
      run('replace', `Effect.onExit(() => Effect.sync(() => owner.edit('busy', () => false)))`),
    ),
  ).toEqual(['EW1005']);
  expect(codes(run('drop', reset))).toEqual([]);
  expect(codes(run('replace', `Effect.ensuring(Effect.sync(() => console.log('done')))`))).toEqual(
    [],
  );
});

it('reports a makeMount call whose Effect is discarded', () => {
  const app = (body: string) =>
    `import { makeMount, view } from 'effectweb'; import { Effect } from 'effect';
const App = view(() => <p />);
${body}`;
  expect(codes(app(`makeMount(document.body, App, {});`))).toEqual(['EW1006']);
  expect(codes(app(`void makeMount(document.body, App, {});`))).toEqual(['EW1006']);
  expect(
    codes(app(`Promise.resolve().then(() => { makeMount(document.body, App, {}); });`)),
  ).toEqual(['EW1006']);
  expect(
    codes(
      app(
        `export const main = Effect.gen(function* () { yield* makeMount(document.body, App, {}); });`,
      ),
    ),
  ).toEqual([]);
  expect(codes(app(`export const mounting = makeMount(document.body, App, {});`))).toEqual([]);
});

it('follows immutable Effects, local wrappers and imported Effect aliases in replace finalizers', () => {
  const prelude = `import { modelOwner } from 'effectweb'; import { Effect as Fx } from 'effect';
const owner = modelOwner({ busy: false });`;
  const work = `Fx.void.pipe(Fx.ensuring(Fx.sync(() => owner.patch({ busy: false }))))`;
  for (const source of [
    `const work = ${work}; owner.run('load', work, 'replace');`,
    `const run = (work) => owner.run('load', work, 'replace'); run(${work});`,
    `function run(work, policy) { return owner.run('load', work, policy); } run(${work}, 'replace');`,
    `const build = () => ${work}; owner.run('load', build(), 'replace');`,
    `const reset = () => owner.patch({ busy: false }); owner.run('load', Fx.void.pipe(Fx.ensuring(Fx.sync(reset))), 'replace');`,
    `owner.task('result', ${work}, 'replace');`,
    `function reset() { owner.patch({ busy: false }); } owner.run('load', Fx.ensuring(Fx.void, Fx.sync(reset)), 'replace');`,
    `function run(work) { return owner.run('load', work, 'replace'); } const start = run; start(${work});`,
  ])
    expect(codes(prelude + source)).toEqual(['EW1005']);
});

it('recognizes Effect namespace and named finalizer imports', () => {
  for (const [imports, work] of [
    [
      `import * as Fx from 'effect/Effect';`,
      `Fx.ensuring(Fx.void, Fx.sync(() => owner.patch({ busy: false })))`,
    ],
    [
      `import { ensuring as finish, sync, void as unit } from 'effect/Effect';`,
      `finish(unit, sync(() => owner.patch({ busy: false })))`,
    ],
  ])
    expect(
      codes(`import { modelOwner } from 'effectweb'; ${imports}
const owner = modelOwner({ busy: false }); owner.run('load', ${work}, 'replace');`),
    ).toEqual(['EW1005']);
});

it('keeps safe writes, lexical shadowing and other concurrency policies out of EW1005', () => {
  const prelude = `import { modelOwner } from 'effectweb'; import { Effect } from 'effect';
const owner = modelOwner({ busy: false });`;
  for (const source of [
    `const run = (work, policy) => owner.run('load', work, policy); run(Effect.ensuring(Effect.void, Effect.sync(() => owner.patch({ busy: false }))), 'drop');`,
    `owner.run('load', Effect.ensuring(Effect.sync(() => owner.patch({ busy: false })), Effect.void), 'replace');`,
    `function build(Effect) { return owner.run('load', Effect.ensuring(Effect.sync(() => owner.patch({ busy: false }))), 'replace'); }`,
    `const work = Effect.ensuring(Effect.void, Effect.sync(() => owner.patch({ busy: false }))); function safe() { const work = Effect.void; owner.run('load', work, 'replace'); }`,
    `const work = Effect.ensuring(Effect.void, Effect.sync(() => owner.patch({ busy: false }))); function safe(run) { run(work); }`,
    `const run = (work) => owner.run('load', work, 'drop'); const replace = (work) => owner.run('other', work, 'replace'); run(Effect.ensuring(Effect.void, Effect.sync(() => owner.patch({ busy: false })))); replace(Effect.void);`,
    `const recursive = () => recursive(); owner.run('load', recursive(), 'replace');`,
  ])
    expect(codes(prelude + source)).toEqual([]);
});

it('does not mistake a receiver configuration for the work being run', () => {
  expect(
    codes(`import { modelOwner } from 'effectweb'; import { Effect } from 'effect';
const owner = modelOwner({ busy: false });
const form = makeForm({ onSubmit: () => Effect.void.pipe(Effect.ensuring(Effect.sync(() => owner.patch({busy:false})))) });
owner.run('load', Effect.sync(() => form.reset({})), 'replace');`),
  ).toEqual([]);
});
