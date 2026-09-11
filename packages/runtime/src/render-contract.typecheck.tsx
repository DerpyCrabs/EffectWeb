import { Effect } from 'effect';
import { event, bindEvent, Scope, text, view, type Slot } from './dom.js';
import { effectEvent, eventEffects } from './effectEvent.js';
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
  render: Slot<string>;
}>((model) => (
  <>
    <p>{methods.slice(methods.sort(model.labels))}</p>
    {entities(model.rows).map((row) => (
      <b>{row.id}</b>
    ))}
    {model.render(methods.sort(model.labels))}
    <button onClick={effectEvent('replace', () => Effect.void)}>Run</button>
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
  event(scope, button, 'onClick', () => Effect.void);
  bindEvent(
    scope,
    button,
    'onClick',
    () => [],
    // @ts-expect-error A listener factory cannot return a Promise callback.
    () => async () => {},
  );
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
