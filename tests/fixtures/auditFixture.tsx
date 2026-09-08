import { mountView, patchModel, program, view } from 'effectweb';

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
  const unmount = mountView(parent, View, source);
  return {
    model: source.model,
    set: source.send,
    dispose: () => {
      unmount();
      source.dispose();
    },
  };
}
