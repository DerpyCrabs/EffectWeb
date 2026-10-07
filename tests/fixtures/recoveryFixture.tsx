import { controllerView } from 'effectweb';
import { Cause, Effect } from 'effect';
import {
  component,
  program,
  domMount,
  errorBoundary,
  modelOwner,
  mount,
  Portal,
  view,
  type DomMount,
  type JSX,
  type Send,
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

const Nested = component<{ label: string }, { draft: string }>(
  { init: (props) => ({ draft: props.label }) },
  view((model, patch) => (
    <input
      data-draft
      value={model.draft}
      onInput={(event) => patch({ draft: event.currentTarget.value })}
    />
  )),
);
const EditorContent = view<{ model: Model; send: Send<Patch> }>(({ model, send }) => (
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
const EditorView = view<Model, Patch>((model, send) => <EditorContent model={model} send={send} />);

export function mountIdentityFixture(
  parent: HTMLElement,
  kind: 'component' | 'local' | 'controller' | 'owner',
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
  const key = 'owned';
  const OwnerEditor = component<Props, State>({ identity, init }, (owner) =>
    view((model, patch) => (
      <EditorContent
        model={model}
        send={(fields) => {
          patch(fields);
          owner.run(
            'Work',
            Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  events.push(`cancel:${model.props.id}`);
                }),
              ),
            ),
            'replace',
          );
        }}
      />
    )),
  );
  const Editor =
    kind === 'owner'
      ? OwnerEditor
      : kind === 'local'
        ? component<Props, State>({ identity, init }, EditorView)
        : kind === 'component'
          ? component<Props, State, Patch>(
              {
                identity,
                init,
                receive: (model) => {
                  events.push(`receive:${model.props.id}`);
                  return { model };
                },
                update: (model, patch) => ({
                  model: { ...model, ...patch },
                  commands: [
                    {
                      key,
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
              },
              EditorView,
            )
          : controllerView(
              {
                identity,
                controller: (props) => {
                  const source = program<Model, Partial<Model>>({
                    initial: { ...init(props), props },
                    update: (model, patch) => ({ model: { ...model, ...patch } }),
                  });
                  sources.push(source);
                  return {
                    source,
                    patch: source.send,
                    receive: (next) => {
                      events.push(`receive:${source.model().props.id}:${next.id}`);
                      source.send({ props: next as Props });
                    },
                    lifetime: source,
                  };
                },
              },
              view((model) => <EditorContent model={model} send={model.actions.patch} />),
            );
  const owner = modelOwner<Props>({ id: 'a', label: 'first' });
  const unmount = mount(parent, Editor, owner.source);
  return {
    update: owner.patch,
    events: () => [...events],
    oldSend: () => sources[0]?.send({ count: 99 }),
    close: async () => {
      await Effect.runPromise(unmount.close());
      await Effect.runPromise(owner.close());
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
type Recovery = { model: RecoveryModel; send: Send<RecoveryMessage> };
const Content = view<Recovery>(({ model }) => (
  <section data-content use={model.host}>
    <span data-value>{checked(model.broken, model.label)}</span>
    <Portal>
      <b data-recovery-portal>{model.label}</b>
    </Portal>
  </section>
));
const Fallback = view<{ model: Recovery; error: unknown }>((state) => (
  <button
    data-fallback
    use={state.model.model.fallbackHost}
    onClick={() => state.model.send('Retry')}
  >
    {checked(state.model.model.fallbackBroken, `Failed:${state.model.model.label}`)}
  </button>
));
const OuterFallback = view<{ model: Recovery; error: unknown }>((state) => (
  <aside data-outer>Outer:{state.model.model.label}</aside>
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
    reset: (state) => state.model.reset,
    onError: (error) => {
      errors.push(String(error));
    },
  });
  const Outer = nested
    ? errorBoundary(Safe, {
        fallback: OuterFallback,
        reset: (state) => state.model.reset,
        onError: (error) => {
          outerErrors.push(String(error));
        },
      })
    : Safe;
  const Root = view<RecoveryModel, RecoveryMessage>((model, send) => (
    <main>
      <output data-sibling>{model.label}</output>
      <Outer model={model} send={send} />
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
  const unmount = mount(parent, Root, source, {
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
      await Effect.runPromise(unmount.close());
      await Effect.runPromise(source.close());
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
  const Faulty = component<{ host: DomMount }, {}, 'Break'>(
    {
      init: () => ({}),
      update: (model) => {
        if (kind === 'event') throw new Error('event failed');
        return {
          model,
          commands: [{ key: 'defect', policy: 'replace', effect: Effect.die('command failed') }],
        };
      },
    },
    view((model, send) => (
      <button data-defect use={model.props.host} onClick={() => send('Break')}>
        Break
      </button>
    )),
  );
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
  const stop = mount(parent, Safe, owner.source);
  return {
    state: () => ({ errors, events }),
    close: async () => {
      await Effect.runPromise(stop.close());
      await Effect.runPromise(owner.close());
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
  const Child = controllerView(
    {
      controller: (props: Snapshot<Props>) => {
        const source = program<Props, never>({ initial: props, update: (model) => ({ model }) });
        return {
          source,
          lifetime: {
            dispose: source.dispose,
            close: () =>
              Effect.gen(function* () {
                yield* source.close();
                if (props.id === 'a') {
                  yield* Effect.promise(() => gate);
                  return yield* Effect.fail(new Error('old cleanup'));
                }
              }),
          },
        };
      },
    },
    view((model) => <span data-stale-content>{model.id}</span>),
  );
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
  const stop = mount(host, Safe, owner.source);
  owner.patch({ id: 'b' });
  release();
  await rejection;
  await Promise.resolve();
  const result = {
    errors,
    content: host.querySelector('[data-stale-content]')?.textContent,
    fallback: Boolean(host.querySelector('[data-stale-fallback]')),
  };
  await Effect.runPromise(stop.close());
  await Effect.runPromise(owner.close());
  host.remove();
  return result;
}

export async function lazyCloseFixture() {
  const { lazyView } = await import('effectweb/advanced');
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
  const stop = mount(host, Lazy, source.source);
  let closed = false;
  const closing = Effect.runPromise(stop.close()).then(() => {
    closed = true;
  });
  await Promise.resolve();
  const waiting = !closed;
  release();
  await closing;
  await Effect.runPromise(source.close());
  host.remove();
  return { waiting, finalized };
}

export async function lazyFinalizerFailureFixture() {
  const { lazyView } = await import('effectweb/advanced');
  const host = document.createElement('div');
  const errors: string[] = [];
  const Lazy = lazyView<Props>(() =>
    Effect.never.pipe(Effect.ensuring(Effect.die(new Error('lazy cleanup failed')))),
  );
  const source = modelOwner<Props>({ id: 'a', label: 'first' });
  const stop = mount(host, Lazy, source.source, {
    onError: (cause) => {
      errors.push(String(Cause.squash(cause as Cause.Cause<unknown>)));
    },
  });
  await Effect.runPromise(stop.close());
  await Effect.runPromise(source.close());
  return { errors, children: host.childNodes.length };
}

export async function slotBoundaryFixture() {
  const host = document.createElement('div');
  document.body.append(host);
  const errors: string[] = [];
  const unhandled: string[] = [];
  const Shell = view<{ content: () => JSX.Element }>((model) => (
    <section data-slot-content>{model.content()}</section>
  ));
  const Failure = view<{ model: { content: () => JSX.Element }; error: unknown }>(() => (
    <aside data-slot-fallback>Failed</aside>
  ));
  const Safe = errorBoundary(Shell, {
    fallback: Failure,
    onError: (error) => {
      errors.push(String(error));
    },
  });
  const Root = view<{ broken: boolean }>((model) => (
    <Safe content={() => <span>{checked(model.broken, 'slot failed')}</span>} />
  ));
  const owner = modelOwner({ broken: false });
  const stop = mount(host, Root, owner.source, {
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
  await Effect.runPromise(stop.close());
  await Effect.runPromise(owner.close());
  host.remove();
  return result;
}
