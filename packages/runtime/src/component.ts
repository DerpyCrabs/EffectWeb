import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type { View } from './dom.js';
import { compiled, Scope as RenderScope, viewRegion } from './dom.js';
import type { OwnedTransition, Program, Send, Transition } from './program.js';
import type { Source } from './source.js';
import { createProgram, mapCommand } from './program.js';
import { controllerSource, type ControllerActions, type RenderedModel } from './controller.js';
import type { ModelFields } from './owner.js';
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
type Identity<Props> = { readonly identity?: (props: Props) => unknown };
// An `init` without a parameter leaves Props uninferred; the view then sees `unknown` props.
type Known<Props> = [Props] extends [never] ? unknown : Props;
/** The model a component renders: its own state plus the parent's props, added by the runtime. */
type Placed<Props, State> = State & { readonly props: Known<Props> };
/** `init` returns the component's own state; a `props` field there is a mistake the type names. */
type OwnState<State> = State & {
  readonly props?: 'Remove props from init: the runtime adds model.props';
};
/** The model a component publishes for the state `init` returns; result fields hold every outcome. */
type Published<State> = ModelFields<NoInfer<State>>;

/** A shallow patch of a component's own fields; `props` belongs to the runtime. */
export type FieldsPatch<State> = Partial<State> & { readonly props?: never };
/** The owner behind a fields component: its fields, plus work owned by the placement. */
export interface ComponentOwner<State extends object> extends Pick<
  ModelOwner<State>,
  'read' | 'run' | 'task' | 'cancel' | 'awaitIdle' | 'own' | 'disposed'
> {
  readonly patch: Send<FieldsPatch<State>>;
}
type FieldsMessage =
  | { readonly type: 'Fields'; readonly fields: Partial<object> }
  | { readonly type: 'Props'; readonly props: unknown };

/**
 * A component owns local state for one placement. `init` returns that state; the runtime adds
 * the parent's props as `model.props` and keeps them current. Its definition comes first and
 * its view second.
 *
 * - Fields: `component({ init }, view((model, patch) => …))`. The view's second argument
 *   patches fields. Pass `owner => view(…)` to acquire explicit state and task authority
 *   once per placement; `owner.task(key, …)` publishes its `AsyncResult` in a field.
 * - Messages: `component({ init, update, receive? }, view((model, send) => …))`. `update` is a
 *   pure transition returning the next model and commands; `receive(model, previous)` runs
 *   when the props change, with the new props already in `model.props`.
 *
 * `identity` recreates the component when the entity behind the props changes.
 */
export function component<Props, State extends object, Message, R = never>(
  definition: Identity<Props> & {
    readonly init: (props: Props) => OwnState<State>;
    // `State` comes from `init` alone: NoInfer keeps a wider `update` parameter type from widening it.
    readonly receive?: (
      model: Placed<Props, Published<State>>,
      previous: Props,
    ) => Transition<Placed<Props, Published<State>>, Message, R>;
    readonly update: (
      model: Placed<Props, Published<State>>,
      message: Message,
    ) => Transition<Placed<Props, Published<State>>, Message, R>;
  } & Services<R>,
  view: View<Placed<Props, Published<State>>, Message>,
): View<Props, never>;
export function component<Props, State extends object>(
  definition: Identity<Props> & {
    readonly init: (props: Props) => OwnState<State>;
    readonly update?: never;
  },
  view: Pick<View<Placed<Props, Published<State>>, FieldsPatch<Published<State>>>, 'build'>,
): View<Props, never>;
export function component<Props, State extends object>(
  definition: Identity<Props> & {
    readonly init: (props: Props) => OwnState<State>;
    readonly update?: never;
  },
  view: (
    owner: ComponentOwner<Published<State>>,
  ) => View<Placed<Props, Published<State>>, FieldsPatch<Published<State>>>,
): View<Props, never>;
export function component(definition: object, view: unknown): View<unknown, never> {
  const shape = definition as {
    readonly identity?: (props: unknown) => unknown;
    readonly init: (props: never) => object;
    readonly update?: unknown;
  };
  const rendered = view as View<never, never>;
  if (shape.update) return messageComponent(shape as never, rendered);
  return fieldsComponent(shape as never, rendered as never);
}

function fieldsComponent(
  definition: Identity<unknown> & { readonly init: (props: unknown) => object },
  view:
    | View<{ readonly props: unknown }, Partial<object>>
    | ((owner: ComponentOwner<object>) => View<{ readonly props: unknown }, Partial<object>>),
): View<unknown, never> {
  type Model = { props: unknown };
  const instances = new WeakMap<
    Program<Model, Partial<object>>,
    { readonly receive: (props: unknown) => void; readonly owner: ComponentOwner<object> }
  >();
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
      const read = () => source.model() as Record<string | number, unknown>;
      let task: ReturnType<typeof ownedTask> | undefined;
      const capability: ComponentOwner<object> = {
        read,
        patch,
        run: (key, effect, policy) => work().run(key, effect, policy),
        task: ((key: RunKey, effect: Effect.Effect<unknown, unknown, never>, policy: RunPolicy) =>
          (task ??= ownedTask(work().run as RunWithDiscard, read, patch, () => work().disposed))(
            key,
            effect,
            policy,
          )) as unknown as ComponentOwner<object>['task'],
        cancel: (key) => owner?.cancel(key),
        awaitIdle: (key) => owner?.awaitIdle(key) ?? Effect.void,
        own: (resource) => work().own(resource),
        get disposed() {
          return closed;
        },
      };
      const placed: Program<Model, Partial<object>> = {
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
      instances.set(placed, {
        receive: (props) => source.send({ type: 'Props', props }),
        owner: capability,
      });
      return placed;
    },
    receive(source, props) {
      instances.get(source)!.receive(props);
    },
    view:
      typeof view === 'function' && !('build' in view)
        ? (source: Program<Model, Partial<object>>) => view(instances.get(source)!.owner)
        : (view as View<Model, Partial<object>>),
  });
}

function messageComponent<Props, Model extends { readonly props: Props }, Message, R>(
  definition: Identity<Props> & {
    readonly init: (props: Props) => Model;
    readonly receive?: (model: Model, previous: Props) => Transition<Model, Message, R>;
    readonly update: (model: Model, message: Message) => Transition<Model, Message, R>;
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
        initial: { ...definition.init(scope.value as Props), props: scope.value } as Model,
        onDefect: scope.report,
        runtime: ownerRuntime,
        update: (model, envelope) => {
          if (envelope.type === 'Message') return wrap(definition.update(model, envelope.message));
          if (Object.is(model.props, envelope.props)) return { model };
          const next = { ...model, props: envelope.props } as Model;
          return wrap(definition.receive?.(next, model.props as Props) ?? { model: next });
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

/** What a placement releases with its controller: an owner, or any `{ dispose, close? }`. */
export interface ControllerLifetime {
  readonly dispose: () => void;
  /** Awaited teardown, when the resource has one; `dispose` alone is immediate. */
  readonly close?: () => Effect.Effect<void, unknown>;
}
/**
 * A controller publishes through `source` and hands its cleanup over as `lifetime`, usually
 * the `modelOwner` it created. Everything else it returns reaches the view as `model.actions`,
 * usually methods the view calls as `model.actions.name(…)`; the lifecycle members below are
 * not actions.
 */
export type ViewController<Props, Model> = {
  readonly source: Source<Model>;
  /** New props from the parent; called after every publication that changes them. */
  readonly receive?: (props: Props) => void;
  /** Capture DOM state before the view is torn down. */
  readonly beforeDispose?: () => void;
  readonly lifetime: ControllerLifetime;
};
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
      props: Props,
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
      const lifetime = controller.lifetime;
      const rendered = controllerSource(
        controller as unknown as { readonly source: Source<object> },
      ) as unknown as Source<Rendered>;
      const source: Program<Rendered, never> = {
        model: rendered.model,
        subscribe: rendered.subscribe,
        send: () => {},
        dispose: () => lifetime.dispose(),
        ...(lifetime.close ? { close: () => lifetime.close!() } : {}),
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
  identity?: (props: Props) => unknown;
  create: (props: Props, runtime: UiRuntime<never>, report: ReportError) => Program<Model, Message>;
  receive: (source: Program<Model, Message>, props: Props) => void;
  /** Capture DOM state before child disposal, on unmount or identity replacement. */
  beforeDispose?: (source: Program<Model, Message>) => void;
  view: View<Model, Message> | ((source: Program<Model, Message>) => View<Model, Message>);
}): View<Props, never> {
  return identify(
    compiled<Props, never>((scope, parent, before) => {
      const initialProps = scope.value as Props;
      const source = definition.create(
        initialProps,
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
      try {
        const receive = () => definition.receive(source, scope.value as Props);
        scope.jobs.push(receive);
        if (scope.value !== initialProps) receive();
        if (scope.disposed) return;
        const rendered = 'build' in definition.view ? definition.view : definition.view(source);
        if (scope.disposed) return;
        const range = rendered.build(
          child as unknown as RenderScope<Model, Message>,
          parent,
          before,
        );
        return range;
      } catch (error) {
        // Factories may acquire work before constructing their view. Release it on failure.
        scope.dispose();
        throw error;
      }
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
  identity?: (props: Props) => unknown,
): View<Props, never> {
  if (!identity) return definition;
  return compiled((scope, parent, before) => {
    const render = viewRegion(scope, parent, before, { manual: true });
    let current: unknown;
    let active: View<Props, never> | undefined;
    const update = () => {
      const next = identity(scope.value as Props);
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
