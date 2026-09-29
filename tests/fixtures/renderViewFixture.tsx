import { Effect } from 'effect';
import { localComponent, view } from 'effectweb';
import { renderView } from 'effectweb/testing';

type Props = { readonly label: string };
const Counter = localComponent<Props, { count: number }>({
  init: () => ({ count: 0 }),
  view: view((model, patch) => (
    <button onClick={() => patch({ count: model.count + 1 })}>
      {model.props.label}:{model.count}
    </button>
  )),
});
const Row = view<Props, 'picked'>((model, send) => (
  <button onClick={() => send('picked')}>{model.label}</button>
));

export function renderFixtures(parent: HTMLElement) {
  const counterHost = document.createElement('div');
  const rowHost = document.createElement('div');
  parent.append(counterHost, rowHost);
  const counter = renderView(counterHost, Counter, { label: 'first' });
  const forwarded: string[] = [];
  const row = renderView(rowHost, Row, { label: 'row' }, { send: (m) => forwarded.push(m) });
  const closeRow = () => Effect.runPromise(row.close());
  return { counter, row, closeRow, forwarded, counterHost, rowHost };
}
