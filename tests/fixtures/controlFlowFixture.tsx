import { domMount, localComponent, mountView, program, view } from 'effectweb';

export function mountControlFlow(parent: HTMLElement) {
  const lifetime = { mounted: 0, disposed: 0 };
  const monitor = domMount(() => {
    lifetime.mounted++;
    return () => {
      lifetime.disposed++;
    };
  });
  const Counter = localComponent<{ caption: string }, { count: number }>({
    init: () => ({ count: 0 }),
    view: view((model, send) => (
      <button use={monitor} onClick={() => send({ count: model.count + 1 })}>
        {model.props.caption}:{model.count}
      </button>
    )),
  });
  type Item = { kind: 'ready' | 'cached'; title: string } | { kind: 'error'; message: string };
  type State = { loading: boolean; item: Item; title: string };
  const View = view<State, never>((model, _send) => {
    const title = model.title;
    const caption = <span data-caption="">{title}</span>;
    const contents = (item: Item) => {
      switch (item.kind) {
        case 'ready':
        case 'cached': {
          const title = item.title.toUpperCase();
          return (
            <section>
              {caption}
              <Counter caption={title} />
            </section>
          );
        }
        case 'error':
        default:
          return <p role="alert">{item.message}</p>;
      }
    };
    if (model.loading) return <p data-loading="">Loading</p>;
    if (model.title === '') {
      const title = 'empty';
      if (model.item.kind === 'error')
        return (
          <p>
            {title}:{model.item.message}
          </p>
        );
    }
    return <main>{contents(model.item)}</main>;
  });
  const source = program<State, Partial<State>>({
    initial: { loading: false, item: { kind: 'ready', title: 'first' }, title: 'outer' },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, View, source);
  return {
    set: source.send,
    lifetime,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

export function mountDefaultGroup(parent: HTMLElement) {
  type State = { kind: string; fallback: string; other: string };
  const View = view<State, never>((model, _send) => {
    switch (model.kind) {
      default:
      case model.fallback:
        return <input aria-label="Fallback" />;
      case model.other:
        return <p>Other</p>;
    }
  });
  const source = program<State, Partial<State>>({
    initial: { kind: 'same', fallback: 'same', other: 'same' },
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
