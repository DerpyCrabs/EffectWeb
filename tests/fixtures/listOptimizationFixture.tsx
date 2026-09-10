import { collection, mountView, program, view } from 'effectweb';
import { identity } from './fixtureInstrumentation';

type Item = { readonly id: number; readonly label: string };
type Model = {
  readonly items: readonly Item[];
  readonly selected: number;
  readonly suffix: string;
  readonly clicked: string;
};

export function mountListOptimization(parent: HTMLElement) {
  const counters = { identities: 0 };
  const rows = collection<Item>((item) => identity(counters, item.id));
  const View = view<Model, Partial<Model>>((model, send) => (
    <section>
      {rows.from(model.items).map((item, index) => (
        <button
          class={model.selected === item.id ? 'selected' : ''}
          data-id={item.id}
          onClick={() => send({ clicked: `${item.label}:${index}:${model.suffix}` })}
        >
          {item.label}:{index}:{model.suffix}
        </button>
      ))}
    </section>
  ));
  const source = program<Model, Partial<Model>>({
    initial: {
      items: Array.from({ length: 1000 }, (_, id) => ({ id, label: `row ${id}` })),
      selected: 0,
      suffix: 'before',
      clicked: '',
    },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, View, source);
  return {
    ...source,
    counters,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
