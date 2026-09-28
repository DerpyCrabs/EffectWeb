import { expect, test } from 'vite-plus/test';
import { Effect } from 'effect';
import { createForm } from './index.js';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
test('nested drafts are detached, validated and reset without freezing TanStack state', async () => {
  const saved: string[] = [];
  const form = createForm({
    defaultValues: { rows: [{ name: '' }] },
    validate: (values) => (values.rows[0]?.name ? {} : { 'rows[0].name': 'Required' }),
    onSubmit: (values) =>
      Effect.sync(() => {
        saved.push(values.rows[0]!.name);
      }),
    onError: String,
  });
  const initial = form.source.model();
  await Effect.runPromise(form.submit());
  await tick();
  expect(saved).toEqual([]);
  expect(form.source.model().errors['rows[0].name']).toBe('Required');
  form.setField('rows[0].name', 'Changed');
  await tick();
  expect(initial.values.rows[0]!.name).toBe('');
  expect(Object.isFrozen(form.source.model().values.rows)).toBe(true);
  await Effect.runPromise(form.submit());
  expect(saved).toEqual(['Changed']);
  form.reset();
  await tick();
  expect(form.source.model().values.rows[0]!.name).toBe('');
  expect(form.source.model().dirty).toBe(false);
  form.dispose();
});
test('drops duplicate submissions and cancels a save on disposal', async () => {
  let started = 0;
  let stopped = 0;
  const form = createForm({
    defaultValues: { name: 'Ready' },
    onSubmit: () =>
      Effect.sync(() => {
        started++;
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(
          Effect.sync(() => {
            stopped++;
          }),
        ),
      ),
    onError: String,
  });
  const pending = Effect.runPromise(form.submit());
  await tick();
  await tick();
  await Effect.runPromise(form.submit());
  form.dispose();
  await pending;
  expect(started).toBe(1);
  expect(stopped).toBe(1);
});

test('reset during validation cancels the old save and allows a new submission', async () => {
  const saved: string[] = [];
  const form = createForm({
    defaultValues: { name: 'old' },
    onSubmit: (values) =>
      Effect.sync(() => {
        saved.push(values.name);
      }),
    onError: String,
  });
  const pending = Effect.runPromise(form.submit());
  form.reset({ name: 'new' });
  await Effect.runPromise(form.submit());
  await pending;
  expect(saved).toEqual(['new']);
  expect(form.source.model().values.name).toBe('new');
  expect(form.source.model().submitError).toBeUndefined();
  form.dispose();
});
