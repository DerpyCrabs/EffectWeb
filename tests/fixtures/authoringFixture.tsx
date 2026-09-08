import { domMount, mountView, program, view, ViewBinding, type DomMount } from 'effectweb';

type State = {
  label: string;
  attrs: {
    title?: string;
    class?: string;
    classList?: Record<string, boolean>;
    style?: Record<string, string>;
    onClick?: () => void;
    use?: DomMount;
  };
  control: { value?: string; onInput?: () => void };
  child: { model: string; send: () => void; extra?: string };
  selected: string;
};
const Ordinary = view<State['child']>((p) => (
  <button data-ordinary onClick={() => p.send()}>
    {p.model}:{p.extra}
  </button>
));
const Dispatched = view<string, string>((label, send) => (
  <button data-dispatched onClick={() => send(label)}>
    {label}
  </button>
));
const View = view<State, Partial<State>>((p, send) => (
  <section>
    <Ordinary model={p.label} send={p.child.send} />
    <Ordinary {...p.child} extra="explicit" />
    <ViewBinding view={Dispatched} model={p.label} send={(selected) => send({ selected })} />
    <button data-spread title="before" {...p.attrs}>
      Spread
    </button>
    <input data-control {...p.control} />
    <button
      data-inline
      {...{
        onClick: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
          event.currentTarget.setAttribute('data-clicked', p.label);
        },
      }}
    >
      Inline spread
    </button>
  </section>
));

export function mountAuthoring(parent: HTMLElement) {
  const clicks: string[] = [];
  const hosts: string[] = [];
  const host = (id: string) =>
    domMount(() => {
      hosts.push(`start:${id}`);
      return () => {
        hosts.push(`stop:${id}`);
      };
    });
  const source = program<State, Partial<State>>({
    initial: {
      label: 'first',
      attrs: {
        title: 'spread',
        class: 'base',
        classList: { active: true },
        style: { color: 'red' },
        onClick: () => {
          clicks.push('old');
        },
        use: host('old'),
      },
      control: { value: 'controlled', onInput: () => {} },
      child: {
        model: 'child',
        send: () => {
          clicks.push('child');
        },
      },
      selected: '',
    },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, View, source);
  return {
    source,
    clicks,
    hosts,
    replace: () =>
      source.send({
        label: 'second',
        attrs: {
          onClick: () => {
            clicks.push('new');
          },
          use: host('new'),
        },
        child: {
          model: 'changed child',
          send: () => {
            clicks.push('changed child');
          },
        },
        control: {},
      }),
    remove: () => source.send({ attrs: {}, control: {} }),
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
