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

test('publishes touched, dirty and errors for nested fields without mutating old snapshots', async () => {
  const form = createForm({
    defaultValues: { user: { name: '' } },
    validate: (values) => (values.user.name ? {} : { 'user.name': 'Required' }),
    onSubmit: () => Effect.void,
    onError: String,
  });
  const before = form.source.model();
  form.setTouched('user.name');
  expect(await Effect.runPromise(form.validate())).toBe(false);
  await tick();
  expect(form.source.model().fields['user.name']).toEqual({
    touched: true,
    dirty: false,
    error: 'Required',
  });
  form.setField('user.name', 'Ada');
  await tick();
  expect(form.source.model().fields['user.name']).toEqual({
    touched: true,
    dirty: true,
    error: undefined,
  });
  expect(before.fields).toEqual({});
  form.reset();
  await tick();
  expect(form.source.model().fields).toEqual({});
  form.dispose();
});

test('async validation blocks submission and exposes validation failures separately from saves', async () => {
  let saved = 0;
  let unavailable = false;
  const form = createForm({
    defaultValues: { name: 'taken' },
    validateAsync: ({ name }) =>
      unavailable
        ? Effect.fail(new Error('Offline'))
        : Effect.succeed(name === 'taken' ? { name: 'Already used' } : {}),
    onSubmit: () =>
      Effect.sync(() => {
        saved++;
      }),
    onError: String,
  });
  await Effect.runPromise(form.submit());
  expect(saved).toBe(0);
  expect(form.source.model().errors.name).toBe('Already used');
  form.setField('name', 'available');
  unavailable = true;
  await Effect.runPromise(form.submit());
  expect(saved).toBe(0);
  expect(form.source.model().validationError).toContain('Offline');
  expect(form.source.model().submitError).toBeUndefined();
  unavailable = false;
  await Effect.runPromise(form.submit());
  expect(saved).toBe(1);
  expect(form.source.model().validationError).toBeUndefined();
  form.dispose();
});

for (const action of ['edit', 'reset', 'dispose', 'replace', 'interrupt'] as const) {
  test(`${action} cancels validation and prevents obsolete errors from publishing`, async () => {
    let finish!: (errors: { name?: string }) => void;
    let aborted = false;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const form = createForm({
      defaultValues: { name: 'old' },
      validateAsync: () =>
        Effect.promise((signal) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
            },
            { once: true },
          );
          began();
          return new Promise<{ name?: string }>((resolve) => {
            finish = resolve;
          });
        }),
      onSubmit: () => Effect.void,
      onError: String,
    });
    const caller = new AbortController();
    const pending = Effect.runPromise(form.validate(), { signal: caller.signal }).catch(
      () => false,
    );
    await started;
    await tick();
    expect(form.source.model().validating).toBe(true);
    const oldFinish = finish;
    let replacement: Promise<boolean> | undefined;
    if (action === 'edit') form.setField('name', 'new');
    if (action === 'reset') form.reset({ name: 'new' });
    if (action === 'dispose') form.dispose();
    if (action === 'replace') replacement = Effect.runPromise(form.validate());
    if (action === 'interrupt') caller.abort();
    await tick();
    expect(aborted).toBe(true);
    oldFinish({ name: 'Obsolete' });
    expect(await pending).toBe(false);
    if (replacement) {
      finish({});
      expect(await replacement).toBe(true);
    }
    await tick();
    expect(form.source.model().errors.name).toBeUndefined();
    form.dispose();
  });
}

test('reset during async submit validation cannot save the previous draft', async () => {
  const saves: string[] = [];
  let finish!: (errors: {}) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const form = createForm({
    defaultValues: { name: 'old' },
    validateAsync: ({ name }) =>
      name === 'old'
        ? Effect.promise(() => {
            began();
            return new Promise<{}>((resolve) => {
              finish = resolve;
            });
          })
        : Effect.succeed({}),
    onSubmit: ({ name }) =>
      Effect.sync(() => {
        saves.push(name);
      }),
    onError: String,
  });
  const previous = Effect.runPromise(form.submit());
  await started;
  form.reset({ name: 'new' });
  await Effect.runPromise(form.submit());
  finish({});
  await previous;
  expect(saves).toEqual(['new']);
  expect(form.source.model().validating).toBe(false);
  expect(form.source.model().submitting).toBe(false);
  form.dispose();
});
