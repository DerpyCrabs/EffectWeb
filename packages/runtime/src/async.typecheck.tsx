import type { Cause } from 'effect';
import type * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { AsyncContent } from './AsyncContent.js';
import type { Slot } from './dom.js';

export function asyncContentTypes(
  result: AsyncResult.AsyncResult<number, 'offline'>,
  content: Slot<number>,
  wrongContent: Slot<string>,
  failure: Slot<Cause.Cause<'offline'>>,
  wrongFailure: Slot<Cause.Cause<'unauthorized'>>,
) {
  const valid = <AsyncContent result={result} content={content} failure={failure} />;
  // @ts-expect-error Available data keeps its type across the generic JSX component boundary.
  const badContent = <AsyncContent result={result} content={wrongContent} />;
  // @ts-expect-error Expected error channels are not widened to unknown by presentation.
  const badFailure = <AsyncContent result={result} content={content} failure={wrongFailure} />;
  void [valid, badContent, badFailure];
}

// Resource views may retry; only the lifetime owner can publish completions.
export function resourceControls(
  send: import('./program.js').Send<import('./resource.js').ResourceMessage>,
) {
  send({ type: 'Retry' });
  // @ts-expect-error Resource completion belongs to its running command.
  send({ type: 'Loaded', value: 1 });
  // @ts-expect-error Resource failure belongs to its running command.
  send({ type: 'Failed', cause: undefined });
}

export function paginationControls(source: import('./pages.js').PagesProgram<{}, number, string>) {
  source.send({ type: 'More' });
  source.send({ type: 'Retry' });
  source.send({ type: 'Refresh' });
  // @ts-expect-error A running pagination source owns its completion messages.
  source.send({ type: 'Loaded', page: { items: [1], next: undefined }, append: false });
  // @ts-expect-error Parent inputs flow through receive.
  source.send({ type: 'Input', props: {} });
}

export function immutableQueryInputs() {
  return import('./query.js').then(({ query }) =>
    query<{ filters: string[]; page: number }, number>({
      name: 'readonly query inputs',
      load: (args) => {
        // @ts-expect-error Running loads must not mutate their selected query identity.
        // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
        args.filters.push('changed');
        throw new Error('Type-only fixture');
      },
    }),
  );
}
