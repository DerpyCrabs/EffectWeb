import { expect, test } from 'vite-plus/test';
import { Effect } from 'effect';
import { createField, createForm } from './index.js';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('form validators gate submission and publish TanStack state as frozen snapshots', async () => {
  const saved: string[] = [];
  const form = createForm({
    defaultValues: { rows: [{ name: '' }] },
    validators: {
      onSubmit: ({ value }) =>
        value.rows[0]?.name ? undefined : { fields: { 'rows[0].name': 'Required' } },
    },
    onSubmit: ({ value }) =>
      Effect.sync(() => {
        saved.push(value.rows[0]!.name);
      }),
  });
  const initial = form.source.model();
  await Effect.runPromise(form.submit());
  await tick();
  expect(saved).toEqual([]);
  expect(form.source.model().fieldMeta['rows[0].name']?.errors).toEqual(['Required']);
  expect(form.source.model().isSubmitSuccessful).toBe(false);
  form.handleChange('rows[0].name', 'Changed');
  await tick();
  expect(initial.values.rows[0]!.name).toBe('');
  expect(Object.isFrozen(form.source.model().values.rows)).toBe(true);
  expect(form.source.model().isDirty).toBe(true);
  await Effect.runPromise(form.submit());
  expect(saved).toEqual(['Changed']);
  expect(form.source.model().isSubmitSuccessful).toBe(true);
  form.reset();
  await tick();
  expect(form.source.model().values.rows[0]!.name).toBe('');
  expect(form.source.model().isDirty).toBe(false);
  expect(form.source.model().submissionAttempts).toBe(0);
  form.dispose();
});

test('drops duplicate submissions and interrupts an Effect save on disposal', async () => {
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
  });
  const pending = Effect.runPromise(form.submit());
  await flush();
  await Effect.runPromise(form.submit());
  expect(form.source.model().isSubmitting).toBe(true);
  form.dispose();
  await pending;
  expect(started).toBe(1);
  expect(stopped).toBe(1);
});

test('a rejected save becomes submitError until the next edit', async () => {
  const form = createForm({
    defaultValues: { name: 'x' },
    onSubmit: () => Effect.fail(new Error('Offline')),
    onError: (error) => `Save failed: ${error instanceof Error ? error.message : String(error)}`,
  });
  await Effect.runPromise(form.submit());
  await tick();
  expect(form.source.model().submitError).toBe('Save failed: Offline');
  expect(form.source.model().isSubmitSuccessful).toBe(false);
  form.setFieldValue('name', 'y');
  await tick();
  expect(form.source.model().submitError).toBeUndefined();
  form.dispose();
});

test('async form validators with debounce run through TanStack and block submission', async () => {
  let saved = 0;
  const form = createForm({
    defaultValues: { name: 'taken' },
    asyncDebounceMs: 0,
    validators: {
      onChangeAsync: async ({ value }) =>
        value.name === 'taken' ? { fields: { name: 'Already used' } } : undefined,
    },
    onSubmit: () =>
      Effect.sync(() => {
        saved++;
      }),
  });
  form.handleChange('name', 'taken');
  await flush();
  await tick();
  expect(form.source.model().fieldMeta.name?.errors).toEqual(['Already used']);
  expect(form.source.model().canSubmit).toBe(false);
  await Effect.runPromise(form.submit());
  expect(saved).toBe(0);
  form.handleChange('name', 'free');
  await flush();
  await tick();
  expect(form.source.model().fieldMeta.name?.errors).toEqual([]);
  await Effect.runPromise(form.submit());
  expect(saved).toBe(1);
  form.dispose();
});

test('fields mount their own validators and listeners and publish value with meta', async () => {
  const form = createForm({ defaultValues: { email: '', tags: ['a'] } });
  const changes: string[] = [];
  const email = createField(form, {
    name: 'email',
    validators: {
      onChange: ({ value }) => (value.includes('@') ? undefined : 'Enter an email'),
      onBlur: ({ value }) => (value ? undefined : 'Required'),
    },
    listeners: { onChange: ({ value }) => changes.push(value) },
  });
  expect(email.source.model()).toMatchObject({ value: '', meta: { isTouched: false } });
  email.handleChange('nope');
  await tick();
  expect(email.source.model().meta.errors).toEqual(['Enter an email']);
  expect(email.source.model().meta.isDirty).toBe(true);
  expect(form.source.model().fieldMeta.email?.errors).toEqual(['Enter an email']);
  expect(form.source.model().isFieldsValid).toBe(false);
  email.handleChange('a@b');
  await tick();
  expect(email.source.model().meta.errors).toEqual([]);
  expect(changes).toEqual(['nope', 'a@b']);
  email.handleChange('');
  email.handleBlur();
  await tick();
  expect(email.source.model().meta.isBlurred).toBe(true);
  expect(email.source.model().meta.errorMap.onBlur).toBe('Required');
  const tags = createField(form, { name: 'tags' });
  tags.pushValue('b');
  tags.insertValue(0, 'z');
  tags.swapValues(0, 2);
  await tick();
  expect(tags.source.model().value).toEqual(['b', 'a', 'z']);
  tags.removeValue(1);
  tags.moveValue(0, 1);
  await tick();
  expect(form.values().tags).toEqual(['z', 'b']);
  expect(Object.isFrozen(tags.source.model().value)).toBe(true);
  tags.dispose();
  email.dispose();
  form.dispose();
});

test('form-level array helpers and reset keep TanStack as the owner of the draft', async () => {
  const form = createForm({ defaultValues: { items: [{ id: 1 }, { id: 2 }] } });
  form.pushFieldValue('items', { id: 3 });
  await form.removeFieldValue('items', 0);
  form.moveFieldValues('items', 0, 1);
  await tick();
  expect(form.values().items).toEqual([{ id: 3 }, { id: 2 }]);
  expect(form.getFieldValue('items[0].id')).toBe(3);
  form.clearFieldValues('items');
  await tick();
  expect(form.source.model().values.items).toEqual([]);
  form.reset({ items: [{ id: 9 }] });
  await tick();
  expect(form.source.model().values.items).toEqual([{ id: 9 }]);
  expect(form.source.model().isDirty).toBe(false);
  form.dispose();
});

test('form listeners and update follow TanStack semantics', async () => {
  const seen: string[] = [];
  const form = createForm({
    defaultValues: { name: '' },
    listeners: { onChange: ({ formApi }) => seen.push(formApi.state.values.name) },
  });
  form.handleChange('name', 'a');
  form.update({
    listeners: { onChange: ({ formApi }) => seen.push(`2:${formApi.state.values.name}`) },
  });
  form.handleChange('name', 'b');
  await tick();
  expect(seen).toEqual(['a', '2:b']);
  expect(() => form.handleChange('name', 'c')).not.toThrow();
  form.dispose();
  expect(() => form.setFieldValue('name', 'd')).toThrow('disposed');
});
