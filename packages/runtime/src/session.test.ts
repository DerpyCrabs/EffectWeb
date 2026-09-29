import { commandSlot } from './program.js';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { lifetime, sessionGroup } from './session.js';

it('releases a session group and its subscriptions when subscription setup fails', () => {
  const events: string[] = [];
  const problem = new Error('subscription failed');
  const first = {
    dispose: () => {
      events.push('first dispose');
    },
    subscribe: () => () => {
      events.push('first unsubscribe');
    },
  };
  const second = {
    dispose: () => {
      events.push('second dispose');
    },
    subscribe: () => {
      throw problem;
    },
  };
  const third = {
    dispose: () => {
      events.push('third dispose');
    },
  };
  expect(() => sessionGroup([first, second, third], () => {})).toThrow(problem);
  expect(events).toEqual(['first unsubscribe', 'third dispose', 'second dispose', 'first dispose']);
});

it('owns commands and joins their finalizers before closing lifetime resources', async () => {
  const scope = lifetime();
  const calls: string[] = [];
  scope.own({ dispose: () => calls.push('resource') });
  const slot = commandSlot('lifetime-work');
  scope.run(
    slot,
    Effect.never.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          calls.push('command');
        }),
      ),
    ),
    'drop',
  );
  expect(scope.isRunning(slot)).toBe(true);
  await Effect.runPromise(scope.close());
  expect(calls).toEqual(['command', 'resource']);
  expect(scope.disposed).toBe(true);
});
