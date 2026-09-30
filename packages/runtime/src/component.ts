import { protectSnapshot, type Snapshot } from './snapshot.js';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type { View } from './dom.js';
import { compiled, Scope, viewRegion } from './dom.js';
import type { Program, Transition } from './program.js';
import type { Source } from './source.js';
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
  return identify(
    compiled<Props, never>((scope, parent, before) => {
      const ownerRuntime = scope.settlement.runtime ?? defaultUiRuntime;
      const runtime = definition.runtime ?? (ownerRuntime as UiRuntime<R>);
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
        runtime: ownerRuntime,
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

export interface ViewController<Props, Model, Actions extends object = {}> {
  readonly source: Source<Model>;
  /** Controller methods the view reads as `model.actions`; they never live in the model itself. */
  readonly actions?: Actions;
  /** New props from the parent; called after every publication that changes them. */
  readonly receive?: (props: Snapshot<Props>) => void;
  readonly dispose: () => void;
  /** Capture DOM state before the view is torn down. */
  readonly beforeDispose?: () => void;
  /** Teardown that waits for asynchronous finalizers; `dispose` is used when absent. */
  readonly close?: () => Effect.Effect<void, unknown>;
}
type RenderedModel<Model, Actions extends object> = [Actions] extends [never]
  ? Model
  : [keyof Actions] extends [never]
    ? Model
    : Model & { readonly actions: Actions };
/**
 * The model a `controllerView` view renders for a controller (or controller factory): its
 * source model plus `actions`. Use it to type views declared apart from the `controllerView`.
 */
export type ControllerModel<C> = (C extends (...args: never[]) => infer R ? R : C) extends {
  readonly source: Source<infer Model>;
  readonly actions?: infer Actions;
}
  ? [Actions] extends [object]
    ? RenderedModel<Model, Actions>
    : Model
  : never;
/**
 * A feature controller created from the view's props and disposed with the view. Use it when
 * a view needs a controller object (`modelOwner`, queries, subscriptions) rather than named
 * messages. Its `actions` reach the view as `model.actions`, so the model stays plain data.
 * `identity` recreates the controller when the entity changes.
 */
export function controllerView<
  Props,
  Model extends object,
  Actions extends object = {},
>(definition: {
  readonly identity?: (props: Snapshot<Props>) => unknown;
  readonly create: (
    props: Snapshot<Props>,
    runtime: UiRuntime<never>,
  ) => ViewController<Props, Model, Actions>;
  readonly view: View<RenderedModel<Model, NoInfer<Actions>>, never>;
}): View<Props, never> {
  type Rendered = RenderedModel<Model, Actions>;
  const controllers = new WeakMap<
    Program<Rendered, never>,
    ViewController<Props, Model, Actions>
  >();
  return programView<Props, Rendered, never>({
    ...(definition.identity ? { identity: definition.identity } : {}),
    create(props, runtime) {
      const controller = definition.create(props, runtime);
      const actions = controller.actions;
      let lastModel: Snapshot<Model> | undefined;
      let lastRendered: Snapshot<Rendered> | undefined;
      const rendered = (model: Snapshot<Model>): Snapshot<Rendered> => {
        if (!actions) return model as unknown as Snapshot<Rendered>;
        if (model !== lastModel) {
          lastModel = model;
          lastRendered = protectSnapshot({
            ...(model as object),
            actions,
          }) as unknown as Snapshot<Rendered>;
        }
        return lastRendered!;
      };
      const source: Program<Rendered, never> = {
        model: () => rendered(controller.source.model()),
        subscribe: (listener) => controller.source.subscribe((model) => listener(rendered(model))),
        send: () => {},
        dispose: controller.dispose,
        ...(controller.close ? { close: controller.close } : {}),
      };
      controllers.set(source, controller);
      return source;
    },
    receive(source, props) {
      controllers.get(source)?.receive?.(props);
    },
    beforeDispose(source) {
      controllers.get(source)?.beforeDispose?.();
    },
    view: definition.view,
  });
}

/** Mount an existing program without introducing a second state owner. */
export function programView<Props, Model, Message>(definition: {
  identity?: (props: Snapshot<Props>) => unknown;
  create: (
    props: Snapshot<Props>,
    runtime: UiRuntime<never>,
  ) => import('./program').Program<Model, Message>;
  receive: (source: import('./program').Program<Model, Message>, props: Snapshot<Props>) => void;
  /** Capture DOM state before child disposal, on unmount or identity replacement. */
  beforeDispose?: (source: import('./program').Program<Model, Message>) => void;
  view: View<Model, Message>;
}): View<Props, never> {
  return identify(
    compiled<Props, never>((scope, parent, before) => {
      const source = definition.create(
        scope.value as Snapshot<Props>,
        scope.settlement.runtime ?? defaultUiRuntime,
      );
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
        () => definition.beforeDispose?.(source),
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
      Effect.runFork(source.close()).addObserver((exit) => {
        finish();
        if (exit._tag === 'Failure') reportSafely(scope.report, Cause.squash(exit.cause));
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
