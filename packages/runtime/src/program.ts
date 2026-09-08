import { protectSnapshot, checkSnapshotsByDefault, type Snapshot } from './snapshot.js';
import { reportError, reportSafely } from './errors.js';
import { traceProgram, nextProgramId, hasProgramObservers } from './diagnostics.js';
import { Cause, Effect, Fiber, Option, Stream } from 'effect';

export type Send<Message> = (message: Message) => void;
/** queue retains FIFO requests; latest-queued retains only the newest pending request. */
export type TaskPolicy = 'replace' | 'drop' | 'parallel' | 'queue' | 'latest-queued';

/** A slot owns either one completion or a stream of progress/events, canceled together. */
export type Command<Message, R = never> = {
  readonly slot: string;
  readonly policy?: TaskPolicy;
} & (
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
  if (command.action) return { ...command, action: command.action };
  return command.stream
    ? { ...command, stream: command.stream.pipe(Stream.map(map)) }
    : { ...command, effect: command.effect.pipe(Effect.map(map)) };
}
export interface Transition<Model, Message, R = never> {
  readonly model: Model | Snapshot<Model>;
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
  // A program publishes one immutable value. It needs no reactive dependency graph;
  // Effect still owns all command fibers, streams, and cancellation below.
  let current = protectSnapshot(options.initial, checkSnapshots);
  const listeners = new Set<(model: Snapshot<Model>) => void>();
  type Running = { fiber?: Fiber.Fiber<Option.Option<Message>, unknown> };
  type Group = { active: Set<Running>; pending: Command<Message>[] };
  const running = new Map<string, Group>();
  let disposed = false;
  let draining = false;
  const queue: Array<{ message: Message; slot?: string }> = [];
  const deferred: Array<{ slot: string; group: Group }> = [];
  const cancel = (slot: string) => {
    // A synchronous Effect can enqueue completion behind a reset/replacement message.
    // Its fiber is already done, but cancellation still owns that unpublished completion.
    for (let index = queue.length - 1; index >= 0; index--)
      if (queue[index]!.slot === slot) queue.splice(index, 1);
    const previous = running.get(slot);
    running.delete(slot);
    if (previous) {
      trace('cancel', slot);
      previous.pending.length = 0;
      for (const task of previous.active)
        if (task.fiber) Effect.runFork(Fiber.interrupt(task.fiber));
      previous.active.clear();
    }
  };
  const ready: Array<{ command: Command<Message>; group: Group; task: Running }> = [];
  let launching = false;
  const launch = (command: Command<Message>, group: Group, task: Running) => {
    ready.push({ command, group, task });
    if (launching) return;
    launching = true;
    try {
      while (ready.length) {
        const next = ready.shift()!;
        start(next.command, next.group, next.task);
      }
    } finally {
      launching = false;
    }
  };
  const start = (command: Command<Message>, group: Group, task: Running) => {
    const valid = () => !disposed && running.get(command.slot) === group && group.active.has(task);
    if (!valid()) return;
    trace('start', command.slot);
    const effect = command.stream
      ? command.stream.pipe(
          Stream.runForEach((message) =>
            Effect.sync(() => {
              if (valid()) enqueue(message, command.slot);
            }),
          ),
          Effect.as(Option.none<Message>()),
        )
      : command.action
        ? command.action.pipe(Effect.as(Option.none<Message>()))
        : command.effect.pipe(Effect.map(Option.some));
    const fiber = Effect.runFork(effect);
    task.fiber = fiber;
    if (!valid()) {
      Effect.runFork(Fiber.interrupt(fiber));
      return;
    }
    fiber.addObserver((exit) => {
      if (!valid()) return;
      group.active.delete(task);
      if (!group.active.size && !group.pending.length) running.delete(command.slot);
      trace(exit._tag === 'Success' ? 'complete' : 'defect', command.slot);
      if (exit._tag === 'Success') {
        if (Option.isSome(exit.value)) enqueue(exit.value.value, command.slot);
      } else reportSafely(options.onDefect ?? reportError, exit.cause);
      if (!disposed && running.get(command.slot) === group && !group.active.size) {
        // Process earlier reducer messages and completion subscribers before choosing the
        // next write, so cancellation and latest-queued still apply to all pending work.
        if (draining) deferred.push({ slot: command.slot, group });
        else advance(command.slot, group);
      }
      notify();
    });
  };
  const advance = (slot: string, group: Group) => {
    if (disposed || running.get(slot) !== group || group.active.size) return;
    const next = group.pending.shift();
    if (!next) return;
    const task: Running = {};
    group.active.add(task);
    launch(next, group, task);
  };
  const enqueue = (message: Message, slot?: string) => {
    if (disposed) return;
    queue.push(slot === undefined ? { message } : { message, slot });
    if (draining) return;
    draining = true;
    try {
      while ((queue.length || deferred.length) && !disposed) {
        if (!queue.length) {
          const next = deferred.shift()!;
          advance(next.slot, next.group);
          continue;
        }
        const { message } = queue.shift()!;
        const transition = options.update(current as Snapshot<Model>, message);
        trace('update', undefined, message);
        for (const slot of transition.cancel ?? []) cancel(slot);
        const next = protectSnapshot(transition.model, checkSnapshots) as Model;
        if (!Object.is(current, next)) {
          current = next;
          for (const listener of listeners) listener(current as Snapshot<Model>);
        }
        const starts: Array<() => void> = [];
        // Admit the entire transition before launching Effects, so a later replacement can
        // supersede earlier work in the same transaction without executing it.
        for (const command of transition.commands ?? []) {
          if (disposed) break;
          const policy = command.policy ?? 'replace';
          let group = running.get(command.slot);
          if (policy === 'drop' && group) continue;
          if (policy === 'replace') {
            cancel(command.slot);
            group = undefined;
          }
          if (group && (policy === 'queue' || policy === 'latest-queued')) {
            if (policy === 'latest-queued') group.pending.length = 0;
            group.pending.push(command);
            continue;
          }
          if (!group) {
            group = { active: new Set(), pending: [] };
            running.set(command.slot, group);
          }
          const task: Running = {};
          group.active.add(task);
          const admitted = group;
          starts.push(() => launch(command, admitted, task));
        }
        for (const launch of starts) launch();
      }
    } catch (error) {
      // A failed reducer must not leave deferred work keeping awaitIdle pending.
      for (const { slot, group } of deferred) if (running.get(slot) === group) cancel(slot);
      deferred.length = 0;
      queue.length = 0;
      throw error;
    } finally {
      draining = false;
      notify();
    }
  };
  const send: Send<Message> = (message) => enqueue(message);
  return {
    model: () => current as Snapshot<Model>,
    activeSlots: () => [...running.keys()],
    awaitIdle: (slot) =>
      disposed || (!draining && (slot ? !running.has(slot) : running.size === 0))
        ? Promise.resolve()
        : new Promise((done) => {
            waiters.add({ slot, done });
          }),
    send,
    subscribe(listener) {
      if (disposed) return () => {};
      const receive = (model: Snapshot<Model>) => {
        try {
          listener(model);
        } catch (error) {
          reportSafely(options.onDefect ?? reportError, error);
        }
      };
      listeners.add(receive);
      return () => {
        listeners.delete(receive);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      deferred.length = 0;
      for (const slot of running.keys()) cancel(slot);
      listeners.clear();
      trace('dispose');
      notify();
    },
  };
}
