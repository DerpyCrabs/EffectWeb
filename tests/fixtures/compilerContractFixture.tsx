import { mountView, program, view } from 'effectweb';

export function mountLexicalCapture(parent: HTMLElement) {
  type State = { title: string; values: readonly string[]; selected: string };
  const View = view<State, Partial<State>>((model, send) => {
    const title = model.title.toUpperCase();
    const caption = (
      <b>
        {model.title}:{title}
      </b>
    );
    const alias = caption;
    const aliased = (model: string) => <aside data-alias={model}>{alias}</aside>;
    const indirect = (title: string) => aliased(title);
    const row = (model: { title: string }) => {
      const title = model.title.toUpperCase();
      return <div data-helper={title}>{caption}</div>;
    };
    const click = <button onClick={() => send({ selected: model.title })}>Select</button>;
    const action = (send: string) => <span data-action={send}>{click}</span>;
    return (
      <section>
        {row({ title: 'inner' })}
        {action('shadow')}
        {indirect('alias')}
        {model.values.map((model) => (
          <p data-row={model}>{caption}</p>
        ))}
      </section>
    );
  });
  const source = program<State, Partial<State>>({
    initial: { title: 'outer', values: ['a', 'b'], selected: '' },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, View, source);
  return {
    set: source.send,
    model: source.model,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

export function mountSvgContexts(parent: Element) {
  type State = { visible: boolean; x: number; rows: readonly number[] };
  // This view mounts into an existing SVG element, exercising mountView's detached root.
  const View = view<State, never>((model, _send) => (
    <>
      {model.visible && <circle data-dynamic="" cx={model.x} cy="10" r="5" />}
      {model.visible && <rect data-static="" width="5" height="5" />}
      {model.rows.map((row) => (
        <circle data-row={row} cx={row} cy="20" r="3" />
      ))}
      <foreignObject width="50" height="50">
        {model.visible && <div data-html="">{model.x}</div>}
        {model.rows.map((row) => (
          <p data-html-row={row}>{row}</p>
        ))}
        {model.visible && <span data-html-static="">Static HTML</span>}
        {model.visible && (
          <svg>
            <circle data-nested="" cx={model.x} r="2" />
          </svg>
        )}
      </foreignObject>
    </>
  ));
  const source = program<State, Partial<State>>({
    initial: { visible: true, x: 10, rows: [1, 2] },
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

export function mountDestructured(parent: HTMLElement) {
  type State = {
    title?: string;
    user: { name: string };
    items: readonly string[];
    unrelated: number;
    selected: string;
  };
  let formats = 0;
  const format = (name: string) => {
    formats++;
    return name.toUpperCase();
  };
  const Simple = view<State, Partial<State>>(({ user: { name } }, send) => (
    <button data-simple="" onClick={() => send({ selected: name })}>
      {format(name)}
    </button>
  ));
  const Complex = view<State, Partial<State>>(
    ({ title: label = 'fallback', items: [first, ...remaining], ...rest }, send) => (
      <button
        data-complex=""
        onClick={() => send({ selected: `${label}:${rest.user.name}:${first}` })}
      >
        {label}:{first}:{remaining.length}
      </button>
    ),
  );
  const source = program<State, Partial<State>>({
    initial: { user: { name: 'Alice' }, items: ['a', 'b'], unrelated: 0, selected: '' },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const simple = mountView(parent, Simple, source);
  const complex = mountView(parent, Complex, source);
  return {
    model: source.model,
    set: source.send,
    formats: () => formats,
    dispose() {
      simple();
      complex();
      source.dispose();
    },
  };
}
