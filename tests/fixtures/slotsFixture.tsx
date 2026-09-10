import {
  domMount,
  localComponent,
  mountView,
  program,
  slot,
  view,
  type JSX,
  type Slot,
} from 'effectweb';

export function mountSlots(parent: HTMLElement) {
  const lifetime = { mounted: 0, disposed: 0 };
  const monitor = domMount(() => {
    lifetime.mounted++;
    return () => {
      lifetime.disposed++;
    };
  });
  const Counter = localComponent<{ label: string; onSelect: () => void }, { count: number }>({
    init: () => ({ count: 0 }),
    view: view((model, send) => (
      <button
        use={monitor}
        onClick={() => {
          send({ count: model.count + 1 });
          model.props.onSelect();
        }}
      >
        {model.props.label}:{model.count}
      </button>
    )),
  });
  const Forward = view<{ children?: JSX.Element }, never>((model, _send) => (
    <section>{model.children}</section>
  ));
  const Frame = localComponent<
    { children?: JSX.Element; footer?: JSX.Element; row: Slot<string> },
    { second: boolean; value: string }
  >({
    init: () => ({ second: true, value: 'argument' }),
    view: view((model, send) => (
      <article>
        <button data-toggle="" onClick={() => send({ second: !model.second })}>
          Toggle
        </button>
        <button data-value="" onClick={() => send({ value: model.value + '!' })}>
          Argument
        </button>
        <Forward children={model.props.children} />
        {model.second && <aside>{model.props.children}</aside>}
        <footer>{model.props.footer}</footer>
        <output>{model.props.row(model.value)}</output>
      </article>
    )),
  });
  type State = { title: string; selected: string; visible: boolean };
  const View = view<State, Partial<State>>((model, send) => {
    const label = model.title.toUpperCase();
    const row = slot((value: string) => (
      <span>
        {label}:{value}
      </span>
    ));
    return (
      model.visible && (
        <Frame row={row} footer={<b>{model.title}</b>}>
          <Counter label={label} onSelect={() => send({ selected: model.title })} />
        </Frame>
      )
    );
  });
  const source = program<State, Partial<State>>({
    initial: { title: 'first', selected: '', visible: true },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, View, source);
  return {
    set: source.send,
    model: source.model,
    lifetime,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

export function mountSvgSlots(parent: SVGElement) {
  const Frame = view<{ children?: JSX.Element; row: Slot<number> }, never>((model, _send) => (
    <g>
      {model.children}
      {model.row(10)}
    </g>
  ));
  const View = view<{ x: number }, never>((model, _send) => (
    <Frame
      row={slot((y: number) => (
        <circle data-row="" cx={model.x} cy={y} />
      ))}
    >
      <circle data-child="" cx={model.x} />
      <foreignObject>
        <div>{model.x}</div>
      </foreignObject>
    </Frame>
  ));
  const source = program<{ x: number }, number>({
    initial: { x: 1 },
    update: (_model, x) => ({ model: { x } }),
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

export function mountChangingSlots(parent: HTMLElement) {
  const Frame = view<{ content: JSX.Element }, never>((model, _send) => (
    <section>{model.content}</section>
  ));
  type State = {
    mode: 'first' | 'second' | 'text';
    value: { title: string; stable: { n: number } };
  };
  const View = view<State, never>((model, _send) => {
    const first = slot((value: State['value']) => (
      <input aria-label={value.title} data-stable={value.stable.n} />
    ));
    const second = slot(() => <button>{model.value.title}</button>);
    // Derived placement values must retain their opaque brand through structural sharing.
    const placement = first(model.value);
    return (
      <Frame
        content={model.mode === 'first' ? placement : model.mode === 'second' ? second() : 'plain'}
      />
    );
  });
  const source = program<State, Partial<State>>({
    initial: { mode: 'first', value: { title: 'one', stable: { n: 1 } } },
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
