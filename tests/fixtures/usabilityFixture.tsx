import { Cause, Option } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { domMount, mount, program, resourceError, view } from 'effectweb';

export function mountAsyncResult(parent: HTMLElement) {
  type Model = { result: AsyncResult.AsyncResult<number | undefined, string> };
  const lifetime = { mounted: 0, disposed: 0 };
  const monitor = domMount(() => {
    lifetime.mounted++;
    return () => {
      lifetime.disposed++;
    };
  });
  // The pattern the guide recommends: stale data, a refresh marker and the error side by side.
  const View = view<Model>((model) => {
    const data = AsyncResult.value(model.result);
    const error = model.result.waiting ? undefined : resourceError(model.result);
    return (
      <>
        {Option.isSome(data) ? (
          <section use={monitor}>
            <input aria-label="Persistent input" />
            <output>{String(data.value)}</output>
          </section>
        ) : null}
        {model.result.waiting && Option.isSome(data) ? <p data-refreshing="">Refreshing</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {AsyncResult.isInitial(model.result) && !model.result.waiting ? (
          <p data-empty="">Empty</p>
        ) : null}
      </>
    );
  });
  const source = program<Model, Partial<Model>>({
    initial: { result: AsyncResult.initial() },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mount(parent, View, source);
  return {
    lifetime,
    waiting: () => source.send({ result: AsyncResult.waiting(source.model().result) }),
    success: (value: number | undefined) => source.send({ result: AsyncResult.success(value) }),
    failure: (error: string) =>
      source.send({
        result: AsyncResult.failureWithPrevious(Cause.fail(error), {
          previous: Option.some(source.model().result),
        }),
      }),
    clear: () => source.send({ result: AsyncResult.initial() }),
    dispose() {
      unmount.dispose();
      source.dispose();
    },
  };
}

export function mountForm(parent: HTMLElement) {
  type Model = { text: string; checked: boolean; number: number | undefined; submitted: number };
  const View = view<Model, Partial<Model>>((model, send) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send({ submitted: model.submitted + 1 });
      }}
    >
      <input
        aria-label="Text"
        value={model.text}
        onInput={(event) => send({ text: event.currentTarget.value })}
      />
      <input
        aria-label="Checked"
        type="checkbox"
        checked={model.checked}
        onChange={(event) => send({ checked: event.currentTarget.checked })}
      />
      <input
        aria-label="Number"
        type="number"
        value={model.number ?? ''}
        onInput={(event) => {
          const number = event.currentTarget.valueAsNumber;
          send({ number: Number.isNaN(number) ? undefined : number });
        }}
      />
      <input
        aria-label="Native event"
        onChange={(event) => {
          send({ text: model.text + event.currentTarget.value });
          event.currentTarget.value = '';
          queueMicrotask(() => document.getElementById('native-followup')?.focus());
        }}
      />
      <button id="native-followup">Submit</button>
    </form>
  ));
  const source = program<Model, Partial<Model>>({
    initial: { text: '', checked: false, number: undefined, submitted: 0 },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mount(parent, View, source);
  return {
    model: source.model,
    set: source.send,
    dispose() {
      unmount.dispose();
      source.dispose();
    },
  };
}

export function mountSelect(parent: HTMLElement) {
  const View = view<{ kind: string }, string>((model, send) => (
    <select
      aria-label="Kind"
      value={model.kind}
      onChange={(event) => send(event.currentTarget.value)}
    >
      <option value="">All kinds</option>
      <option value="note">Notes</option>
    </select>
  ));
  const source = program<{ kind: string }, string>({
    initial: { kind: '' },
    update: (_model, kind) => ({ model: { kind } }),
  });
  const unmount = mount(parent, View, source);
  return {
    model: () => source.model(),
    dispose() {
      unmount.dispose();
      source.dispose();
    },
  };
}
