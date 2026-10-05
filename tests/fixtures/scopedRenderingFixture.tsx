import { Context, Effect, Exit, Scope } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import {
  available,
  component,
  ownerOf,
  collection,
  list,
  ViewBinding,
  program,
  makeMount,
  observe,
  view,
} from 'effectweb';
import { lazyView } from 'effectweb/advanced';

export async function mountScopedRendering(parent: HTMLElement) {
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
  return await Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.acquireRelease(
        Effect.sync(() =>
          program({
            initial: {
              rows: Array.from({ length: 1000 }, (_, id) => ({ id, label: `row ${id}` })),
              selected: 0,
            },
            update: (model, message: Message) => ({ model: { ...model, selected: message.id } }),
          }),
        ),
        (running) => running.close(),
      );
      const App = view<{ rows: readonly Row[]; selected: number }, Message>((model, send) => (
        <section>
          {list(rows.from(model.rows), (row) => (
            <ViewBinding
              view={RowView}
              model={{ row, selected: row.id === model.selected }}
              send={send}
            />
          ))}
        </section>
      ));
      yield* makeMount(parent, App, source);
      return {
        send: source.send,
        evaluations: () => evaluations,
        close: () => Effect.runPromise(Scope.close(lifetime, Exit.void)),
      };
    }).pipe(Scope.provide(lifetime)),
  );
}

const ambient = Context.Reference('fixture/ambient', { defaultValue: () => 'default' });
const readSlot = 'ambient';
const AmbientComponent = component<{}, { label: string }, 'read' | { label: string }>(
  {
    init: () => ({ label: '' }),
    update: (model, message) =>
      typeof message === 'string'
        ? {
            model,
            commands: [
              {
                key: readSlot,
                policy: 'replace',
                effect: ambient.pipe(
                  Effect.matchCause({
                    onSuccess: (label) => ({ label }),
                    onFailure: () => ({ label: 'failure' }),
                  }),
                ),
              },
            ],
          }
        : { model: { ...model, label: message.label } },
  },
  view((model, send) => (
    <button id="ambient-component" onClick={() => send('read')}>
      {model.label}
    </button>
  )),
);
const AmbientTask = component(
  {
    init: (_props: {}) => ({
      read: AsyncResult.initial() as AsyncResult.AsyncResult<string, never>,
    }),
  },
  view((model, patch) => (
    <button id="ambient-task" onClick={() => ownerOf(patch).task('read', ambient, 'replace')}>
      {available(model.read)}
    </button>
  )),
);
const AmbientLazy = lazyView(() =>
  Effect.map(ambient, (value) => view<{}>(() => <span id="ambient-lazy">{value}</span>)),
);
export async function mountInheritedContext(parent: HTMLElement) {
  const lifetime = Scope.makeUnsafe();
  await Effect.runPromise(
    makeMount(
      parent,
      view<{}>(() => (
        <>
          <AmbientComponent />
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
      const owner = yield* Effect.acquireRelease(
        Effect.sync(() =>
          program({
            initial: { show: true, replace: false },
            update: (model, patch: Partial<{ show: boolean; replace: boolean }>) => ({
              model: { ...model, ...patch },
            }),
          }),
        ),
        (running) => running.close(),
      );
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
      yield* makeMount(
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
