import { Cause, Effect, Queue, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { actionCommand, effectCommand, mapCommand, program, type Command } from './program.js';

describe('immutable model and command runtime', () => {
  it('accepts synchronous stream progress and owns cancellation of replaced streams', async () => {
    const queues: Array<Queue.Queue<number, Cause.Done>> = [];
    let finalized = 0;
    const source = program({
      initial: 0,
      update: (model: number, message: number) =>
        message < 0
          ? {
              model,
              commands: [
                {
                  slot: 'transfer',
                  stream: Stream.callback<number>((queue) =>
                    Effect.gen(function* () {
                      queues.push(queue);
                      yield* Effect.addFinalizer(() =>
                        Effect.sync(() => {
                          finalized++;
                        }),
                      );
                      Queue.offerUnsafe(queue, 1);
                      return yield* Effect.never;
                    }),
                  ),
                },
              ],
            }
          : { model: message },
    });
    source.send(-1);
    await new Promise((done) => setTimeout(done, 0));
    await expect.poll(source.model).toBe(1);
    source.send(-1);
    await new Promise((done) => setTimeout(done, 0));
    Queue.offerUnsafe(queues[0]!, 99);
    Queue.offerUnsafe(queues[1]!, 2);
    await new Promise((done) => setTimeout(done, 0));
    await expect.poll(source.model).toBe(2);
    await expect.poll(() => finalized).toBe(1);
    source.dispose();
    await new Promise((done) => setTimeout(done, 0));
    await expect.poll(() => finalized).toBe(2);
  });

  it('does not start commands when publishing the model disposes their owner', () => {
    let started = false;
    const app = program({
      initial: 0,
      update: (_model: number, message: number) => ({
        model: message,
        commands: [
          {
            slot: 'work',
            effect: Effect.sync(() => {
              started = true;
              return 2;
            }),
          },
        ],
      }),
    });
    app.subscribe(app.dispose);
    app.send(1);
    expect(started).toBe(false);
  });
  it('serializes reentrant messages and publishes coherent snapshots', () => {
    const app = program({
      initial: 0,
      update: (model: number, message: number) => ({ model: model + message }),
    });
    const seen: number[] = [];
    app.subscribe((model) => {
      seen.push(model);
      if (model === 1) app.send(2);
    });
    app.send(1);
    expect(app.model()).toBe(3);
    expect(seen).toEqual([1, 3]);
    app.dispose();
    app.send(1);
    expect(seen).toEqual([1, 3]);
  });
  it('replaces command slots, ignores stale completions and cancels on disposal', async () => {
    const completions: Array<(message: number) => void> = [];
    let canceled = 0;
    const app = program({
      initial: 0,
      update: (model: number, message: number) =>
        message < 0
          ? {
              model,
              commands: [
                {
                  slot: 'load',
                  effect: Effect.callback<number>((resume) => {
                    completions.push((value) => resume(Effect.succeed(value)));
                    return Effect.sync(() => {
                      canceled++;
                    });
                  }),
                },
              ],
            }
          : { model: message },
    });
    app.send(-1);
    await new Promise((done) => setTimeout(done, 0));
    app.send(-1);
    await new Promise((done) => setTimeout(done, 0));
    completions[0]!(99);
    completions[1]!(2);
    await new Promise((done) => setTimeout(done, 0));
    expect(app.model()).toBe(2);
    expect(canceled).toBeGreaterThanOrEqual(1);
    app.send(-1);
    await new Promise((done) => setTimeout(done, 0));
    app.dispose();
    await new Promise((done) => setTimeout(done, 0));
    expect(canceled).toBeGreaterThanOrEqual(2);
  });
});

describe('Effect command completion', () => {
  it.each(['success', 'failure', 'defect', 'throw'] as const)(
    'settles %s and preserves failure causes',
    async (kind) => {
      const problem = new Error(kind);
      let failure: Cause.Cause<unknown> | undefined;
      let started = false;
      const command = effectCommand(
        'request',
        () => {
          started = true;
          if (kind === 'throw') throw problem;
          return kind === 'success'
            ? Effect.succeed(42)
            : kind === 'failure'
              ? Effect.fail(problem)
              : Effect.die(problem);
        },
        {
          onSuccess: (value) => value,
          onFailure: (cause) => {
            failure = cause;
            return -1;
          },
        },
      );
      expect(started).toBe(false);
      const source = program({
        initial: 0,
        update: (model: number, message: number) =>
          message === 0 ? { model, commands: [command] } : { model: message },
      });
      source.send(0);
      await expect.poll(source.model).toBe(kind === 'success' ? 42 : -1);
      if (kind !== 'success') expect(Cause.squash(failure!)).toBe(problem);
      source.dispose();
    },
  );

  it('cancels mapped requests without emitting a failure and suppresses obsolete completions', async () => {
    const completions: Array<(value: number) => void> = [];
    let finalized = 0;
    type Message = { type: 'Start' } | { type: 'Cancel' } | { type: 'Result'; value: number };
    const messages: number[] = [];
    const source = program<number, Message>({
      initial: 0,
      update: (model, message) => {
        if (message.type === 'Cancel') return { model, cancel: ['request'] };
        if (message.type === 'Result') {
          messages.push(message.value);
          return { model: message.value };
        }
        return {
          model,
          commands: [
            mapCommand(
              effectCommand(
                'request',
                () =>
                  Effect.callback<number>((resume) => {
                    completions.push((value) => resume(Effect.succeed(value)));
                    return Effect.sync(() => {
                      finalized++;
                    });
                  }),
                { onSuccess: (value) => value, onFailure: () => -1 },
              ),
              (value): Message => ({ type: 'Result', value }),
            ),
          ],
        };
      },
    });
    source.send({ type: 'Start' });
    await expect.poll(() => completions.length).toBe(1);
    source.send({ type: 'Start' });
    await expect.poll(() => completions.length).toBe(2);
    completions[0]!(99);
    completions[1]!(2);
    await expect.poll(source.model).toBe(2);
    source.send({ type: 'Start' });
    await expect.poll(() => completions.length).toBe(3);
    source.send({ type: 'Cancel' });
    await expect.poll(() => finalized).toBe(2);
    completions[2]!(3);
    await new Promise((done) => setTimeout(done, 0));
    expect(messages).toEqual([2]);
    source.dispose();
  });

  it('maps action-only commands without creating envelope messages and finalizes on disposal', async () => {
    let mapped = 0,
      started = 0,
      finalized = 0;
    const command: Command<number> = mapCommand(
      actionCommand('action', () =>
        Effect.gen(function* () {
          started++;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              finalized++;
            }),
          );
          return yield* Effect.never;
        }).pipe(Effect.scoped),
      ),
      () => {
        mapped++;
        return 99;
      },
    );
    const source = program({
      initial: 0,
      update: (model: number, message: number) => ({ model: message, commands: [command] }),
    });
    source.send(1);
    await expect.poll(() => started).toBe(1);
    source.send(2);
    await expect.poll(() => finalized).toBe(1);
    await expect.poll(() => started).toBe(2);
    source.dispose();
    await expect.poll(() => finalized).toBe(2);
    expect(mapped).toBe(0);
  });

  it('reports action failures and permits synchronous action success without a message', async () => {
    const errors: unknown[] = [];
    let mapped = 0;
    const source = program({
      initial: 0,
      onDefect: (cause) => errors.push(cause),
      update: (_: number, message: number) => ({
        model: message,
        commands: [
          mapCommand(
            actionCommand('action', () => {
              if (message === 1) throw new Error('action');
              return Effect.void;
            }),
            () => {
              mapped++;
              return 99;
            },
          ),
        ],
      }),
    });
    source.send(1);
    await expect.poll(() => errors.length).toBe(1);
    source.send(2);
    await new Promise((done) => setTimeout(done, 0));
    expect(source.model()).toBe(2);
    expect(mapped).toBe(0);
    source.dispose();
  });
});

it('keeps snapshot publication synchronous, deduplicated and safe when subscriptions change', async () => {
  const errors: unknown[] = [];
  const app = program({
    initial: 0,
    onDefect: (error) => errors.push(error),
    update: (_model: number, value: number) => ({ model: value }),
  });
  const seen: number[] = [];
  const listener = (value: number) => seen.push(value);
  const first = app.subscribe(listener);
  const second = app.subscribe(listener);
  const failing = app.subscribe(() => {
    throw new Error('subscriber');
  });
  const idle: Promise<void>[] = [];
  app.subscribe((value) => {
    idle.push(app.awaitIdle());
    if (value === 1) app.send(2);
  });
  app.send(1);
  expect(seen).toEqual([1, 1, 2, 2]);
  expect(app.model()).toBe(2);
  expect(errors).toHaveLength(2);
  app.send(2);
  expect(seen).toHaveLength(4);
  first();
  failing();
  app.send(3);
  expect(seen).toEqual([1, 1, 2, 2, 3]);
  second();
  app.dispose();
  app.subscribe(listener);
  app.send(4);
  await Promise.all(idle);
  expect(seen).toEqual([1, 1, 2, 2, 3]);
  expect(app.activeSlots()).toEqual([]);
});
