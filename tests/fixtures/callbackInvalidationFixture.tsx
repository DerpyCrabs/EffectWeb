import { collection, list, mapSource, mount, observe, program, view } from 'effectweb';

type Row = { readonly id: number; readonly x: number };
type Model = {
  readonly windows: readonly Row[];
  readonly active: number;
  readonly pick: (id: number) => void;
};
type Pattern = 'named' | 'inline' | 'snapshot' | 'broad' | 'selected';
const position = (model: Model, id: number) => model.windows.find((row) => row.id === id)!.x;
const countRow = (counter: { rows: number }) => {
  counter.rows++;
};

/** Same output, with different visibility of dependencies to the compiler. */
export function callbackWork(pattern: Pattern, count: number, updates: number) {
  const counters = { rows: 0, children: 0, projections: 0 };
  const picked: string[] = [];
  const Getter = view<{ x: () => number; active: boolean; pick: () => void }>((props) => {
    counters.children++;
    return (
      <button data-active={props.active} onClick={props.pick}>
        {props.x()}
      </button>
    );
  });
  const Snapshot = view<{ x: number; active: boolean; pick: () => void }>((props) => {
    counters.children++;
    return (
      <button data-active={props.active} onClick={props.pick}>
        {props.x}
      </button>
    );
  });
  const rows = collection<Row>((row) => row.id);
  const Root = view<Model>((model) =>
    list(rows.from(model.windows), (row) => {
      countRow(counters);
      const x = () => row.x;
      const pick = model.pick;
      if (pattern === 'named')
        return <Getter x={x} active={model.active === row.id} pick={() => pick(row.id)} />;
      if (pattern === 'inline')
        return (
          <Getter x={() => row.x} active={model.active === row.id} pick={() => pick(row.id)} />
        );
      if (pattern === 'broad')
        return (
          <Getter
            x={() => position(model, row.id)}
            active={model.active === row.id}
            pick={() => pick(row.id)}
          />
        );
      return <Snapshot x={row.x} active={model.active === row.id} pick={() => pick(row.id)} />;
    }),
  );
  const source = program<Model, Partial<Model>>({
    initial: {
      windows: Array.from({ length: count }, (_, id) => ({ id, x: 0 })),
      active: -1,
      pick: (id) => picked.push(`old:${id}`),
    },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const initialRows = rows.from(source.model().windows);
  const selections = source.model().windows.map((row) =>
    mapSource(
      source,
      (model) => {
        counters.projections++;
        return { x: model.windows[row.id]!.x, active: model.active === row.id, pick: model.pick };
      },
      (a, b) => a.x === b.x && a.active === b.active && a.pick === b.pick,
    ),
  );
  const Selected = view<Model>(() =>
    list(initialRows, (row) => {
      countRow(counters);
      return observe(selections[row.id]!, (props) => (
        <Snapshot x={props.x} active={props.active} pick={() => props.pick(row.id)} />
      ));
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const mounted = mount(host, pattern === 'selected' ? Selected : Root, source);
  const first = host.querySelector('button')!;
  counters.children = counters.rows = counters.projections = 0;
  const start = performance.now();
  for (let index = 0; index < updates; index++) source.send({ active: index % count });
  const elapsed = performance.now() - start;
  const focus = { ...counters };
  const activeRows = Array.from(host.querySelectorAll('button')).flatMap((button, index) =>
    button.getAttribute('data-active') === 'true' ? [index] : [],
  );
  source.send({ windows: source.model().windows.map((row) => (row.id ? row : { ...row, x: 99 })) });
  const positionUpdated = first.textContent === '99';
  source.send({ pick: (id) => picked.push(`new:${id}`) });
  first.click();
  const retained = host.querySelector('button') === first;
  mounted.dispose();
  const disposed = host.childNodes.length === 0;
  const beforeDisposedUpdate = counters.projections;
  source.send({ active: -1 });
  const subscriptionsDisposed = counters.projections === beforeDisposedUpdate;
  source.dispose();
  host.remove();
  return {
    focus,
    elapsed,
    activeRows,
    positionUpdated,
    picked,
    retained,
    disposed,
    subscriptionsDisposed,
  };
}
