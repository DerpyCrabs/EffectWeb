import type { Snapshot } from './snapshot.js';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type { View } from './dom.js';
import { compiled, Scope as RenderScope, viewRegion } from './dom.js';
import type { OwnedTransition, Program, Send, Transition } from './program.js';
import type { Source } from './source.js';
import { createProgram, mapCommand } from './program.js';
import { controllerSource, type ControllerActions, type RenderedModel } from './controller.js';
export type { ControllerModel } from './controller.js';
import { reportSafely, type ReportError } from './errors.js';
import type * as Context from 'effect/Context';
import { defaultUiRuntime, uiRuntime, type UiRuntime } from './runtime.js';
import {
  createModelOwner,
  ownedTask,
  type ModelOwner,
  type RunWithDiscard,
  type RunPolicy,
} from './owner.js';
import type { RunKey } from './program.js';
import { patchModel } from './state.js';

/** The services a message component's commands require. Without it they run with the mount's. */
type Services<R> = [R] extends [never]
  ? { readonly context?: Context.Context<never> }
  : { readonly context: Context.Context<R> };
type Identity<Props> = { readonly identity?: (props: Snapshot<Props>) => unknown };
// An `init` without a parameter leaves Props uninferred; the view then sees `unknown` props.
type Known<Props> = [Props] extends [never] ? unknown : Props;
/** The model a component renders: its own state plus the parent's props, added by the runtime. */
type Placed<Props, State> = State & { readonly props: Known<Props> };
/** `init` returns the component's own state; a `props` field there is a mistake the type names. */
type OwnState<State> = (State | Snapshot<State>) & {
  readonly props?: 'Remove props from init: the runtime adds model.props';
};

declare const fieldsBrand: unique symbol;
/**
 * A shallow patch of a component's own fields; `props` is owned by the runtime. The brand lets
 * `ownerOf(patch)` recover the field types from the view's dispatcher.
 */
export type FieldsPatch<State> = (Partial<State> | Partial<Snapshot<State>>) & {
  readonly props?: never;
  readonly [fieldsBrand]?: (state: State) => void;
};
/** The owner behind a fields component: its fields, plus work owned by the placement. */
export interface ComponentOwner<State extends object> extends Pick<
  ModelOwner<State>,
  'read' | 'run' | 'task' | 'cancel' | 'isRunning' | 'awaitIdle'
> {
  readonly patch: Send<FieldsPatch<State>>;
}
// A fields component's `patch` maps to its state program and a work owner made on first use.
type FieldsInstance = {
  readonly source: Program<{ props: unknown }, FieldsMessage>;
  readonly work: () => ModelOwner<object>;
  readonly existing: () => ModelOwner<object> | undefined;
};
type FieldsMessage =
  | { readonly type: 'Fields'; readonly fields: Partial<object> }
  | { readonly type: 'Props'; readonly props: unknown };
const fieldsInstances = new WeakMap<object, FieldsInstance>();
const ownerViews = new WeakMap<object, ComponentOwner<object>>();
/**
 * The owner of the fields component whose `patch` this is. Its `run` and `task` work like a
 * `modelOwner`'s and are interrupted when the component unmounts or its identity changes:
 * `ownerOf(patch).task('saved', api.save(model.draft), 'drop')` publishes `model.saved`.
 */
export function ownerOf<State extends object>(
  patch: Send<FieldsPatch<State>>,
): ComponentOwner<State> {
  let made = ownerViews.get(patch);
  if (!made) {
    const instance = fieldsInstances.get(patch);
    if (!instance)
      throw new Error(
        'ownerOf(patch) needs the `patch` a fields component passes to its view: component({ init }, view((model, patch) => …)).',
      );
    const { source, work, existing } = instance;
    const read = () => source.model() as Record<string | number, unknown>;
    const write = (fields: Record<string | number, unknown>) =>
      source.send({ type: 'Fields', fields });
    let task: ReturnType<typeof ownedTask> | undefined;
    made = {
      read,
      patch: patch as Send<FieldsPatch<object>>,
      run: (key, effect, policy) => work().run(key, effect, policy),
      task: ((key: RunKey, effect: Effect.Effect<unknown, unknown, never>, policy: RunPolicy) =>
        (task ??= ownedTask(work().run as RunWithDiscard, read, write, () => work().disposed))(
          key,
          effect,
          policy,
        )) as unknown as ComponentOwner<object>['task'],
      cancel: (key) => existing()?.cancel(key),
      isRunning: (key) => existing()?.isRunning(key) ?? false,
      awaitIdle: (key) => existing()?.awaitIdle(key) ?? Effect.void,
    };
    ownerViews.set(patch, made);
  }
  return made as unknown as ComponentOwner<State>;
}

/**
 * A component owns local state for one placement. `init` returns that state; the runtime adds
 * the parent's props as `model.props` and keeps them current. Its definition comes first and
 * its view second, in one of two forms.
 *
 * - Fields: `component({ init }, view((model, patch) => …))`. The view's second argument
 *   patches fields; `ownerOf(patch)` runs owned Effects, and `ownerOf(patch).task(key, …)`
 *   publishes their `AsyncResult` in a field.
 * - Messages: `component({ init, update, receive? }, view((model, send) => …))`. `update` is a
 *   pure transition returning the next model and commands; `receive(model, previous)` runs
 *   when the props change, with the new props already in `model.props`.
 *
 * `identity` recreates the component when the entity behind the props changes.
 */
export function component<Props, State extends object, Message, R = never>(
  definition: Identity<Props> & {
    readonly init: (props: Snapshot<Props>) => OwnState<State>;
    readonly receive?: (
      model: Snapshot<Placed<Props, State>>,
      previous: Snapshot<Props>,
    ) => Transition<Placed<Props, State>, Message, R>;
    readonly update: (
      model: Snapshot<Placed<Props, State>>,
      message: Message,
    ) => Transition<Placed<Props, State>, Message, R>;
  } & Services<R>,
  view: View<Placed<Props, State>, Message>,
): View<Props, never>;
export function component<Props, State extends object>(
  definition: Identity<Props> & { readonly init: (props: Snapshot<Props>) => OwnState<State> },
  view: View<Placed<Props, State>, FieldsPatch<State>>,
): View<Props, never>;
export function component(definition: object, view: unknown): View<unknown, never> {
  const shape = definition as {
    readonly identity?: (props: Snapshot<unknown>) => unknown;
    readonly init: (props: never) => object;
    readonly update?: unknown;
  };
  const rendered = view as View<never, never>;
  if (shape.update) return messageComponent(shape as never, rendered);
  return fieldsComponent(shape as never, rendered as never);
}

function fieldsComponent(
  definition: Identity<unknown> & { readonly init: (props: Snapshot<unknown>) => object },
  view: View<{ readonly props: unknown }, Partial<object>>,
): View<unknown, never> {
  type Model = { props: unknown };
  return programView<unknown, Model, Partial<object>>({
    ...(definition.identity ? { identity: definition.identity } : {}),
    create(props, runtime, report) {
      const source = createProgram<Model, FieldsMessage>({
        initial: { ...definition.init(props), props },
        onDefect: report,
        runtime,
        update: (model, message) => {
          if (message.type === 'Props')
            return {
              model: Object.is(model.props, message.props)
                ? model
                : { ...model, props: message.props },
            };
          // `props` belongs to the runtime; a patch that names it changes only the other fields.
          const { props: _props, ...fields } = message.fields as Partial<Model>;
          return { model: patchModel(model, fields as Partial<Model>) };
        },
      });
      let owner: ModelOwner<object> | undefined;
      let closed = false;
      const work = () => {
        if (!owner) {
          owner = createModelOwner<object, never>({}, { runtime, onDefect: report });
          if (closed) owner.dispose();
        }
        return owner;
      };
      const patch = (fields: Partial<object>) => source.send({ type: 'Fields', fields });
      fieldsInstances.set(patch, { source, work, existing: () => owner });
      return {
        model: source.model,
        subscribe: source.subscribe,
        send: patch,
        dispose: () => {
          closed = true;
          owner?.dispose();
          source.dispose();
        },
        close: () =>
          Effect.suspend(() => {
            closed = true;
            return owner ? owner.close() : Effect.void;
          }).pipe(Effect.ensuring(source.close())),
      };
    },
    receive(source, props) {
      fieldsInstances.get(source.send)?.source.send({ type: 'Props', props });
    },
    view,
  });
}

function messageComponent<Props, Model extends { readonly props: Props }, Message, R>(
  definition: Identity<Props> & {
    readonly init: (props: Snapshot<Props>) => Model | Snapshot<Model>;
    readonly receive?: (
      model: Snapshot<Model>,
      previous: Snapshot<Props>,
    ) => Transition<Model, Message, R>;
    readonly update: (model: Snapshot<Model>, message: Message) => Transition<Model, Message, R>;
    readonly context?: Context.Context<R>;
  },
  view: View<Model, Message>,
): View<Props, never> {
  const services = definition.context ? uiRuntime(definition.context) : undefined;
  return identify(
    compiled<Props, never>((scope, parent, before) => {
      const ownerRuntime = scope.settlement.runtime ?? defaultUiRuntime;
      const runtime = services ?? (ownerRuntime as UiRuntime<R>);
      type Envelope = { type: 'Input'; props: Props } | { type: 'Message'; message: Message };
      const wrap = (next: Transition<Model, Message, R>): OwnedTransition<Model, Envelope> => ({
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
      const source = createProgram<Model, Envelope>({
        initial: {
          ...definition.init(scope.value as Snapshot<Props>),
          props: scope.value,
        } as Model,
        onDefect: scope.report,
        runtime: ownerRuntime,
        update: (model, envelope) => {
          if (envelope.type === 'Message') return wrap(definition.update(model, envelope.message));
          if (Object.is(model.props, envelope.props)) return { model };
          const next = { ...model, props: envelope.props } as Snapshot<Model>;
          return wrap(
            definition.receive?.(next, model.props as Snapshot<Props>) ?? { model: next },
          );
        },
      });
      if (scope.disposed) {
        closeProgram(scope, source);
        return;
      }
      const child = new RenderScope(
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
      const range = view.build(child as unknown as RenderScope<Model, Message>, parent, before);
      scope.jobs.push(() => source.send({ type: 'Input', props: scope.value }));
      source.send({ type: 'Input', props: scope.value });
      return range;
    }),
    definition.identity,
  );
}

/**
 * A controller: an object publishing a model through `source` and released by `dispose`.
 * Everything else it returns reaches the view as `model.actions`, usually methods the view
 * calls as `model.actions.name(…)`; the lifecycle members below are not actions.
 */
export interface ViewController<Props, Model> {
  readonly source: Source<Model>;
  /** New props from the parent; called after every publication that changes them. */
  readonly receive?: (props: Snapshot<Props>) => void;
  readonly dispose: () => void;
  /** Capture DOM state before the view is torn down. */
  readonly beforeDispose?: () => void;
  /**
   * Teardown that waits for asynchronous finalizers. When the controller's `dispose` is its
   * source's own (`dispose: owner.dispose` with `source: owner.source`), the source's `close`
   * is used, so a model owner's async cleanup is joined without listing it.
   */
  readonly close?: () => Effect.Effect<void, unknown>;
}
/**
 * A controller created from the view's props and released with the view. Use it when a view
 * needs a controller object (`modelOwner`, queries, subscriptions) rather than named messages.
 * The controller is a plain object of the same shape as one passed to `mount`; its functions
 * reach the view as `model.actions`, so the model stays plain data. `identity` recreates the
 * controller when the entity changes.
 */
export function controllerView<Props, Model extends object, Controller extends object>(
  definition: Identity<Props> & {
    readonly init?: never;
    readonly update?: never;
    readonly controller: (
      props: Snapshot<Props>,
    ) => Controller &
      ViewController<Props, Model> & {
        readonly actions?: 'Return actions directly: { source, save, dispose }; they reach the view as model.actions';
      };
  },
  view: View<RenderedModel<Model, ControllerActions<NoInfer<Controller>>>, never>,
): View<Props, never> {
  type Rendered = RenderedModel<Model, ControllerActions<Controller>>;
  const controllers = new WeakMap<Program<Rendered, never>, ViewController<Props, Model>>();
  return programView<Props, Rendered, never>({
    ...(definition.identity ? { identity: definition.identity } : {}),
    create(props) {
      const controller = definition.controller(props);
      const published = controller.source as unknown as Partial<Program<object, never>>;
      // `dispose: owner.dispose` hands the source's whole teardown over, including its async close.
      const close =
        controller.close ??
        (controller.dispose === published.dispose ? published.close : undefined);
      const rendered = controllerSource(
        controller as unknown as { readonly source: Source<object> },
      ) as unknown as Source<Rendered>;
      const source: Program<Rendered, never> = {
        model: rendered.model,
        subscribe: rendered.subscribe,
        send: () => {},
        dispose: controller.dispose,
        ...(close ? { close } : {}),
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
    view: view as View<Rendered, never>,
  });
}

/** Mount an existing program without introducing a second state owner. Internal. */
export function programView<Props, Model, Message>(definition: {
  identity?: (props: Snapshot<Props>) => unknown;
  create: (
    props: Snapshot<Props>,
    runtime: UiRuntime<never>,
    report: ReportError,
  ) => Program<Model, Message>;
  receive: (source: Program<Model, Message>, props: Snapshot<Props>) => void;
  /** Capture DOM state before child disposal, on unmount or identity replacement. */
  beforeDispose?: (source: Program<Model, Message>) => void;
  view: View<Model, Message>;
}): View<Props, never> {
  return identify(
    compiled<Props, never>((scope, parent, before) => {
      const source = definition.create(
        scope.value as Snapshot<Props>,
        scope.settlement.runtime ?? defaultUiRuntime,
        scope.report,
      );
      if (scope.disposed) {
        closeProgram(scope, source);
        return;
      }
      const child = new RenderScope(source.model(), source.send, scope.report, scope.settlement);
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
      const range = definition.view.build(
        child as unknown as RenderScope<Model, Message>,
        parent,
        before,
      );
      scope.jobs.push(() => definition.receive(source, scope.value as Snapshot<Props>));
      return range;
    }),
    definition.identity,
  );
}

function closeProgram<M, E>(scope: RenderScope<unknown, never>, source: Program<M, E>) {
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
