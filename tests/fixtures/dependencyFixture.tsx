import { list as renderList } from 'effectweb';
import { mountView, program, view } from 'effectweb';

export function mountCopiedArrays(parent: HTMLElement) {
  const View = view<{ items: readonly number[] }>((model) => {
    const sorted = [...model.items].sort((a, b) => a - b);
    return (
      <section>
        <output data-sorted>{sorted.join(',')}</output>
        <output data-reversed>{[...model.items].reverse().join(',')}</output>
      </section>
    );
  });
  const initial = Object.freeze([3, 1, 2]);
  const source = program<{ items: readonly number[] }, readonly number[]>({
    initial: { items: initial },
    update: (_model, items) => ({ model: { items } }),
  });
  const unmount = mountView(parent, View, source);
  return {
    initial,
    set: source.send,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

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
        {renderList(model.values, (value) => (
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
