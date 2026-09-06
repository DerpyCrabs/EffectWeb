import { Effect } from 'effect';
import { effectEvent, mountView, program, view, type JSX } from 'effectweb';

type Model = { readonly count: number; readonly visible: boolean; readonly suffix: string };
type Message = { readonly count?: number; readonly visible?: boolean; readonly suffix?: string };

const Forward = view<{ count: number; suffix: string; content: JSX.Element; click: () => void }>(
  (props) => (
    <aside>
      <b>
        {props.count}
        {props.suffix}
      </b>
      {props.content}
      <button onClick={props.click}>Forward</button>
    </aside>
  ),
);

export function mountTemplates(parent: Node) {
  const seen: number[] = [];
  const source = program<Model, Message>({
    initial: { count: 0, visible: true, suffix: '!' },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const View = view<Model, Message>((model, send) => (
    <section data-static={'<&"'}>
      {model.visible ? <i>before {model.count}</i> : null}
      <div class="fixed" data-count={model.count}>
        <button
          onClick={() => {
            send({ count: model.count + 1 });
            seen.push(model.count);
            send({ count: model.count + 2 });
          }}
        >
          Snapshot
        </button>
        <button
          onClick={(event) =>
            effectEvent('drop', () =>
              Effect.sync(() => send({ count: model.count + event.type.length })),
            )(event)
          }
        >
          Effect
        </button>
        <Forward
          count={model.count}
          suffix={model.suffix}
          click={() => send({ count: model.count + 1 })}
          content={<em>{model.suffix}</em>}
        />
      </div>
      {model.visible ? <u>after {model.count}</u> : null}
      <footer>
        left{model.count}
        {model.suffix}right<span>tail</span>
      </footer>
    </section>
  ));
  const unmount = mountView(parent, View, source);
  return {
    source,
    seen,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

const Html = view<{ text: string }>((model) => (
  <div>
    <span title={'"<&'}>{model.text}</span>
  </div>
));
const Svg = view<{ text: string }>((model) => (
  <g>
    <circle r="3" />
    <text>{model.text}</text>
  </g>
));
const Exact = view<{ text: string }>((model) => (
  <main>
    <table>
      <tr>
        <td>{model.text}</td>
      </tr>
    </table>
    <p>
      <div>nested</div>
    </p>
    <button>
      <button>inner</button>
    </button>
  </main>
));
export function mountContexts(parent: Node, kind: 'html' | 'svg' | 'exact') {
  const source = program<{ text: string }, string>({
    initial: { text: 'before' },
    update: (_, text) => ({ model: { text } }),
  });
  const unmount = mountView(parent, kind === 'html' ? Html : kind === 'svg' ? Svg : Exact, source);
  return {
    source,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
