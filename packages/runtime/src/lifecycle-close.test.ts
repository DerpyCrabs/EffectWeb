import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { expect, it } from 'vitest';
import { modelOwner } from './owner.js';
import { commandSlot } from './program.js';

it('joins replaced and active finalizers before closing dependencies, once', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const owner = modelOwner({});
      const order: string[] = [];
      const gate = Deferred.makeUnsafe<void>();
      owner.own({
        dispose: () => {
          order.push('dependency');
        },
      });
      const slot = commandSlot('work');
      owner.run(
        slot,
        Effect.never.pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              order.push('start');
              yield* Deferred.await(gate);
              order.push('end');
            }),
          ),
        ),
        'replace',
      );
      owner.run(slot, Effect.never, 'replace');
      const close = owner.close();
      expect(owner.close()).toBe(close);
      expect(owner.disposed).toBe(false);
      const first = Effect.runFork(close);
      const second = Effect.runFork(close);
      yield* owner.awaitIdle();
      expect(order).toEqual(['start']);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      yield* close;
      expect(order).toEqual(['start', 'end', 'dependency']);
    }),
  ));

it('runs every dependency close in reverse order and preserves failures and defects', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const owner = modelOwner({});
      const order: number[] = [];
      const failure = new Error('failed');
      const defect = new Error('defect');
      owner.own({
        dispose: () => {
          order.push(1);
        },
      });
      owner.own({
        dispose() {},
        close: () =>
          Effect.suspend(() => {
            order.push(2);
            return Effect.fail(failure);
          }),
      });
      owner.own({
        dispose() {},
        close: () =>
          Effect.suspend(() => {
            order.push(3);
            return Effect.die(defect);
          }),
      });
      const exit = yield* Effect.exit(owner.close());
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause) as AggregateError;
        expect(error.message).toBe('Owner cleanup failed.');
        expect(error.errors).toEqual([defect, failure]);
      }
      expect(order).toEqual([3, 2, 1]);
    }),
  ));

it('tracks closure executed while synchronous work is starting', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const owner = modelOwner({});
      let closed!: Fiber.Fiber<void, AggregateError>;
      let finalized = false;
      owner.run(
        commandSlot('reentrant'),
        Effect.sync(() => {
          closed = Effect.runFork(owner.close());
        }).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              finalized = true;
            }),
          ),
        ),
        'replace',
      );
      yield* Fiber.join(closed);
      expect(finalized).toBe(true);
    }),
  ));

it('returns the same close Effect to a reentrant cancellation finalizer', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const owner = modelOwner({});
      let inside: Effect.Effect<void, AggregateError> | undefined;
      owner.run(
        commandSlot('reentrant-close'),
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              inside = owner.close();
            }),
          ),
        ),
        'replace',
      );
      const outside = owner.close();
      yield* outside;
      expect(inside).toBe(outside);
    }),
  ));

it('joins owned resource finalizers after synchronous disposal without disposing twice', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const owner = modelOwner({});
      const gate = Deferred.makeUnsafe<void>();
      let disposed = 0;
      let closed = 0;
      owner.own({
        dispose: () => {
          disposed++;
        },
      });
      owner.own({
        dispose: () => {
          disposed++;
        },
        close: () =>
          Effect.gen(function* () {
            yield* Deferred.await(gate);
            closed++;
          }),
      });
      owner.dispose();
      const closing = Effect.runFork(owner.close());
      expect(disposed).toBe(2);
      expect(closed).toBe(0);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(closing);
      expect(disposed).toBe(2);
      expect(closed).toBe(1);
    }),
  ));
