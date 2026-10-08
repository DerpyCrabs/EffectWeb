/* oxlint-disable effecttsgo/missing-effect-error -- Negative type contracts pass Effects whose errors do not fit. */
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { component } from './component.js';
import { view } from './dom.js';
import { modelOwner, type ModelFields, type ModelOwner } from './owner.js';
import { program } from './program.js';

// A result field declared with `AsyncResult.initial<A, E>()` holds every outcome.
export function ownerResultFields() {
  const owner = modelOwner({
    text: '',
    rows: [] as readonly string[],
    saved: AsyncResult.initial<number, Error>(),
    loaded: AsyncResult.success(1),
    nested: { inner: AsyncResult.initial<string>() },
  });
  const saved: AsyncResult.AsyncResult<number, Error> = owner.read().saved;
  void saved;
  const loaded: AsyncResult.AsyncResult<number, never> = owner.read().loaded;
  void loaded;
  const text: string = owner.read().text;
  void text;
  const rows: readonly string[] = owner.read().rows;
  void rows;
  owner.patch({ saved: AsyncResult.success(2) });
  owner.patch({ saved: AsyncResult.fail(new Error('x')) });
  owner.patch({ loaded: AsyncResult.initial() });
  owner.task('saved', Effect.succeed(1), 'drop');
  owner.task('saved', Effect.fail(new Error('x')), 'replace');
  // @ts-expect-error The error type comes from the declared field.
  owner.patch({ saved: AsyncResult.fail('offline') });
  // @ts-expect-error The value type comes from the declared field.
  owner.task('saved', Effect.succeed('text'), 'drop');
  // Only the model's own fields widen; nested results keep the type they were written with.
  const inner: AsyncResult.Initial<string, never> = owner.read().nested.inner;
  void inner;
}

// A declared model type is published unchanged.
type Declared = { readonly saved: AsyncResult.AsyncResult<void, string>; readonly count: number };
export function declaredModel(initial: Declared): ModelOwner<Declared> {
  const owner = modelOwner(initial);
  const model: Declared = owner.read();
  void model;
  const fields: ModelFields<Declared> = initial;
  void fields;
  return owner;
}

export const Saver = component(
  {
    init: (_props: { readonly id: string }) => ({
      draft: '',
      saved: AsyncResult.initial<number, string>(),
    }),
  },
  (owner) =>
    view((model) => {
      const saved: AsyncResult.AsyncResult<number, string> = model.saved;
      void saved;
      owner.task('saved', Effect.succeed(1), 'drop');
      owner.patch({ saved: AsyncResult.success(1) });
      // @ts-expect-error The Effect's error must fit the field's error type.
      owner.task('saved', Effect.fail(new Error('x')), 'drop');
      return null;
    }),
);

export const Reducer = component(
  {
    init: (_props: { readonly id: string }) => ({ saved: AsyncResult.initial<number, string>() }),
    update: (model, message: { type: 'Saved'; value: number }) => ({
      model: { ...model, saved: AsyncResult.success(message.value) },
    }),
  },
  view((model) => {
    const saved: AsyncResult.AsyncResult<number, string> = model.saved;
    void saved;
    return null;
  }),
);

export function programResultFields() {
  const running = program({
    initial: { count: 0, loaded: AsyncResult.initial<string, Error>() },
    update: (model, message: { type: 'Loaded'; value: string }) => ({
      model: { ...model, loaded: AsyncResult.success(message.value) },
    }),
  });
  const loaded: AsyncResult.AsyncResult<string, Error> = running.model().loaded;
  void loaded;
  return running;
}
