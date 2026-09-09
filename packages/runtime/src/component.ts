import type { Snapshot } from './snapshot.js';
import type { View } from './dom.js';
import { compiled, Scope, viewRegion } from './dom.js';
import type { Program, Transition } from './program.js';
import { mapCommand, program } from './program.js';
import { patchModel } from './state.js';
import { reportSafely } from './errors.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';

/** Local fields with no command lifecycle. Sends are shallow patches, never updater callbacks. */
export function localComponent<Props, State extends object>(definition: {
  identity?: (props: Snapshot<Props>) => unknown;
  init: (props: Snapshot<Props>) => (State | Snapshot<State>) & { readonly props?: never };
  view: View<
    State & { readonly props: Props },
    (Partial<State> | Partial<Snapshot<State>>) & { readonly props?: never }
  >;
}): View<Props, never> {
  return component<
    Props,
    State & { readonly props: Props },
    (Partial<State> | Partial<Snapshot<State>>) & { readonly props?: never }
  >({
    ...(definition.identity ? { identity: definition.identity } : {}),
    init: (props) =>
      ({ ...(definition.init(props) as State), props }) as State & { readonly props: Props },
    update: (model, patch) => {
      const next = patchModel<State>(model as State, patch as Partial<State>);
      return { model: next === model ? model : { ...next, props: model.props as Props } };
    },
    view: definition.view,
  });
}

/** A child model receives immutable parent inputs and owns its own message/command loop. */
export function component<Props, Model extends { readonly props: Props }, Message, R = never>(
  definition: {
    identity?: (props: Snapshot<Props>) => unknown;
    init: (props: Snapshot<Props>) => Model | Snapshot<Model>;
    receive?: (model: Snapshot<Model>, props: Snapshot<Props>) => Transition<Model, Message, R>;
    update: (model: Snapshot<Model>, message: Message) => Transition<Model, Message, R>;
    view: View<Model, Message>;
  } & ([R] extends [never] ? { runtime?: UiRuntime<R> } : { runtime: UiRuntime<R> }),
): View<Props, never> {
  const runtime = definition.runtime ?? (defaultUiRuntime as UiRuntime<R>);
  return identify(
    compiled<Props, never>((scope, parent, before) => {
      type Envelope = { type: 'Input'; props: Props } | { type: 'Message'; message: Message };
      const wrap = (next: Transition<Model, Message, R>): Transition<Model, Envelope> => ({
        model: next.model,
        ...(next.cancel ? { cancel: next.cancel } : {}),
        ...(next.commands
          ? {
              commands: next.commands.map((command) =>
                mapCommand(
                  runtime.command(command),
                  (message) => ({ type: 'Message', message }) as const,
                ),
              ),
            }
          : {}),
      });
      const source = program<Model, Envelope>({
        initial: definition.init(scope.value as Snapshot<Props>),
        onDefect: scope.report,
        update: (model, envelope) =>
          wrap(
            envelope.type === 'Input'
              ? (definition.receive?.(model, envelope.props as Snapshot<Props>) ?? {
                  model: Object.is(model.props, envelope.props)
                    ? model
                    : { ...model, props: envelope.props },
                })
              : definition.update(model, envelope.message),
          ),
      });
      if (scope.disposed) {
        closeProgram(scope, source);
        return;
      }
      const child = new Scope(
        source.model(),
        (message: Message) => source.send({ type: 'Message', message }),
        scope.report,
        scope.settlement,
      );
      let unsubscribe = () => {};
      scope.cleanups.push(
        () => closeProgram(scope, source),
        () => child.dispose(),
        () => unsubscribe(),
      );
      const release = source.subscribe((model) => child.set(model));
      if (scope.disposed) {
        release();
        return;
      }
      unsubscribe = release;
      definition.view.build(child as unknown as Scope<Model, Message>, parent, before);
      scope.jobs.push(() => source.send({ type: 'Input', props: scope.value }));
      source.send({ type: 'Input', props: scope.value });
    }),
    definition.identity,
  );
}

/** Mount an existing program without introducing a second state owner. */
export function programView<Props, Model, Message>(definition: {
  identity?: (props: Snapshot<Props>) => unknown;
  create: (props: Snapshot<Props>) => import('./program').Program<Model, Message>;
  receive: (source: import('./program').Program<Model, Message>, props: Snapshot<Props>) => void;
  view: View<Model, Message>;
}): View<Props, never> {
  return identify(
    compiled<Props, never>((scope, parent, before) => {
      const source = definition.create(scope.value as Snapshot<Props>);
      if (scope.disposed) {
        closeProgram(scope, source);
        return;
      }
      const child = new Scope(source.model(), source.send, scope.report, scope.settlement);
      let unsubscribe = () => {};
      scope.cleanups.push(
        () => closeProgram(scope, source),
        () => child.dispose(),
        () => unsubscribe(),
      );
      const release = source.subscribe((model) => child.set(model));
      if (scope.disposed) {
        release();
        return;
      }
      unsubscribe = release;
      definition.view.build(child as unknown as Scope<Model, Message>, parent, before);
      scope.jobs.push(() => definition.receive(source, scope.value as Snapshot<Props>));
    }),
    definition.identity,
  );
}

function closeProgram<M, E>(scope: Scope<unknown, never>, source: Program<M, E>) {
  const finish = scope.settlement.begin();
  try {
    if (source.close) {
      source.close().then(finish, (error: unknown) => {
        finish();
        reportSafely(scope.report, error);
      });
    } else {
      source.dispose();
      finish();
    }
  } catch (error) {
    finish();
    throw error;
  }
}

function identify<Props>(
  definition: View<Props, never>,
  identity?: (props: Snapshot<Props>) => unknown,
): View<Props, never> {
  if (!identity) return definition;
  return compiled((scope, parent, before) => {
    const render = viewRegion(scope, parent, before, { manual: true });
    let current: unknown;
    let active: View<Props, never> | undefined;
    const update = () => {
      const next = identity(scope.value as Snapshot<Props>);
      if (!active || !Object.is(current, next)) {
        current = next;
        active = compiled(definition.build);
      }
      render(active);
    };
    scope.jobs.push(update);
    update();
  });
}
