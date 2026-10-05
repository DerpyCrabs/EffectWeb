import { mount, program, view } from 'effectweb';

/** A shallow patch that keeps the model identity when nothing changes. */
function patchModel<Model extends object>(model: Model, patch: Partial<Model>): Model {
  return (Object.keys(patch) as (keyof Model)[]).some((key) => !Object.is(model[key], patch[key]))
    ? { ...model, ...patch }
    : model;
}

export function mountControls(parent: HTMLElement) {
  type Model = { text: string; checked: boolean | undefined };
  type Message = { text: string } | { checked: boolean | undefined };
  const View = view<Model, Message>((model, send) => (
    <section>
      <input
        aria-label="Normalized"
        value={model.text}
        onInput={(event) => send({ text: event.currentTarget.value.trim() })}
      />
      <input aria-label="Rejected" value={model.text} onInput={() => send({ text: model.text })} />
      <textarea
        aria-label="Blur accepted"
        value={model.text}
        onBlur={(event) => send({ text: event.currentTarget.value.trim() })}
      />
      <textarea aria-label="Blur rejected" value={model.text} onBlur={() => {}} />
      <div onInput={() => {}}>
        <input aria-label="Delegated rejected" value={model.text} />
      </div>
      <select aria-label="Select rejected" value={model.text} onChange={() => {}}>
        <option value="x">Original</option>
        <option value="y">Edited</option>
      </select>
      <input
        aria-label="Click rejected"
        type="checkbox"
        checked={model.checked}
        onClick={() => {}}
      />
      <input
        aria-label="Checked"
        type="checkbox"
        checked={model.checked}
        onChange={() => send({ checked: model.checked })}
      />
    </section>
  ));
  const source = program<Model, Message>({
    initial: { text: 'x', checked: false },
    update: (model, patch) => ({ model: patchModel(model, patch) }),
  });
  const unmount = mount(parent, View, source);
  return {
    model: source.model,
    set: source.send,
    dispose: () => {
      unmount();
      source.dispose();
    },
  };
}

export function mountConstrainedControls(parent: HTMLElement) {
  type Model = { value: number; max: number };
  const source = program<Model, Partial<Model>>({
    initial: { value: 150, max: 200 },
    update: (model, changes) => ({ model: patchModel(model, changes) }),
  });
  const View = view<Model>((model) => (
    <section>
      <input aria-label="Value first" type="range" value={model.value} min={0} max={model.max} />
      <input aria-label="Value last" type="range" min={0} max={model.max} value={model.value} />
    </section>
  ));
  mount(parent, View, source);
  return source;
}
