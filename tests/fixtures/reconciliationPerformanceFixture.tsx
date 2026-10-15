import { collection, list, mount, program, view } from 'effectweb';
import { measured } from './reconciliationPerformance';

type Window = { readonly id: number; readonly x: number };
type Model = { readonly windows: readonly Window[]; readonly tick: number };
export function windowWork(count: number, updates: number) {
  const counter = { renders: 0 };
  const rows = collection<Window>((row) => row.id);
  const WindowView = view<{ row: Window }>((props) => (
    <article style={{ position: 'absolute', left: props.row.x, top: 20, width: 300, height: 200 }}>
      {measured(counter, props.row.id)}
    </article>
  ));
  const View = view<Model>((model) => (
    <section data-tick={model.tick}>
      {list(rows.from(model.windows), (row) => (
        <WindowView row={row} />
      ))}
    </section>
  ));
  const source = program<Model, Partial<Model>>({
    initial: { windows: Array.from({ length: count }, (_, id) => ({ id, x: 0 })), tick: 0 },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const mounted = mount(host, View, source);
  const first = host.querySelector('article');
  counter.renders = 0;
  for (let tick = 1; tick <= updates; tick++) source.send({ tick });
  const unrelatedRenders = counter.renders;
  const start = performance.now();
  for (let x = 1; x <= updates; x++) {
    source.send({
      windows: source.model().windows.map((row, index) => (index ? row : { ...row, x })),
    });
  }
  const elapsed = performance.now() - start;
  const result = {
    unrelatedRenders,
    changedRenders: counter.renders,
    elapsed,
    retained: first === host.querySelector('article'),
    left: first?.style.left,
  };
  mounted.dispose();
  source.dispose();
  result.retained &&= host.childNodes.length === 0;
  host.remove();
  return result;
}
