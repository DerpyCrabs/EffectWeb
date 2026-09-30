import { Cause, Option } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { AsyncContent, domMount, submit, mountView, program, slot, view } from 'effectweb';

export function mountAsyncContent(parent: HTMLElement) {
  type Model = { result: AsyncResult.AsyncResult<number | undefined, string>; delay: number };
  const lifetime = { mounted: 0, disposed: 0 };
  const monitor = domMount(() => {
    lifetime.mounted++;
    return () => {
      lifetime.disposed++;
    };
  });
  const View = view<Model, never>((model, _send) => (
    <AsyncContent
      result={model.result}
      pendingDelay={model.delay}
      content={slot((value: number | undefined) => (
        <section use={monitor}>
          <input aria-label="Persistent input" />
          <output>{String(value)}</output>
        </section>
      ))}
      pending={<p data-pending="">Loading</p>}
      empty={<p data-empty="">Empty</p>}
      refreshing={<p data-refreshing="">Refreshing</p>}
      failure={slot((cause: Cause.Cause<string>) => (
        <p role="alert">{Cause.pretty(cause)}</p>
      ))}
    />
  ));
  const source = program<Model, Partial<Model>>({
    initial: { result: AsyncResult.initial(), delay: 50 },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, View, source);
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
      unmount();
      source.dispose();
    },
  };
}

export function mountForm(parent: HTMLElement) {
  type Model = { text: string; checked: boolean; number: number | undefined; submitted: number };
  const View = view<Model, Partial<Model>>((model, send) => (
    <form onSubmit={submit(() => send({ submitted: model.submitted + 1 }))}>
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
  const unmount = mountView(parent, View, source);
  return {
    model: source.model,
    set: source.send,
    dispose() {
      unmount();
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
  const unmount = mountView(parent, View, source);
  return {
    model: () => source.model(),
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
