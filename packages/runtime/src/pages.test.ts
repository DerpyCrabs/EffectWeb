import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { pages, type PagesMessage, type PagesModel } from './pages.js';
import { mapCommand, program } from './program.js';
import { available, resourceError } from './resource.js';
import type { UiLoad, UiPage } from './load.js';

type Item = { id: number };
type Page = UiPage<Item, number>;
type Input = { key?: string; load: (cursor: number | undefined) => UiLoad<Page> };
type Model = PagesModel<Input, Item, number>;
type Message = PagesMessage<Item, number> | { type: 'Context'; input: Input; refresh?: boolean };
const page = (ids: number[], next?: number): Page => ({ items: ids.map((id) => ({ id })), next });
const settle = () => new Promise((done) => setTimeout(done, 0));
const make = () => {
  const pagination = pages<Input, Item, number>({
    key: (input) => input.key,
    load: (input, cursor) => input.load(cursor),
    itemKey: (item) => String(item.id),
  });
  return program<Model, Message>({
    initial: pagination.init({ load: () => Effect.never }),
    update: (model, message) =>
      message.type === 'Context'
        ? pagination.receive(model, message.input, { refresh: message.refresh ?? false })
        : pagination.update(model, message),
  });
};
const ids = (model: Model) => available(model.result)?.items.map((item) => item.id);

it('isolates pagination definitions composed into the same parent program', async () => {
  const definition = (id: number) =>
    pages<string, Item, number>({
      key: (key) => key,
      load: () => Effect.succeed(page([id])),
      itemKey: (item) => String(item.id),
    });
  const left = definition(1);
  const right = definition(2);
  type Parent = { left: PagesModel<string, Item, number>; right: PagesModel<string, Item, number> };
  type Message = { type: 'Init' } | { type: 'Left' | 'Right'; message: PagesMessage<Item, number> };
  const source = program<Parent, Message>({
    initial: { left: left.init('left'), right: right.init('right') },
    update: (model, message) => {
      if (message.type === 'Init') {
        const a = left.receive(model.left, 'left');
        const b = right.receive(model.right, 'right');
        return {
          model: { left: a.model, right: b.model },
          commands: [
            ...(a.commands ?? []).map((command) =>
              mapCommand(command, (message): Message => ({ type: 'Left', message })),
            ),
            ...(b.commands ?? []).map((command) =>
              mapCommand(command, (message): Message => ({ type: 'Right', message })),
            ),
          ],
        };
      }
      return {
        model:
          message.type === 'Left'
            ? { ...model, left: left.update(model.left, message.message).model }
            : { ...model, right: right.update(model.right, message.message).model },
      };
    },
  });
  try {
    source.send({ type: 'Init' });
    await Effect.runPromise(source.awaitIdle());
    expect(available(source.model().left.result)?.items).toEqual([{ id: 1 }]);
    expect(available(source.model().right.result)?.items).toEqual([{ id: 2 }]);
    expect(source.model().left.result.waiting).toBe(false);
  } finally {
    source.dispose();
  }
});

describe('owned pagination', () => {
  it('deduplicates first and appended pages, retains results and retries the failed cursor', async () => {
    const source = make();
    const cursors: Array<number | undefined> = [];
    source.send({
      type: 'Context',
      input: {
        key: 'a',
        load: (cursor) => {
          cursors.push(cursor);
          return cursors.length === 2
            ? Effect.fail('offline')
            : Effect.succeed(cursor === undefined ? page([1, 1, 2], 5) : page([2, 3, 3]));
        },
      },
    });
    await settle();
    expect(ids(source.model())).toEqual([1, 2]);
    source.send({ type: 'More' });
    await settle();
    expect(ids(source.model())).toEqual([1, 2]);
    expect(source.model().result.waiting).toBe(false);
    expect(resourceError(source.model().result)).toBe('offline');
    source.send({ type: 'Retry' });
    await settle();
    expect(ids(source.model())).toEqual([1, 2, 3]);
    expect(cursors).toEqual([undefined, 5, 5]);
    source.send({ type: 'More' });
    await settle();
    expect(cursors).toHaveLength(3);
    source.dispose();
  });

  it('ignores repeated load-more while pending, then refreshes from the first page', async () => {
    const source = make();
    let calls = 0;
    let appendCanceled = false;
    let completeAppend!: (page: Page) => void;
    source.send({
      type: 'Context',
      input: {
        key: 'a',
        load: () => {
          calls++;
          return calls === 2
            ? Effect.callback<Page>((resume) => {
                completeAppend = (value) => resume(Effect.succeed(value));
                return Effect.sync(() => {
                  appendCanceled = true;
                });
              })
            : Effect.succeed(page([calls], 5));
        },
      },
    });
    await settle();
    source.send({ type: 'More' });
    await settle();
    source.send({ type: 'More' });
    expect(calls).toBe(2);
    expect(ids(source.model())).toEqual([1]);
    source.send({ type: 'Refresh' });
    await settle();
    completeAppend(page([99]));
    await settle();
    expect(appendCanceled).toBe(true);
    expect(ids(source.model())).toEqual([3]);
    expect(source.model().append).toBe(false);
    source.dispose();
  });

  it('clears values across keys, cancels obsolete work, and disables absent keys', async () => {
    const source = make();
    let complete!: (page: Page) => void;
    let canceled = 0;
    source.send({ type: 'Context', input: { key: 'a', load: () => Effect.succeed(page([1])) } });
    await settle();
    source.send({
      type: 'Context',
      input: {
        key: 'b',
        load: () =>
          Effect.callback<Page>((resume) => {
            complete = (value) => resume(Effect.succeed(value));
            return Effect.sync(() => {
              canceled++;
            });
          }),
      },
    });
    expect(ids(source.model())).toBeUndefined();
    await settle();
    let calls = 0;
    source.send({
      type: 'Context',
      input: {
        load: () => {
          calls++;
          return Effect.succeed(page([3]));
        },
      },
    });
    await settle();
    complete(page([99]));
    source.send({ type: 'More' });
    source.send({ type: 'Retry' });
    source.send({ type: 'Refresh' });
    await settle();
    expect(canceled).toBe(1);
    expect(calls).toBe(0);
    expect(source.model().result._tag).toBe('Initial');
    expect(source.model().result.waiting).toBe(false);
    source.dispose();
  });

  it('uses the current producer when a same-key request is explicitly refreshed', async () => {
    const source = make();
    source.send({ type: 'Context', input: { key: 'a', load: () => Effect.succeed(page([1])) } });
    await settle();
    source.send({ type: 'Context', input: { key: 'a', load: () => Effect.succeed(page([2])) } });
    expect(ids(source.model())).toEqual([1]);
    source.send({ type: 'Refresh' });
    await settle();
    expect(ids(source.model())).toEqual([2]);
    source.send({
      type: 'Context',
      refresh: true,
      input: { key: 'a', load: () => Effect.succeed(page([3])) },
    });
    await settle();
    expect(ids(source.model())).toEqual([3]);
    source.dispose();
  });

  it.each(['typed', 'defect', 'throw'] as const)(
    'settles a %s failure and retains the successful page',
    async (kind) => {
      const source = make();
      source.send({ type: 'Context', input: { key: 'a', load: () => Effect.succeed(page([1])) } });
      await settle();
      source.send({
        type: 'Context',
        refresh: true,
        input: {
          key: 'a',
          load: () => {
            if (kind === 'throw') throw new Error('broken');
            return kind === 'defect' ? Effect.die(new Error('broken')) : Effect.fail('broken');
          },
        },
      });
      await settle();
      expect(source.model().result._tag).toBe('Failure');
      expect(source.model().result.waiting).toBe(false);
      expect(ids(source.model())).toEqual([1]);
      expect(resourceError(source.model().result)).toContain('broken');
      source.dispose();
    },
  );

  it('interrupts pending requests when disposed', async () => {
    let canceled = false;
    const source = make();
    source.send({
      type: 'Context',
      input: {
        key: 'a',
        load: () =>
          Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                canceled = true;
              }),
            ),
          ),
      },
    });
    await settle();
    source.dispose();
    await settle();
    expect(canceled).toBe(true);
  });
});

it('owns controller pagination and reconciles unchanged inputs without another publication', async () => {
  const definition = pages<{ id?: string }, Item, number>({
    key: (props) => props.id,
    itemKey: (item) => String(item.id),
    load: () => Effect.succeed(page([1], 2)),
  });
  const source = definition.create({ id: 'one' });
  await Effect.runPromise(source.awaitIdle());
  let publications = 0;
  source.subscribe(() => {
    publications++;
  });
  source.receive({ id: 'one' });
  expect(publications).toBe(0);
  source.receive({});
  expect(available(source.model().result)).toBeUndefined();
  source.send({ type: 'More' });
  expect(source.activeSlots()).toEqual([]);
  source.dispose();
  const finalPublications = publications;
  source.receive({ id: 'two' });
  expect(source.activeSlots()).toEqual([]);
  expect(publications).toBe(finalPublications);
});
