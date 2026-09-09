import { Effect } from 'effect';
import {
  component,
  slot,
  type Slot,
  defineTasks,
  localComponent,
  programView,
  program,
  domMount,
  errorBoundary,
  modelOwner,
  mountView,
  Portal,
  view,
  ViewBinding,
  commandSlot,
  type DomMount,
  type Snapshot,
} from 'effectweb';

interface Props {
  id: string;
  label: string;
}
interface State {
  count: number;
  host: DomMount;
}
interface Model extends State {
  props: Props;
}
type Patch = { count: number };

const Nested = localComponent<{ label: string }, { draft: string }>({
  init: (props) => ({ draft: props.label }),
  view: view((model, patch) => (
    <input
      data-draft
      value={model.draft}
      onInput={(event) => patch({ draft: event.currentTarget.value })}
    />
  )),
});
const EditorView = view<Model, Patch>((model, send) => (
  <section data-editor use={model.host}>
    <button data-increment onClick={() => send({ count: model.count + 1 })}>
      {model.props.id}:{model.props.label}:{model.count}
    </button>
    <Nested label={model.props.label} />
    <Portal>
      <span data-identity-portal>{model.props.id}</span>
    </Portal>
  </section>
));

export function mountIdentityFixture(
  parent: HTMLElement,
  kind: 'component' | 'local' | 'program' | 'tasks',
) {
  const events: string[] = [];
  const sources: Array<ReturnType<typeof program<Model, Partial<Model>>>> = [];
  const init = (props: Snapshot<Props>): State => ({
    count: 0,
    host: domMount(() => {
      events.push(`mount:${props.id}`);
      return () => {
        events.push(`dispose:${props.id}`);
      };
    }),
  });
  const identity = (props: Snapshot<Props>) => props.id;
  const slot = commandSlot('owned');
  const tasks = defineTasks({ identity, init }).tasks({
    Work: {
      policy: 'replace',
      run: (model) =>
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              events.push(`cancel:${model.props.id}`);
            }),
          ),
        ),
    },
  });
  const TaskEditor = tasks.view(
    view((model, send) => {
      const controls = tasks.controls(send);
      return (
        <ViewBinding
          view={EditorView}
          model={model}
          send={(patch) => {
            controls.patch(patch);
            controls.run('Work');
          }}
        />
      );
    }),
  );
  const Editor =
    kind === 'tasks'
      ? TaskEditor
      : kind === 'local'
        ? localComponent<Props, State>({ identity, init, view: EditorView })
        : kind === 'component'
          ? component<Props, Model, Patch>({
              identity,
              init: (props) => ({ ...init(props), props }),
              receive: (model, props) => {
                events.push(`receive:${model.props.id}:${props.id}`);
                return { model: { ...model, props } };
              },
              update: (model, patch) => ({
                model: { ...model, ...patch },
                commands: [
                  {
                    slot,
                    policy: 'replace',
                    effect: Effect.never.pipe(
                      Effect.ensuring(
                        Effect.sync(() => {
                          events.push(`cancel:${model.props.id}`);
                        }),
                      ),
                    ),
                  },
                ],
              }),
              view: EditorView,
            })
          : programView<Props, Model, Partial<Model>>({
              identity,
              create: (props) => {
                const source = program<Model, Partial<Model>>({
                  initial: { ...init(props), props },
                  update: (model, patch) => ({ model: { ...model, ...patch } }),
                });
                sources.push(source);
                return source;
              },
              receive: (source, props) => {
                events.push(`receive:${source.model().props.id}:${props.id}`);
                source.send({ props });
              },
              view: EditorView,
            });
  const owner = modelOwner<Props>({ id: 'a', label: 'first' });
  const unmount = mountView(parent, Editor, owner.source);
  return {
    update: owner.patch,
    events: () => [...events],
    oldSend: () => sources[0]?.send({ count: 99 }),
    close: async () => {
      await unmount.close();
      await owner.close();
    },
  };
}

interface RecoveryModel {
  broken: boolean;
  fallbackBroken: boolean;
  reset: number;
  label: string;
  host: DomMount;
  fallbackHost: DomMount;
}
type RecoveryMessage = 'Retry';
function checked(broken: boolean, label: string) {
  if (broken) throw new Error(label);
  return label;
}
const Content = view<RecoveryModel, RecoveryMessage>((model) => (
  <section data-content use={model.host}>
    <span data-value>{checked(model.broken, model.label)}</span>
    <Portal>
      <b data-recovery-portal>{model.label}</b>
    </Portal>
  </section>
));
const Fallback = view<{ model: RecoveryModel; error: unknown }, RecoveryMessage>((state, send) => (
  <button data-fallback use={state.model.fallbackHost} onClick={() => send('Retry')}>
    {checked(state.model.fallbackBroken, `Failed:${state.model.label}`)}
  </button>
));
const OuterFallback = view<{ model: RecoveryModel; error: unknown }, RecoveryMessage>((state) => (
  <aside data-outer>Outer:{state.model.label}</aside>
));

export function mountRecoveryFixture(parent: HTMLElement, initialBroken = false, nested = false) {
  const errors: string[] = [];
  const outerErrors: string[] = [];
  const unhandled: string[] = [];
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const host = domMount(() => {
    events.push('mount');
    return Effect.never.pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          events.push('closing');
          await gate;
          events.push('closed');
        }),
      ),
    );
  });
  const fallbackHost = domMount(() => {
    events.push('fallback-mount');
    return () => {
      events.push('fallback-dispose');
    };
  });
  const Safe = errorBoundary(Content, {
    fallback: Fallback,
    reset: (model) => model.reset,
    onError: (error) => {
      errors.push(String(error));
    },
  });
  const Outer = nested
    ? errorBoundary(Safe, {
        fallback: OuterFallback,
        reset: (model) => model.reset,
        onError: (error) => {
          outerErrors.push(String(error));
        },
      })
    : Safe;
  const Root = view<RecoveryModel, RecoveryMessage>((model, send) => (
    <main>
      <output data-sibling>{model.label}</output>
      <ViewBinding view={Outer} model={model} send={send} />
    </main>
  ));
  const source = program<RecoveryModel, RecoveryMessage | Partial<RecoveryModel>>({
    initial: {
      broken: initialBroken,
      fallbackBroken: false,
      reset: 0,
      label: 'first',
      host,
      fallbackHost,
    },
    update: (model, message) => ({
      model:
        message === 'Retry'
          ? { ...model, broken: false, fallbackBroken: false, reset: model.reset + 1 }
          : { ...model, ...message },
    }),
  });
  const unmount = mountView(parent, Root, source, {
    onError: (error) => {
      unhandled.push(String(error));
    },
  });
  let closed = false;
  return {
    update: (patch: Partial<RecoveryModel>) => source.send(patch),
    state: () => ({
      errors: [...errors],
      outerErrors: [...outerErrors],
      unhandled: [...unhandled],
      events: [...events],
      closed,
    }),
    release,
    close: async () => {
      await unmount.close();
      await source.close();
      closed = true;
    },
  };
}

export function mountDefectFixture(parent: HTMLElement, kind: 'host' | 'event' | 'command') {
  const errors: string[] = [];
  const events: string[] = [];
  const host = domMount(() => {
    if (kind === 'host') throw new Error('host failed');
    events.push('mount');
    return () => {
      events.push('dispose');
    };
  });
  const Faulty = component<{ host: DomMount }, { props: { host: DomMount } }, 'Break'>({
    init: (props) => ({ props }),
    update: (model) => {
      if (kind === 'event') throw new Error('event failed');
      return {
        model,
        commands: [
          { slot: commandSlot('defect'), policy: 'replace', effect: Effect.die('command failed') },
        ],
      };
    },
    view: view((model, send) => (
      <button data-defect use={model.props.host} onClick={() => send('Break')}>
        Break
      </button>
    )),
  });
  const Failure = view<{ model: { host: DomMount }; error: unknown }>(() => (
    <aside data-defect-fallback>Failed</aside>
  ));
  const Safe = errorBoundary(Faulty, {
    fallback: Failure,
    onError: (error) => {
      errors.push(String(error));
    },
  });
  const owner = modelOwner({ host });
  const stop = mountView(parent, Safe, owner.source);
  return {
    state: () => ({ errors, events }),
    close: async () => {
      await stop.close();
      await owner.close();
    },
  };
}

export async function staleBoundaryCleanupFixture() {
  const host = document.createElement('div');
  document.body.append(host);
  const errors: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let rejected!: () => void;
  const rejection = new Promise<void>((resolve) => {
    rejected = resolve;
  });
  const Child = programView<Props, Props, never>({
    create: (props) => {
      const source = program<Props, never>({ initial: props, update: (model) => ({ model }) });
      return {
        ...source,
        close: async () => {
          await source.close();
          if (props.id === 'a') {
            await gate;
            throw new Error('old cleanup');
          }
        },
      };
    },
    receive: () => {},
    view: view((model) => <span data-stale-content>{model.id}</span>),
  });
  const Failure = view<{ model: Props; error: unknown }>(() => (
    <span data-stale-fallback>Failed</span>
  ));
  const Safe = errorBoundary(Child, {
    fallback: Failure,
    reset: (props) => props.id,
    onError: (error) => {
      errors.push(String(error));
      rejected();
    },
  });
  const owner = modelOwner<Props>({ id: 'a', label: 'first' });
  const stop = mountView(host, Safe, owner.source);
  owner.patch({ id: 'b' });
  release();
  await rejection;
  await Promise.resolve();
  const result = {
    errors,
    content: host.querySelector('[data-stale-content]')?.textContent,
    fallback: Boolean(host.querySelector('[data-stale-fallback]')),
  };
  await stop.close();
  await owner.close();
  host.remove();
  return result;
}

export async function lazyCloseFixture() {
  const { lazyView } = await import('effectweb');
  const host = document.createElement('div');
  document.body.append(host);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finalized = false;
  const Lazy = lazyView<Props>(() =>
    Effect.never.pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          await gate;
          finalized = true;
        }),
      ),
    ),
  );
  const source = modelOwner<Props>({ id: 'a', label: 'first' });
  const stop = mountView(host, Lazy, source.source);
  let closed = false;
  const closing = stop.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  const waiting = !closed;
  release();
  await closing;
  await source.close();
  host.remove();
  return { waiting, finalized };
}

export async function slotBoundaryFixture() {
  const host = document.createElement('div');
  document.body.append(host);
  const errors: string[] = [];
  const unhandled: string[] = [];
  const Shell = view<{ content: Slot }>((model) => (
    <section data-slot-content>{model.content()}</section>
  ));
  const Failure = view<{ model: { content: Slot }; error: unknown }>(() => (
    <aside data-slot-fallback>Failed</aside>
  ));
  const Safe = errorBoundary(Shell, {
    fallback: Failure,
    onError: (error) => {
      errors.push(String(error));
    },
  });
  const Root = view<{ broken: boolean }>((model) => (
    <Safe
      content={slot(() => (
        <span>{checked(model.broken, 'slot failed')}</span>
      ))}
    />
  ));
  const owner = modelOwner({ broken: false });
  const stop = mountView(host, Root, owner.source, {
    onError: (error) => {
      unhandled.push(String(error));
    },
  });
  owner.patch({ broken: true });
  await Promise.resolve();
  const result = {
    errors,
    unhandled,
    failed: Boolean(host.querySelector('[data-slot-fallback]')),
    detached: !host.querySelector('[data-slot-content]'),
  };
  await stop.close();
  await owner.close();
  host.remove();
  return result;
}
