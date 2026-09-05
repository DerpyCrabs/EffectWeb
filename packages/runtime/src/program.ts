import { protectSnapshot, checkSnapshotsByDefault, type Snapshot } from './snapshot.js';
import { reportError, reportSafely } from './errors.js';
import { traceProgram, nextProgramId, hasProgramObservers } from './diagnostics.js';
import { Cause, Effect, Fiber, Option, Stream } from 'effect';
import * as Atom from 'effect/unstable/reactivity/Atom';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';

export type Send<Message> = (message: Message) => void;
/** A slot owns either one completion or a stream of progress/events, canceled together. */
export type Command<Message, R = never> = { readonly slot: string } & (
  | {
      readonly effect: Effect.Effect<Message, never, R>;
      readonly stream?: never;
      readonly action?: never;
    }
  | {
      readonly stream: Stream.Stream<Message, never, R>;
      readonly effect?: never;
      readonly action?: never;
    }
  | {
      readonly action: Effect.Effect<void, unknown, R>;
      readonly effect?: never;
      readonly stream?: never;
    }
);

/** A lazy request settles successes, typed failures and defects through one message contract. */
export function effectCommand<A, E, Success, Failure, R = never>(
  slot: string,
  load: () => Effect.Effect<A, E, R>,
  handlers: {
    readonly onSuccess: (value: A) => Success;
    readonly onFailure: (cause: Cause.Cause<E>) => Failure;
  },
): Command<Success | Failure, R> {
  return { slot, effect: Effect.suspend(load).pipe(Effect.matchCause(handlers)) };
}

/** Owned work with no model result. Failures use the program's error reporter. */
export function actionCommand<R = never>(
  slot: string,
  action: () => Effect.Effect<unknown, unknown, R>,
): Command<never, R> {
  return { slot, action: Effect.suspend(action).pipe(Effect.asVoid) };
}

export function mapCommand<A, B, R = never>(
  command: Command<A, R>,
  map: (message: A) => B,
): Command<B, R> {
  if (command.action) return { slot: command.slot, action: command.action };
  return command.stream
    ? { slot: command.slot, stream: command.stream.pipe(Stream.map(map)) }
    : { slot: command.slot, effect: command.effect.pipe(Effect.map(map)) };
}
export interface Transition<Model, Message, R = never> {
  readonly model: Model;
  readonly commands?: readonly Command<Message, R>[];
  readonly cancel?: readonly string[];
}
export interface Program<Model, Message> {
  readonly model: () => Snapshot<Model>;
  readonly send: Send<Message>;
  readonly subscribe: (listener: (model: Snapshot<Model>) => void) => () => void;
  readonly dispose: () => void;
}
export interface RunningProgram<Model, Message> extends Program<Model, Message> {
  readonly activeSlots: () => readonly string[];
  readonly awaitIdle: (slot?: string) => Promise<void>;
}

/** One immutable source of truth. Reducers are synchronous; commands own async work. */
export function program<Model, Message>(options: {
  initial: Model;
  name?: string;
  checkSnapshots?: boolean;
  update: (model: Snapshot<Model>, message: Message) => Transition<Model, Message>;
  onDefect?: (cause: unknown) => void;
}): RunningProgram<Model, Message> {
  const checkSnapshots = options.checkSnapshots ?? checkSnapshotsByDefault;
  const id = nextProgramId();
  const trace = (
    kind: import('./diagnostics').ProgramUpdate['kind'],
    slot?: string,
    message?: Message,
  ) =>
    hasProgramObservers() &&
    traceProgram({
      program: id,
      ...(options.name ? { name: options.name } : {}),
      kind,
      ...(slot ? { slot } : {}),
      ...(message &&
      typeof message === 'object' &&
      'type' in message &&
      typeof message.type === 'string'
        ? { message: message.type }
        : {}),
    });
  const waiters = new Set<{ slot: string | undefined; done: () => void }>();
  const notify = () => {
    for (const waiter of waiters) {
      if (
        disposed ||
        (!draining && (waiter.slot ? !running.has(waiter.slot) : running.size === 0))
      ) {
        waiters.delete(waiter);
        waiter.done();
      }
    }
  };
  const registry = AtomRegistry.make();
  const atom = Atom.make(protectSnapshot(options.initial, checkSnapshots));
  const release = registry.mount(atom);
  const running = new Map<
    string,
    { token: object; fiber?: Fiber.Fiber<Option.Option<Message>, unknown> }
  >();
  let disposed = false;
  let draining = false;
  const queue: Message[] = [];
  const cancel = (slot: string) => {
    const previous = running.get(slot);
    running.delete(slot);
    if (previous) trace('cancel', slot);
    if (previous?.fiber) Effect.runFork(Fiber.interrupt(previous.fiber));
  };
  const send: Send<Message> = (message) => {
    if (disposed) return;
    queue.push(message);
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !disposed) {
        const message = queue.shift()!;
        const transition = options.update(registry.get(atom), message);
        trace('update', undefined, message);
        for (const slot of transition.cancel ?? []) cancel(slot);
        registry.set(atom, protectSnapshot(transition.model, checkSnapshots));
        for (const command of transition.commands ?? []) {
          if (disposed) break;
          cancel(command.slot);
          const token = {};
          const runningCommand: {
            token: object;
            fiber?: Fiber.Fiber<Option.Option<Message>, unknown>;
          } = { token };
          running.set(command.slot, runningCommand);
          trace('start', command.slot);
          const effect = command.stream
            ? command.stream.pipe(
                Stream.runForEach((message) =>
                  Effect.sync(() => {
                    if (!disposed && running.get(command.slot)?.token === token) send(message);
                  }),
                ),
                Effect.as(Option.none<Message>()),
              )
            : command.action
              ? command.action.pipe(Effect.as(Option.none<Message>()))
              : command.effect.pipe(Effect.map(Option.some));
          const fiber = Effect.runFork(effect);
          runningCommand.fiber = fiber;
          if (disposed) {
            Effect.runFork(Fiber.interrupt(fiber));
            break;
          }
          fiber.addObserver((exit) => {
            if (disposed || running.get(command.slot)?.token !== token) return;
            running.delete(command.slot);
            trace(exit._tag === 'Success' ? 'complete' : 'defect', command.slot);
            if (exit._tag === 'Success') {
              if (Option.isSome(exit.value)) send(exit.value.value);
            } else reportSafely(options.onDefect ?? reportError, exit.cause);
            notify();
          });
        }
      }
    } catch (error) {
      queue.length = 0;
      throw error;
    } finally {
      draining = false;
      notify();
    }
  };
  return {
    model: () => registry.get(atom),
    activeSlots: () => [...running.keys()],
    awaitIdle: (slot) =>
      disposed || (!draining && (slot ? !running.has(slot) : running.size === 0))
        ? Promise.resolve()
        : new Promise((done) => {
            waiters.add({ slot, done });
          }),
    send,
    subscribe: (listener) =>
      registry.subscribe(atom, (model) => {
        try {
          listener(model);
        } catch (error) {
          reportSafely(options.onDefect ?? reportError, error);
        }
      }),
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      for (const slot of running.keys()) cancel(slot);
      release();
      registry.dispose();
      trace('dispose');
      notify();
    },
  };
}
