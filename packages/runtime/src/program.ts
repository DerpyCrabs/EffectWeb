import { protectSnapshot, type Snapshot } from './snapshot.js';
import { reportError, reportSafely } from './errors.js';
import { traceProgram, nextProgramId, hasProgramObservers } from './diagnostics.js';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Option from 'effect/Option';
import * as Stream from 'effect/Stream';

export type Send<Message> = (message: Message) => void;
/** queue retains FIFO requests; latest-queued retains only the newest pending request. */
export type TaskPolicy = 'replace' | 'drop' | 'parallel' | 'queue' | 'latest-queued';

declare const slotType: unique symbol;
/** Stable operation identity. Equal diagnostic names never share cancellation. */
export type CommandSlot = symbol & { readonly [slotType]: true };
export const commandSlot = (name: string): CommandSlot => Symbol(name) as CommandSlot;

/** A slot owns either one completion or a stream of progress/events, canceled together. */
export type Command<Message, R = never> = {
  readonly slot: CommandSlot;
  readonly policy: TaskPolicy;
  /** Notification for work that never started. */
  readonly onDiscard?: (reason: 'Cancelled' | 'Superseded' | 'Dropped') => void;
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
  slot: CommandSlot,
  load: () => Effect.Effect<A, E, R>,
  handlers: {
    readonly policy: TaskPolicy;
    readonly onSuccess: (value: A) => Success;
    readonly onFailure: (cause: Cause.Cause<E>) => Failure;
  },
): Command<Success | Failure, R> {
  return {
    slot,
    policy: handlers.policy,
    effect: Effect.suspend(load).pipe(Effect.matchCause(handlers)),
  };
}

/** Owned work with no model result. Failures use the program's error reporter. */
export function actionCommand<R = never>(
  slot: CommandSlot,
  action: () => Effect.Effect<unknown, unknown, R>,
  policy: TaskPolicy,
): Command<never, R> {
  return { slot, policy, action: Effect.suspend(action).pipe(Effect.asVoid) };
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
  readonly cancel?: readonly CommandSlot[];
}
export function mapTransition<Model, Message, Parent, ParentMessage, R = never>(
  transition: Transition<Model, Message, R>,
  maps: {
    readonly model: (model: Snapshot<Model>) => Parent | Snapshot<Parent>;
    readonly message: (message: Message) => ParentMessage;
  },
): Transition<Parent, ParentMessage, R> {
  return {
    model: maps.model(transition.model as Snapshot<Model>),
    ...(transition.cancel ? { cancel: transition.cancel } : {}),
    ...(transition.commands
      ? { commands: transition.commands.map((command) => mapCommand(command, maps.message)) }
      : {}),
  };
}
export interface Program<Model, Message> {
  readonly model: () => Snapshot<Model>;
  readonly send: Send<Message>;
  readonly subscribe: (listener: (model: Snapshot<Model>) => void) => () => void;
  readonly dispose: () => void;
  readonly close?: () => Effect.Effect<void, unknown>;
}
export interface RunningProgram<Model, Message> extends Program<Model, Message> {
  /** Wait for interrupted work and its finalizers as well as admitted work. */
  readonly awaitStopped: () => Effect.Effect<void>;
  readonly close: () => Effect.Effect<void>;
  readonly activeSlots: () => readonly CommandSlot[];
  readonly awaitIdle: (slot?: CommandSlot) => Effect.Effect<void>;
}

export function program<Model, Message>(options: {
  initial: Model | Snapshot<Model>;
  name?: string;
  update: (model: Snapshot<Model>, message: Message) => Transition<Model, Message>;
  onDefect?: (cause: unknown) => void;
}): RunningProgram<Model, Message> {
  const id = nextProgramId();
  const trace = (
    kind: import('./diagnostics').ProgramUpdate['kind'],
    slot?: CommandSlot,
    message?: Message,
  ) =>
    hasProgramObservers() &&
    traceProgram({
      program: id,
      ...(options.name ? { name: options.name } : {}),
      kind,
      ...(slot ? { slot: slot.description ?? 'command' } : {}),
      ...(message &&
      typeof message === 'object' &&
      'type' in message &&
      typeof message.type === 'string'
        ? { message: message.type }
        : {}),
    });
  const waiters = new Set<{ slot: CommandSlot | undefined; done: () => void }>();
  const notify = () => {
    notifyStopped();
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
  let current = protectSnapshot(options.initial) as Model;
  const listeners = new Set<(model: Snapshot<Model>) => void>();
  type Running = {
    fiber?: Fiber.Fiber<Option.Option<Message>, unknown>;
    command?: Command<Message>;
  };
  type Group = { active: Set<Running>; pending: Command<Message>[] };
  const running = new Map<CommandSlot, Group>();
  const live = new Set<Running>();
  const stopped = new Set<() => void>();
  const notifyStopped = () => {
    if (live.size || running.size || draining) return;
    const completed = [...stopped];
    stopped.clear();
    for (const done of completed) done();
  };
  const awaitStopped = (): Effect.Effect<void> =>
    Effect.callback((resume) => {
      if (live.size === 0 && running.size === 0 && !draining) return resume(Effect.void);
      const done = () => resume(Effect.void);
      stopped.add(done);
      return Effect.sync(() => {
        stopped.delete(done);
      });
    });
  let disposed = false;
  let draining = false;
  const queue: Array<{ message: Message; slot?: CommandSlot }> = [];
  const deferred: Array<{ slot: CommandSlot; group: Group }> = [];
  const discard = (command: Command<Message>, reason: 'Cancelled' | 'Superseded' | 'Dropped') => {
    if (command.onDiscard) {
      try {
        command.onDiscard(reason);
      } catch (error) {
        reportSafely(options.onDefect ?? reportError, error);
      }
    }
  };
  const cancel = (slot: CommandSlot, reason: 'Cancelled' | 'Superseded' = 'Cancelled') => {
    // A synchronous Effect can enqueue completion behind a reset/replacement message.
    // Its fiber is already done, but cancellation still owns that unpublished completion.
    for (let index = queue.length - 1; index >= 0; index--)
      if (queue[index]!.slot === slot) queue.splice(index, 1);
    const previous = running.get(slot);
    running.delete(slot);
    if (previous) {
      trace('cancel', slot);
      const pending = previous.pending.splice(0);
      for (const command of pending) discard(command, reason);
      for (const task of previous.active) {
        if (task.fiber) Effect.runFork(Fiber.interrupt(task.fiber));
        else if (task.command && !live.has(task)) discard(task.command, reason);
      }
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
    live.add(task);
    const fiber = Effect.runFork(effect);
    task.fiber = fiber;
    fiber.addObserver((exit) => {
      live.delete(task);
      if (!valid()) {
        if (exit._tag === 'Failure' && !Cause.hasInterruptsOnly(exit.cause))
          reportSafely(options.onDefect ?? reportError, exit.cause);
        notifyStopped();
        return;
      }
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
    if (!valid()) Effect.runFork(Fiber.interrupt(fiber));
  };
  const advance = (slot: CommandSlot, group: Group) => {
    if (disposed || running.get(slot) !== group || group.active.size) return;
    const next = group.pending.shift();
    if (!next) return;
    const task: Running = { command: next };
    group.active.add(task);
    launch(next, group, task);
  };
  const enqueue = (message: Message, slot?: CommandSlot) => {
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
        const next = protectSnapshot(transition.model) as Model;
        if (!Object.is(current, next)) {
          current = next;
          for (const listener of listeners) listener(current as Snapshot<Model>);
        }
        const starts: Array<() => void> = [];
        // Admit the entire transition before launching Effects, so a later replacement can
        // supersede earlier work in the same transaction without executing it.
        for (const command of transition.commands ?? []) {
          if (disposed) break;
          const policy = command.policy;
          let group = running.get(command.slot);
          if (policy === 'drop' && group) {
            discard(command, 'Dropped');
            continue;
          }
          if (policy === 'replace') {
            cancel(command.slot, 'Superseded');
            group = undefined;
          }
          if (group && (policy === 'queue' || policy === 'latest-queued')) {
            if (policy === 'latest-queued')
              for (const pending of group.pending.splice(0)) discard(pending, 'Superseded');
            group.pending.push(command);
            continue;
          }
          if (!group) {
            group = { active: new Set(), pending: [] };
            running.set(command.slot, group);
          }
          const task: Running = { command };
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
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    queue.length = 0;
    deferred.length = 0;
    for (const slot of running.keys()) cancel(slot);
    listeners.clear();
    trace('dispose');
    notify();
  };
  return {
    awaitStopped,
    close: () =>
      Effect.suspend(() => {
        dispose();
        return awaitStopped();
      }),
    model: () => current as Snapshot<Model>,
    activeSlots: () => [...running.keys()],
    awaitIdle: (slot) =>
      Effect.callback((resume) => {
        if (disposed || (!draining && (slot ? !running.has(slot) : running.size === 0)))
          return resume(Effect.void);
        const waiter = { slot, done: () => resume(Effect.void) };
        waiters.add(waiter);
        return Effect.sync(() => {
          waiters.delete(waiter);
        });
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
    dispose,
  };
}
