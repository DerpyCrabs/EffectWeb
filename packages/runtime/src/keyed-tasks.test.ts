import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { modelOwner } from './owner.js';
import { keyedTasks } from './keyed-tasks.js';

it('coalesces per key, captures inputs and drains independently with typed outcomes', async () => {
  const owner = modelOwner({});
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  const tasks = keyedTasks(owner, {
    name: 'save',
    policy: 'latest-queued',
    run: (key: string, input: { version: number }) =>
      Effect.promise(async () => {
        seen.push(`${key}:${input.version}`);
        if (key === 'a' && input.version === 1) await gate;
        return input.version;
      }),
  });
  const first = tasks.submit('a', { version: 1 });
  const skipped = tasks.submit('a', { version: 2 });
  const last = tasks.submit('a', { version: 3 });
  const other = tasks.submit('b', { version: 4 });
  expect(await skipped.outcome).toEqual({ _tag: 'Superseded' });
  await tasks.drain('b');
  expect(await other.outcome).toEqual({ _tag: 'Success', value: 4 });
  let drained = false;
  const drain = tasks.drain('a').then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  release();
  await drain;
  expect(await first.outcome).toEqual({ _tag: 'Success', value: 1 });
  expect(await last.outcome).toEqual({ _tag: 'Success', value: 3 });
  expect(seen).toEqual(['a:1', 'b:4', 'a:3']);
  await owner.close();
});

it('settles dropped, canceled queued and failed work without rejecting handle promises', async () => {
  const owner = modelOwner({});
  const dropped = keyedTasks(owner, {
    name: 'drop',
    policy: 'drop',
    run: (_key: string, _input: number) => Effect.never,
  });
  const active = dropped.submit('a', 1);
  expect(await dropped.submit('a', 2).outcome).toEqual({ _tag: 'Dropped' });
  dropped.cancel('a');
  expect(await active.outcome).toEqual({ _tag: 'Cancelled' });
  const queued = keyedTasks(owner, {
    name: 'queue',
    policy: 'queue',
    run: (_key: string, value: number) => (value === 0 ? Effect.fail('typed') : Effect.never),
  });
  expect((await queued.submit('b', 0).outcome)._tag).toBe('Failure');
  const one = queued.submit('a', 1),
    two = queued.submit('a', 2);
  await owner.close();
  expect(await one.outcome).toEqual({ _tag: 'Cancelled' });
  expect(await two.outcome).toEqual({ _tag: 'Cancelled' });
});

it.each(['replace', 'parallel'] as const)(
  'settles %s handles and drains interrupted finalizers before closing',
  async (policy) => {
    const owner = modelOwner({});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tasks = keyedTasks(owner, {
      name: policy,
      policy,
      run: (_key: string, input: number) =>
        input === 0
          ? Effect.never.pipe(Effect.ensuring(Effect.promise(() => gate)))
          : Effect.succeed(input),
    });
    const first = tasks.submit('a', 0);
    const second = tasks.submit('a', 1);
    expect(await second.outcome).toEqual({ _tag: 'Success', value: 1 });
    tasks.cancel('a');
    let drained = false;
    const pending = tasks.drain('a').then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await pending;
    expect(await first.outcome).toEqual({ _tag: 'Cancelled' });
    expect(await tasks.submit('a', 2).outcome).toEqual({ _tag: 'Success', value: 2 });
    await owner.close();
  },
);

it('reads the current service revision when a captured queued document starts', async () => {
  const owner = modelOwner({});
  let revision = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: number[] = [];
  const tasks = keyedTasks(owner, {
    name: 'revisions',
    policy: 'queue',
    run: (_key: string, input: { content: string }) =>
      Effect.promise(async () => {
        seen.push(revision);
        if (input.content === 'first') await gate;
        return ++revision;
      }),
  });
  const first = tasks.submit('a', { content: 'first' });
  const document = { content: 'second' };
  const second = tasks.submit('a', document);
  expect(Object.isFrozen(document)).toBe(true);
  release();
  await tasks.drain('a');
  expect(seen).toEqual([0, 1]);
  expect(await first.outcome).toEqual({ _tag: 'Success', value: 1 });
  expect(await second.outcome).toEqual({ _tag: 'Success', value: 2 });
  await owner.close();
});
