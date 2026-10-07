import { protectSnapshot, type Snapshot } from './snapshot.js';
import { reportError, reportSafely } from './errors.js';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Option from 'effect/Option';
import * as Stream from 'effect/Stream';
import type * as Scope from 'effect/Scope';
import { KeyMap, equalKeys, copyKey } from './command-key.js';
import * as Context from 'effect/Context';
import type { UiRuntime } from './runtime.js';

export type Send<Message> = (message: Message) => void;
/** queue retains FIFO requests; latest-queued retains only the newest pending request. */
export type RunPolicy = 'replace' | 'drop' | 'parallel' | 'queue' | 'latest-queued';

/** Owner-scoped command identity, compared structurally. Arrays are copied on admission. */
export type RunKey = string | number | readonly (string | number)[];

/**
 * Owned Effect work returned from a transition. The Effect's success is the next message, so
 * build it with Effect's own combinators: `Effect.matchCause({ onSuccess, onFailure })` turns
 * every outcome into a message, and an Effect that succeeds with nothing (`Effect.sync(() => …)`)
 * sends none. The error channel is `never`: handle failures, or `Effect.orDie` to report them.
 * A `stream` sends each element as a message. One key owns the work and cancels it together.
 */
export type Command<Message, R = never> = { readonly key: RunKey; readonly policy: RunPolicy } & (
  | {
      readonly effect: Effect.Effect<Message | void, never, R | Scope.Scope>;
      readonly stream?: never;
      readonly action?: never;
    }
  | {
      readonly stream: Stream.Stream<Message, never, R | Scope.Scope>;
      readonly effect?: never;
      readonly action?: never;
    }
);

/** Internal settlement hooks an owner attaches to its commands. */
type CommandHooks = {
  /** Completion observation; runs after finalizers. */
  readonly onSettled?: (
    exit: Exit.Exit<unknown, unknown>,
    reason?: 'Cancelled' | 'Superseded' | 'Disposed',
  ) => void;
  /** Notification for work that never started. */
  readonly onDiscard?: (reason: 'Cancelled' | 'Superseded' | 'Dropped' | 'Disposed') => void;
  /** The owner publishes typed failures itself, so only defects are reported. */
  readonly reportsDefectsOnly?: boolean;
};
/**
 * A command as the scheduler sees it. Owners also run `action`s: work with no message whose
 * failures are reported rather than handled. Internal.
 */
export type OwnedCommand<Message, R = never> = CommandHooks &
  (
    | Command<Message, R>
    | {
        readonly key: RunKey;
        readonly policy: RunPolicy;
        readonly action: Effect.Effect<void, unknown, R | Scope.Scope>;
        readonly effect?: never;
        readonly stream?: never;
      }
  );

/** Wrap a command's messages, for a component that envelopes its own messages. Internal. */
export function mapCommand<A, B, R = never>(
  command: Command<A, R>,
  map: (message: A) => B,
): Command<B, R>;
export function mapCommand<A, B, R = never>(
  command: OwnedCommand<A, R>,
  map: (message: A) => B,
): OwnedCommand<B, R>;
export function mapCommand<A, B, R = never>(
  command: OwnedCommand<A, R>,
  map: (message: A) => B,
): OwnedCommand<B, R> {
  if ('action' in command && command.action) return command as OwnedCommand<B, R>;
  return command.stream
    ? { ...command, stream: command.stream.pipe(Stream.map(map)) }
    : {
        ...command,
        effect: command.effect!.pipe(
          Effect.map((message) => (message === undefined ? undefined : map(message as A))),
        ),
      };
}
export interface Transition<Model, Message, R = never> {
  readonly model: Model | Snapshot<Model>;
  readonly commands?: readonly Command<Message, R>[];
  readonly cancel?: readonly RunKey[];
}
/** A transition whose commands may include owner actions. Internal. */
export interface OwnedTransition<Model, Message> {
  readonly model: Model | Snapshot<Model>;
  readonly commands?: readonly OwnedCommand<Message>[];
  readonly cancel?: readonly RunKey[];
}
export interface Program<Model, Message> {
  readonly model: () => Snapshot<Model>;
  readonly send: Send<Message>;
  readonly subscribe: (listener: (model: Snapshot<Model>) => void) => () => void;
  readonly dispose: () => void;
  readonly close?: () => Effect.Effect<void, unknown>;
}
export interface RunningProgram<Model, Message> extends Program<Model, Message> {
  readonly close: () => Effect.Effect<void>;
  /** Resolves when the key (or every key) has no running or pending work. */
  readonly awaitIdle: (key?: RunKey) => Effect.Effect<void>;
}
/** A program with scheduler inspection, for owners and tests. Internal. */
export interface ProgramHandle<Model, Message> extends RunningProgram<Model, Message> {
  /** Wait for interrupted work and its finalizers as well as admitted work. */
  readonly awaitStopped: () => Effect.Effect<void>;
  readonly activeKeys: () => readonly RunKey[];
  /** Whether the key has running or pending work. */
  readonly isRunning: (key: RunKey) => boolean;
}

/**
 * A reducer with owned commands. `context` supplies the services its commands require; scope a
 * program in an Effect with `Effect.acquireRelease(Effect.sync(() => program(…)), (p) => p.close())`.
 */
export function program<Model, Message, R = never>(
  options: {
    initial: Model | Snapshot<Model>;
    update: (model: Snapshot<Model>, message: Message) => Transition<Model, Message, NoInfer<R>>;
    onDefect?: (cause: unknown) => void;
  } & ([R] extends [never]
    ? { readonly context?: Context.Context<never> }
    : { readonly context: Context.Context<R> }),
): RunningProgram<Model, Message> {
  if (!options.context)
    return createProgram(options as Parameters<typeof createProgram<Model, Message>>[0]);
  const context = options.context as Context.Context<R>;
  const provide = (command: Command<Message, R>) => provideCommand(command, context);
  return createProgram<Model, Message>({
    initial: options.initial,
    ...(options.onDefect ? { onDefect: options.onDefect } : {}),
    update: (model, message) => provideTransition(provide, options.update(model, message)),
  });
}

/** A command whose Effect or Stream runs with `context`. Internal. */
function provideCommand<Message, R>(
  command: Command<Message, R>,
  context: Context.Context<R>,
): Command<Message> {
  if (command.effect)
    return { ...command, effect: Effect.provideContext(Effect.scoped(command.effect), context) };
  return {
    ...command,
    stream: Stream.unwrap(
      Effect.map(Effect.context<Scope.Scope>(), (scope) =>
        command.stream!.pipe(Stream.provideContext(Context.merge(context, scope))),
      ),
    ),
  } as Command<Message>;
}

/** Supply a transition's commands with services. */
function provideTransition<Model, Message, R>(
  provide: (command: Command<Message, R>) => Command<Message>,
  next: Transition<Model, Message, R>,
): Transition<Model, Message> {
  return {
    model: next.model,
    ...(next.cancel ? { cancel: next.cancel } : {}),
    ...(next.commands ? { commands: next.commands.map(provide) } : {}),
  };
}

/** The program scheduler. `runtime` forks command fibers in a mount's or owner's scope. Internal. */
export function createProgram<Model, Message>(options: {
  initial: Model | Snapshot<Model>;
  update: (model: Snapshot<Model>, message: Message) => OwnedTransition<Model, Message>;
  onDefect?: (cause: unknown) => void;
  runtime?: Pick<UiRuntime<never>, 'runFork'>;
}): ProgramHandle<Model, Message> {
  const waiters = new Set<{ key: RunKey | undefined; done: () => void }>();
  const notify = () => {
    notifyStopped();
    for (const waiter of waiters) {
      if (
        disposed ||
        (!draining && (waiter.key !== undefined ? !running.has(waiter.key) : running.size === 0))
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
    command?: OwnedCommand<Message>;
    reason?: 'Cancelled' | 'Superseded' | 'Disposed';
  };
  type Group = { active: Set<Running>; pending: OwnedCommand<Message>[] };
  const running = new KeyMap<Group>();
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
  const queue: Array<{ message: Message; key?: RunKey }> = [];
  const deferred: Array<{ key: RunKey; group: Group }> = [];
  const discard = (
    command: OwnedCommand<Message>,
    reason: 'Cancelled' | 'Superseded' | 'Dropped' | 'Disposed',
  ) => {
    if (command.onDiscard) {
      try {
        command.onDiscard(reason);
      } catch (error) {
        reportSafely(options.onDefect ?? reportError, error);
      }
    }
  };
  const cancel = (key: RunKey, reason: 'Cancelled' | 'Superseded' | 'Disposed' = 'Cancelled') => {
    // A synchronous Effect can enqueue completion behind a reset/replacement message.
    // Its fiber is already done, but cancellation still owns that unpublished completion.
    for (let index = queue.length - 1; index >= 0; index--)
      if (queue[index]!.key !== undefined && equalKeys(queue[index]!.key!, key))
        queue.splice(index, 1);
    const previous = running.get(key);
    running.delete(key);
    if (previous) {
      const pending = previous.pending.splice(0);
      for (const command of pending) discard(command, reason);
      for (const task of previous.active) {
        task.reason = reason;
        if (task.fiber) Effect.runFork(Fiber.interrupt(task.fiber));
        else if (task.command && !live.has(task)) discard(task.command, reason);
      }
      previous.active.clear();
    }
  };
  const ready: Array<{ command: OwnedCommand<Message>; group: Group; task: Running }> = [];
  let launching = false;
  const launch = (command: OwnedCommand<Message>, group: Group, task: Running) => {
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
  const start = (command: OwnedCommand<Message>, group: Group, task: Running) => {
    const valid = () => !disposed && running.get(command.key) === group && group.active.has(task);
    if (!valid()) return;
    const effect = command.stream
      ? command.stream.pipe(
          Stream.runForEach((message) =>
            Effect.sync(() => {
              if (valid()) enqueue(message, command.key);
            }),
          ),
          Effect.as(Option.none<Message>()),
        )
      : command.action
        ? command.action.pipe(Effect.as(Option.none<Message>()))
        : // A command that succeeds with nothing sends no message.
          command.effect!.pipe(
            Effect.map((message) =>
              message === undefined ? Option.none<Message>() : Option.some(message as Message),
            ),
          );
    live.add(task);
    const fiber = options.runtime
      ? options.runtime.runFork(effect)
      : Effect.runFork(Effect.scoped(effect));
    task.fiber = fiber;
    const reported = (cause: Cause.Cause<unknown>) =>
      !command.reportsDefectsOnly || !Cause.hasFails(cause) || Cause.hasDies(cause);
    fiber.addObserver((exit) => {
      live.delete(task);
      if (!valid()) {
        if (exit._tag === 'Failure' && !Cause.hasInterruptsOnly(exit.cause) && reported(exit.cause))
          reportSafely(options.onDefect ?? reportError, exit.cause);
        notifyStopped();
        command.onSettled?.(exit, task.reason);
        return;
      }
      group.active.delete(task);
      if (!group.active.size && !group.pending.length) running.delete(command.key);
      if (exit._tag === 'Success') {
        if (Option.isSome(exit.value)) {
          // The reducer runs inside this fiber's observer, where a throw has no caller to
          // reach. Report it like any other failure of this command.
          try {
            enqueue(exit.value.value, command.key);
          } catch (error) {
            reportSafely(options.onDefect ?? reportError, error);
          }
        }
      } else if (reported(exit.cause)) reportSafely(options.onDefect ?? reportError, exit.cause);
      if (!disposed && running.get(command.key) === group && !group.active.size) {
        // Process earlier reducer messages and completion subscribers before choosing the
        // next write, so cancellation and latest-queued still apply to all pending work.
        if (draining) deferred.push({ key: command.key, group });
        else advance(command.key, group);
      }
      notify();
      command.onSettled?.(exit, task.reason);
    });
    if (!valid()) Effect.runFork(Fiber.interrupt(fiber));
  };
  const advance = (key: RunKey, group: Group) => {
    if (disposed || running.get(key) !== group || group.active.size) return;
    const next = group.pending.shift();
    if (!next) return;
    const task: Running = { command: next };
    group.active.add(task);
    launch(next, group, task);
  };
  const enqueue = (message: Message, key?: RunKey) => {
    if (disposed) return;
    queue.push(key === undefined ? { message } : { message, key });
    if (draining) return;
    draining = true;
    try {
      while ((queue.length || deferred.length) && !disposed) {
        if (!queue.length) {
          const next = deferred.shift()!;
          advance(next.key, next.group);
          continue;
        }
        const { message } = queue.shift()!;
        const transition = options.update(current as Snapshot<Model>, message);
        for (const key of transition.cancel ?? []) cancel(key);
        const next = protectSnapshot(transition.model) as Model;
        if (!Object.is(current, next)) {
          current = next;
          for (const listener of listeners) listener(current as Snapshot<Model>);
        }
        const starts: Array<() => void> = [];
        // Admit the entire transition before launching Effects, so a later replacement can
        // supersede earlier work in the same transaction without executing it.
        for (const original of transition.commands ?? []) {
          const command = { ...original, key: copyKey(original.key) };
          if (disposed) {
            discard(command, 'Disposed');
            continue;
          }
          const policy = command.policy;
          let group = running.get(command.key);
          if (policy === 'drop' && group) {
            discard(command, 'Dropped');
            continue;
          }
          if (policy === 'replace') {
            cancel(command.key, 'Superseded');
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
            running.set(command.key, group);
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
      for (const { key, group } of deferred) if (running.get(key) === group) cancel(key);
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
    for (const key of running.keys()) cancel(key, 'Disposed');
    listeners.clear();
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
    activeKeys: () => [...running.keys()],
    isRunning: (key) => running.has(key),
    awaitIdle: (key) =>
      Effect.callback((resume) => {
        if (disposed || (!draining && (key !== undefined ? !running.has(key) : running.size === 0)))
          return resume(Effect.void);
        const waiter = { key, done: () => resume(Effect.void) };
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
