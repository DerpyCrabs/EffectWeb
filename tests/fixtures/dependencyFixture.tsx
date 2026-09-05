import { mountView, program, view } from 'effectweb';

export function mountDependencies(parent: HTMLElement) {
  type State = {
    title: string;
    values: readonly string[];
    items: readonly { visible: boolean }[];
    options: { label?: string };
  };
  const View = view<State, never>((model, _send) => {
    const { label = model.title } = model.options;
    const caption = <b>{model.title}</b>;
    const alias = caption;
    const helper = () => alias;
    const helperAlias = helper;
    const helperAgain = helperAlias;
    // oxfmt-ignore
    const count = (model.items.filter)((row) => row.visible).length;
    return (
      <section data-default={label}>
        <header>{helperAgain()}</header>
        {model.values.map((value) => (
          <p data-row={value}>{alias}</p>
        ))}
        <output>{count}</output>
      </section>
    );
  });
  const source = program<State, Partial<State>>({
    initial: {
      title: 'before',
      options: {},
      values: ['a', 'b'],
      items: [{ visible: true }, { visible: false }],
    },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, View, source);
  return {
    set: source.send,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
