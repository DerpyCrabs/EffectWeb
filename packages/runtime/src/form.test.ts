import { describe, expect, it } from 'vitest';
import { inputChecked, inputNumber, inputText, submit } from './form.js';
import { Effect } from 'effect';
import { effectEvent } from './effectEvent.js';

describe('native form event adapters', () => {
  it('captures native values on each invocation without retaining the event', () => {
    const values: string[] = [];
    const input = { value: '途中' };
    const handle = inputText((value) => {
      values.push(value);
    });
    handle({ currentTarget: input });
    input.value = '完了';
    handle({ currentTarget: input });
    expect(values).toEqual(['途中', '完了']);
    const checked: boolean[] = [];
    inputChecked((value) => {
      checked.push(value);
    })({ currentTarget: { checked: false } });
    expect(checked).toEqual([false]);
  });
  it('distinguishes an empty numeric input from zero', () => {
    const values: Array<number | undefined> = [];
    const handle = inputNumber((value) => {
      values.push(value);
    });
    for (const valueAsNumber of [NaN, 0, -2.5]) handle({ currentTarget: { valueAsNumber } });
    expect(values).toEqual([undefined, 0, -2.5]);
  });
  it('prevents every submit synchronously and forwards an owned effect request', () => {
    let prevented = 0;
    const request = effectEvent('drop', () => Effect.void);
    const handle = submit(() => request({} as Event));
    const first = handle({
      preventDefault() {
        prevented++;
      },
    });
    const second = handle({
      preventDefault() {
        prevented++;
      },
    });
    expect(prevented).toBe(2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
  });
});

// @ts-expect-error A cold Effect needs an owned effectEvent, task or command.
inputText(() => Effect.void);
// @ts-expect-error A Promise needs adaptation and an owner.
submit(() => Promise.resolve());

import { Cause, Deferred } from 'effect';
import { defineField, type FieldResult } from './form.js';
import { program } from './program.js';

const parseQuantity = (draft: string): FieldResult<number> =>
  /^\d+$/.test(draft) && Number(draft) > 0
    ? { ok: true, value: Number(draft) }
    : { ok: false, error: 'Enter a positive whole number.' };

describe('immutable fields', () => {
  it('keeps drafts separate from parsed values, delays errors and restores the baseline', () => {
    const field = defineField({ id: 'quantity', parse: parseQuantity });
    const initial = Object.freeze(field.init('02'));
    expect(initial.parsed).toEqual({ ok: true, value: 2 });
    const changed = field.update(initial, { type: 'Change', draft: '-' }).model;
    expect(changed).toMatchObject({ draft: '-', dirty: true, touched: false, error: undefined });
    expect(changed.parsed.ok).toBe(false);
    const blurred = field.update(changed, { type: 'Blur' }).model;
    expect(blurred).toMatchObject({
      touched: true,
      validation: 'invalid',
      error: 'Enter a positive whole number.',
    });
    const reset = field.update(blurred, { type: 'Reset' }).model;
    expect(reset).toMatchObject({
      draft: '02',
      dirty: false,
      touched: false,
      validation: 'idle',
      error: undefined,
    });
    expect(initial.draft).toBe('02');
    const baseline = field.update(changed, { type: 'Reset', draft: '3' }).model;
    expect(field.update(baseline, { type: 'Change', draft: '3' }).model.dirty).toBe(false);
    expect(field.update(changed, { type: 'Change', draft: '02' }).model.dirty).toBe(false);
  });

  it('makes change, blur and explicit submit validation distinct', () => {
    for (const validateOn of ['change', 'blur', 'submit'] as const) {
      const field = defineField({ id: 'quantity', parse: parseQuantity, validateOn });
      const change = field.update(field.init('1'), { type: 'Change', draft: '' }).model;
      expect(change.validation).toBe(validateOn === 'change' ? 'invalid' : 'idle');
      const blur = field.update(change, { type: 'Blur' }).model;
      expect(blur.touched).toBe(true);
      expect(blur.validation).toBe(validateOn === 'submit' ? 'idle' : 'invalid');
      const submit = field.update(blur, { type: 'Validate' }).model;
      expect(submit.validation).toBe('invalid');
    }
  });

  it('supports checkbox drafts and an explicit false reset baseline', () => {
    const field = defineField<boolean, boolean>({
      id: 'terms',
      parse: (value) => ({ ok: true, value }),
    });
    const initial = field.init(true);
    const reset = field.update(initial, { type: 'Reset', draft: false }).model;
    expect(reset.draft).toBe(false);
    expect(reset.initial).toBe(false);
  });

  it('never runs async validation for invalid parses and settles typed failures and defects', async () => {
    let checks = 0;
    const field = defineField({
      id: 'quantity',
      parse: parseQuantity,
      validate: () => {
        checks++;
        return Effect.fail('offline');
      },
      onFailure: (cause) => Cause.pretty(cause),
    });
    const source = program({ initial: field.init(''), update: field.update });
    source.send({ type: 'Validate' });
    expect(checks).toBe(0);
    source.send({ type: 'Change', draft: '2' });
    source.send({ type: 'Validate' });
    await Effect.runPromise(source.awaitIdle());
    expect(source.model().validation).toBe('invalid');
    expect(source.model().error).toContain('offline');
    expect(checks).toBe(1);
    source.dispose();

    const defective = defineField({
      id: 'broken',
      parse: parseQuantity,
      validate: () => {
        throw new Error('defect');
      },
    });
    const broken = program({ initial: defective.init('1'), update: defective.update });
    broken.send({ type: 'Validate' });
    await Effect.runPromise(broken.awaitIdle());
    expect(broken.model().error).toBe('Validation is unavailable. Try again.');
    broken.dispose();
  });

  it('ignores stale settlements after editing, reset and a newer validation', () => {
    const field = defineField({
      id: 'quantity',
      parse: parseQuantity,
      validate: () => Effect.never,
    });
    const pending = field.update(field.init('1'), { type: 'Validate' }).model;
    for (const message of [
      { type: 'Change', draft: '2' },
      { type: 'Reset' },
      { type: 'Validate' },
    ] as const) {
      const next = field.update(pending, message).model;
      expect(
        field.update(next, { type: 'Validated', revision: pending.revision, error: 'stale' }).model,
      ).toBe(next);
    }
    const settled = field.update(pending, {
      type: 'Validated',
      revision: pending.revision,
      error: undefined,
    }).model;
    expect(settled.validation).toBe('valid');
    expect(
      field.update(settled, { type: 'Validated', revision: pending.revision, error: 'duplicate' })
        .model,
    ).toBe(settled);
  });

  it('cancels owned validators on edit, reset and disposal and publishes only the latest result', async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const replies = new Map<string, Deferred.Deferred<string | undefined>>();
    const field = defineField({
      id: 'username',
      validateOn: 'change',
      parse: (draft: string): FieldResult<string> => ({ ok: true, value: draft }),
      validate: (value) =>
        Effect.gen(function* () {
          started.push(value);
          const reply = yield* Deferred.make<string | undefined>();
          replies.set(value, reply);
          return yield* Deferred.await(reply).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                stopped.push(value);
              }),
            ),
          );
        }),
    });
    const source = program({ initial: field.init(''), update: field.update });
    source.send({ type: 'Change', draft: 'old' });
    source.send({ type: 'Change', draft: 'new' });
    await Effect.runPromise(Deferred.succeed(replies.get('old')!, 'Taken'));
    await Effect.runPromise(Deferred.succeed(replies.get('new')!, undefined));
    await Effect.runPromise(source.awaitIdle());
    expect(source.model()).toMatchObject({ draft: 'new', validation: 'valid', error: undefined });
    source.send({ type: 'Change', draft: 'reset' });
    source.send({ type: 'Reset' });
    await Effect.runPromise(source.awaitIdle());
    expect(source.model()).toMatchObject({ draft: '', validation: 'idle' });
    source.send({ type: 'Change', draft: 'dispose' });
    source.dispose();
    await Effect.runPromise(Effect.yieldNow);
    expect(started).toEqual(['old', 'new', 'reset', 'dispose']);
    expect(stopped).toEqual(['old', 'new', 'reset', 'dispose']);
  });
});
