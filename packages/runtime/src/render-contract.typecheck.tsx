import { Effect } from 'effect';
import { list, Scope, text, view } from './dom.js';
import { eventEffects } from './event-effects.js';
import { entities } from './collection.js';
import type { JSX } from './jsx.js';

// Ordinary helper signatures are sufficient; names carry no compiler contract.
const methods = {
  sort: (values: readonly string[]) => values.join(','),
  slice: (value: string) => value.toUpperCase(),
};
export const ordinaryHelpers = view<{
  labels: string[];
  rows: { id: string }[];
  render: (value: string) => JSX.Element;
}>((model) => (
  <>
    <p>{methods.slice(methods.sort(model.labels))}</p>
    {list(entities(model.rows), (row) => (
      <b>{row.id}</b>
    ))}
    {model.render(methods.sort(model.labels))}
    <button onClick={() => Effect.void}>Run</button>
  </>
));

export function renderContractTypes() {
  const scope = new Scope({}, () => {});
  const button = document.createElement('button');
  text(
    scope,
    button,
    null,
    () => [],
    // @ts-expect-error DOM content uses the same JSX contract as the authoring API.
    () => ({ arbitrary: 'object' }),
  );
  // A listener owns direct Effects, including their resource scopes.
  const owned: JSX.Element = <button onClick={() => Effect.void}>Run</button>;
  // @ts-expect-error A listener cannot be a Promise callback.
  const promised: JSX.Element = <button onClick={async () => {}}>Run</button>;
  void owned;
  void promised;
  eventEffects(() => {}).accept(Effect.void);
  // @ts-expect-error Effects need an owner and cannot be rendered as values.
  const effectValue: JSX.Element = Effect.succeed('text');
  // @ts-expect-error Promises cannot be rendered as values.
  const promiseValue: JSX.Element = Promise.resolve('text');
  // @ts-expect-error A view renders synchronously.
  // oxlint-disable-next-line effectweb/valid-view -- Negative type contract deliberately uses an unsupported async view marker.
  const asyncView = view(async () => 'text');
  // @ts-expect-error Effect programs enter through an Effect adapter.
  const effectView = view(() => Effect.succeed('text'));
  // @ts-expect-error JSX handlers preserve the event contract for inline async callbacks.
  const asyncEvent = <button onClick={async () => {}} />;
  const attrs = { onClick: () => Effect.void };
  const effectSpread = <button {...attrs} />;
  void [effectValue, promiseValue, asyncView, effectView, asyncEvent, effectSpread];
}
