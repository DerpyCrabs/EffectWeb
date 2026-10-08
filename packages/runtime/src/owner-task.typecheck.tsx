/* oxlint-disable effecttsgo/missing-effect-error -- Negative type contracts pass Effects whose errors do not fit. */
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { component } from './component.js';
import { view } from './dom.js';
import { modelOwner } from './owner.js';

export function taskKeys() {
  const owner = modelOwner<{
    saved: AsyncResult.AsyncResult<number, string>;
    loose: AsyncResult.AsyncResult<unknown, unknown>;
    sending: Partial<Record<string, AsyncResult.AsyncResult<number, string>>>;
    label: string;
  }>({ saved: AsyncResult.initial(), loose: AsyncResult.initial(), sending: {}, label: '' });
  owner.task('saved', Effect.succeed(1), 'drop');
  owner.task('loose', Effect.succeed({ rows: [1] }), 'replace');
  owner.task(['sending', 'a'], Effect.fail('offline'), 'queue');
  owner.task(['sending', 3], Effect.succeed(1), 'latest-queued');
  const outcome: Effect.Effect<
    { readonly _tag: 'Success'; readonly value: number } | { readonly _tag: string }
  > = owner.task('saved', Effect.succeed(1), 'drop').await;
  void outcome;
  // @ts-expect-error The field must hold an AsyncResult.
  owner.task('label', Effect.succeed(1), 'drop');
  // @ts-expect-error The Effect must succeed with the field's value type.
  owner.task('saved', Effect.succeed('text'), 'drop');
  // @ts-expect-error The Effect's error must fit the field's error type.
  owner.task('saved', Effect.fail(new Error('x')), 'drop');
  // @ts-expect-error One result cannot follow parallel runs.
  owner.task('saved', Effect.succeed(1), 'parallel');
  // @ts-expect-error A single-result field takes a plain key, not a row key.
  owner.task(['saved', 'a'], Effect.succeed(1), 'drop');
  // @ts-expect-error A row key needs a record field.
  owner.task('sending', Effect.succeed(1), 'drop');

  const untyped = modelOwner({ saved: AsyncResult.initial() });
  // @ts-expect-error `AsyncResult.initial()` without type arguments holds no value.
  untyped.task('saved', Effect.succeed(1), 'drop');
  const strictRows = modelOwner({
    rows: {} as Record<string, AsyncResult.AsyncResult<number, never>>,
  });
  // @ts-expect-error Row records must allow missing rows (`Partial<Record<…>>`).
  strictRows.task(['rows', 'a'], Effect.succeed(1), 'drop');
}

export const Form = component(
  {
    init: (_props: { readonly id: string }) => ({
      draft: '',
      saved: AsyncResult.initial<number, string>(),
    }),
  },
  (owner) =>
    view((model) => {
      const draft: string = owner.read().draft;
      void draft;
      owner.patch({ draft: 'x' });
      // @ts-expect-error A component owner still cannot patch runtime-owned props.
      owner.patch({ props: { id: 'x' } });
      // @ts-expect-error Its fields keep their types.
      owner.patch({ draft: 1 });
      // @ts-expect-error Its task results keep their types.
      owner.task('saved', Effect.succeed('x'), 'drop');
      return (
        <button onClick={() => owner.task('saved', Effect.succeed(model.draft.length), 'drop')}>
          {model.props.id}
        </button>
      );
    }),
);
