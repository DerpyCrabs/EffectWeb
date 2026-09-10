import { Effect, Stream } from 'effect';
import { expect, it, vi } from 'vitest';
import { defineField, type FieldMessage, type FieldState } from './form.js';
import { commandSlot, mapTransition, program, type Transition } from './program.js';
import { controlledEffect } from './testing.js';

it('lifts field validation, edits and cancellation without disturbing another field', async () => {
  const a = controlledEffect<string | undefined>();
  const b = controlledEffect<string | undefined>();
  const field = (id: string, effect: Effect.Effect<string | undefined>) =>
    defineField({
      id,
      parse: (draft: string) => ({ ok: true as const, value: draft }),
      validate: () => effect,
    });
  const fields = { a: field('a', a.effect), b: field('b', b.effect) };
  type Model = {
    a: FieldState<string, string>;
    b: FieldState<string, string>;
    untouched: { value: number };
  };
  type Message = { field: 'a' | 'b'; message: FieldMessage<string> };
  const source = program<Model, Message>({
    initial: { a: fields.a.init('first'), b: fields.b.init('second'), untouched: { value: 1 } },
    update: (model, action) =>
      mapTransition(fields[action.field].update(model[action.field], action.message), {
        model: (field) => ({ ...model, [action.field]: field }),
        message: (message) => ({ field: action.field, message }),
      }),
  });
  const untouched = source.model().untouched;
  source.send({ field: 'a', message: { type: 'Validate' } });
  source.send({ field: 'b', message: { type: 'Validate' } });
  expect(a.pending()).toBe(1);
  expect(b.pending()).toBe(1);
  source.send({ field: 'a', message: { type: 'Change', draft: 'edited' } });
  expect(a.pending()).toBe(0);
  expect(b.pending()).toBe(1);
  b.succeed('Taken');
  await Effect.runPromise(source.awaitIdle());
  expect(source.model().a).toMatchObject({ draft: 'edited', validation: 'idle' });
  expect(source.model().b).toMatchObject({
    draft: 'second',
    validation: 'invalid',
    error: 'Taken',
  });
  expect(source.model().untouched).toBe(untouched);
  expect(Object.isFrozen(source.model().a)).toBe(true);
  await Effect.runPromise(source.close());
});

it('lifts effect and stream outcomes while preserving action-only commands', async () => {
  const sideEffect = vi.fn<() => void>();
  type Message = { type: 'Start' } | { type: 'Child'; value: number };
  const child: Transition<number, number> = {
    model: 1,
    commands: [
      { slot: commandSlot('effect'), policy: 'replace', effect: Effect.succeed(2) },
      { slot: commandSlot('stream'), policy: 'replace', stream: Stream.fromIterable([3, 4]) },
      { slot: commandSlot('action'), policy: 'replace', action: Effect.sync(sideEffect) },
    ],
  };
  const source = program<{ values: readonly number[] }, Message>({
    initial: { values: [] },
    update: (model, message) =>
      message.type === 'Start'
        ? mapTransition(child, {
            model: (value) => ({ values: [value] }),
            message: (value): Message => ({ type: 'Child', value }),
          })
        : { model: { values: [...model.values, message.value] } },
  });
  source.send({ type: 'Start' });
  await Effect.runPromise(source.awaitIdle());
  expect(source.model().values).toEqual([1, 2, 3, 4]);
  expect(sideEffect).toHaveBeenCalledTimes(1);
  await Effect.runPromise(source.close());
});

it('retains slot identity, concurrency and discard delivery through lifting', async () => {
  const discarded = vi.fn();
  const slot = commandSlot('queued');
  const request = controlledEffect<number>();
  const source = program<number, 'Start' | 'Queue' | 'Cancel' | number>({
    initial: 0,
    update: (model, message) => {
      if (typeof message === 'number') return { model: message };
      const child: Transition<number, number> =
        message === 'Cancel'
          ? { model, cancel: [slot] }
          : {
              model,
              commands: [
                {
                  slot,
                  policy: message === 'Start' ? 'replace' : 'queue',
                  effect: request.effect,
                  onDiscard: discarded,
                },
              ],
            };
      return mapTransition(child, { model: (value) => value, message: (value) => value });
    },
  });
  source.send('Start');
  source.send('Queue');
  expect(request.pending()).toBe(1);
  source.send('Cancel');
  await Effect.runPromise(source.awaitIdle());
  expect(request.pending()).toBe(0);
  expect(discarded).toHaveBeenCalledWith('Cancelled');
  expect(source.model()).toBe(0);
  await Effect.runPromise(source.close());
});
