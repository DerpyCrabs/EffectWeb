import { Context, Effect, Exit, Scope, SubscriptionRef } from 'effect';
import {
  available,
  commandSlot,
  component,
  defineTasks,
  effectCommand,
  lazyView,
  resourceComponent,
  collection,
  list,
  ViewBinding,
  fromSubscriptionRef,
  listView,
  makeDomMount,
  makeEffectHandler,
  makeProgram,
  mapSource,
  mount,
  observe,
  view,
} from 'effectweb';

export async function mountScopedRendering(parent: HTMLElement, optimized = true) {
  const lifetime = Scope.makeUnsafe();
  let evaluations = 0;
  const rows = collection<{ readonly id: number; readonly label: string }>((row) => row.id);
  type Row = { readonly id: number; readonly label: string };
  type Props = { readonly row: Row; readonly selected: boolean };
  type Message = { readonly type: 'select'; readonly id: number };
  const RowView = view<Props, Message>((props, send) => {
    evaluations++;
    return (
      <button
        class={props.selected ? 'selected' : ''}
        data-id={props.row.id}
        onClick={() => send({ type: 'select', id: props.row.id })}
      >
        {props.row.label}
      </button>
    );
  });
  const renderRows = listView({
    project: (row: Row, _index: number, selected: number): Props => ({
      row,
      selected: row.id === selected,
    }),
    view: RowView,
    equals: (previous, next) => previous.row === next.row && previous.selected === next.selected,
  });
  return await Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* makeProgram({
        initial: {
          rows: Array.from({ length: 1000 }, (_, id) => ({ id, label: `row ${id}` })),
          selected: 0,
        },
        update: (model, message: Message) => ({ model: { ...model, selected: message.id } }),
      });
      const App = view<{ rows: readonly Row[]; selected: number }, Message>((model, send) => (
        <section>
          {optimized
            ? renderRows(rows.from(model.rows), model.selected, send)
            : list(rows.from(model.rows), (row) => (
                <ViewBinding
                  view={RowView}
                  model={{ row, selected: row.id === model.selected }}
                  send={send}
                />
              ))}
        </section>
      ));
      yield* mount(parent, App, source);
      return {
        send: source.send,
        evaluations: () => evaluations,
        close: () => Effect.runPromise(Scope.close(lifetime, Exit.void)),
      };
    }).pipe(Scope.provide(lifetime)),
  );
}

class Label extends Context.Service<Label, { readonly value: string }>()('fixture/Label') {}
export async function mountEffectSetup(parent: HTMLElement) {
  const lifetime = Scope.makeUnsafe();
  const releases: string[] = [];
  return await Effect.runPromise(
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make({ count: 0, unrelated: 0 });
      const source = yield* fromSubscriptionRef(ref);
      const selected = mapSource(source, (model) => model.count);
      let projections = 0;
      const App = Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            releases.push('view');
          }),
        );
        const click = yield* makeEffectHandler(() =>
          Effect.gen(function* () {
            const label = yield* Label;
            yield* SubscriptionRef.update(ref, (model) => ({
              ...model,
              count: model.count + label.value.length,
            }));
          }),
        );
        const binding = yield* makeDomMount((_element: HTMLButtonElement) =>
          Effect.acquireRelease(Effect.void, () =>
            Effect.sync(() => {
              releases.push('dom');
            }),
          ),
        );
        return view<{}>(() => (
          <button use={binding} onClick={() => click()}>
            {observe(selected, (count) => {
              projections++;
              return count;
            })}
          </button>
        ));
      });
      const staticSource = { model: () => ({}), subscribe: () => () => {} };
      const mounted = yield* mount(parent, App, staticSource);
      return {
        updateUnrelated: () =>
          Effect.runPromise(
            SubscriptionRef.update(ref, (model) => ({ ...model, unrelated: model.unrelated + 1 })),
          ),
        projections: () => projections,
        releases,
        closeMount: () => Effect.runPromise(mounted.close()),
        close: () => Effect.runPromise(Scope.close(lifetime, Exit.void)),
      };
    }).pipe(Effect.provideService(Label, { value: 'label' }), Scope.provide(lifetime)),
  );
}

const ambient = Context.Reference('fixture/ambient', { defaultValue: () => 'default' });
const readSlot = commandSlot('ambient');
const AmbientComponent = component<{}, { props: {}; label: string }, 'read' | { label: string }>({
  init: (props) => ({ props, label: '' }),
  update: (model, message) =>
    typeof message === 'string'
      ? {
          model,
          commands: [
            effectCommand(readSlot, () => ambient, {
              policy: 'replace',
              onSuccess: (label) => ({ label }),
              onFailure: () => ({ label: 'failure' }),
            }),
          ],
        }
      : { model: { ...model, label: message.label } },
  view: view((model, send) => (
    <button id="ambient-component" onClick={() => send('read')}>
      {model.label}
    </button>
  )),
});
const AmbientResource = resourceComponent({
  request: (_props: {}) => ({ key: 'ambient', load: () => ambient }),
  view: view((model) => <span id="ambient-resource">{available(model.result)}</span>),
});
const ambientTasks = defineTasks({ init: (_props: {}) => ({}) }).tasks({
  read: { policy: 'replace', run: () => ambient },
});
const AmbientTask = ambientTasks.view(
  view((model, send) => (
    <button id="ambient-task" onClick={() => ambientTasks.controls(send).run('read', undefined)}>
      {available(model.tasks.read)}
    </button>
  )),
);
const AmbientLazy = lazyView(() =>
  Effect.map(ambient, (value) => view<{}>(() => <span id="ambient-lazy">{value}</span>)),
);
export async function mountInheritedContext(parent: HTMLElement) {
  const lifetime = Scope.makeUnsafe();
  await Effect.runPromise(
    mount(
      parent,
      view<{}>(() => (
        <>
          <AmbientComponent />
          <AmbientResource />
          <AmbientTask />
          <AmbientLazy />
        </>
      )),
      { model: () => ({}), subscribe: () => () => {} },
    ).pipe(Effect.provideService(ambient, 'application'), Scope.provide(lifetime)),
  );
  return () => Effect.runPromise(Scope.close(lifetime, Exit.void));
}

export async function checkObservationDisposal(parent: HTMLElement) {
  const lifetime = Scope.makeUnsafe();
  let released = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const owner = yield* makeProgram({
        initial: { show: true, replace: false },
        update: (model, patch: Partial<{ show: boolean; replace: boolean }>) => ({
          model: { ...model, ...patch },
        }),
      });
      const first = { model: () => 0, subscribe: () => () => {} };
      const second = {
        model: () => 1,
        subscribe: (_listener: (value: number) => void) => {
          owner.send({ show: false });
          return () => {
            released++;
          };
        },
      };
      yield* mount(
        parent,
        view<{ show: boolean; replace: boolean }>((model) =>
          model.show ? observe(model.replace ? second : first, (value) => value) : null,
        ),
        owner,
      );
      owner.send({ replace: true });
    }).pipe(Scope.provide(lifetime)),
  );
  const beforeClose = released;
  await Effect.runPromise(Scope.close(lifetime, Exit.void));
  return { beforeClose, afterClose: released };
}
