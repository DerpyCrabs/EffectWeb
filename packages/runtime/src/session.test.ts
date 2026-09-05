import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { expect, it, vi } from 'vitest';
import { query } from './query.js';
import { makeUiModel } from './cache.js';
import { queryResource } from './session.js';

it('selects typed query arguments, shares across sessions, and clears values across account changes', async () => {
  let account = 'first';
  const load = vi.fn((id: string) => Effect.succeed(`${account}:${id}`));
  const profile = query({ name: 'profile', key: (id: string) => id, load });
  const cache = makeUiModel();
  const context = { cache, changed: vi.fn() };
  const first = queryResource(context, profile);
  const second = queryResource(context, profile);
  const value = () => Option.getOrUndefined(AsyncResult.value(first.read()));
  first.select('alice');
  second.select('alice');
  expect(value()).toBe('first:alice');
  expect(load).toHaveBeenCalledTimes(1);
  first.select(undefined);
  expect(value()).toBeUndefined();
  expect(Option.getOrUndefined(AsyncResult.value(second.read()))).toBe('first:alice');
  first.select('alice');
  expect(load).toHaveBeenCalledTimes(1);
  first.select('bob');
  expect(value()).toBe('first:bob');
  account = 'second';
  cache.resetResources();
  expect(value()).toBeUndefined();
  first.select('bob');
  expect(value()).toBe('second:bob');
  second.select('alice');
  expect(Option.getOrUndefined(AsyncResult.value(second.read()))).toBe('second:alice');
  first.dispose();
  first.select('other');
  expect(value()).toBeUndefined();
  second.dispose();
  cache.dispose();
});

it('retains same-query values during failed refreshes and does not refresh on ordinary session ticks', async () => {
  let calls = 0;
  const data = query({
    name: 'data',
    staleTime: 0,
    load: () => (++calls === 2 ? Effect.fail('offline') : Effect.succeed('cached')),
  });
  const cache = makeUiModel();
  const source = queryResource({ cache, changed() {} }, data);
  source.select(true);
  source.select(true);
  expect(calls).toBe(1);
  source.refresh();
  expect(source.read()._tag).toBe('Failure');
  expect(Option.getOrUndefined(AsyncResult.value(source.read()))).toBe('cached');
  source.refresh();
  expect(source.read()._tag).toBe('Success');
  expect(calls).toBe(3);
  source.dispose();
  cache.dispose();
});
