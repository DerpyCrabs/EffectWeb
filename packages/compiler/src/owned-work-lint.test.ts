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
