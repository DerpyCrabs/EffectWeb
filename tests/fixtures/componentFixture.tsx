import { commandSlot } from 'effectweb';
import { Effect } from 'effect';
import { component, localComponent, domBinding, mountView, Portal, program, view } from 'effectweb';

const commandCount = commandSlot('count');

const Local = localComponent<{ title: string; id: string }, { count: number; text: string }>({
  init: () => ({ count: 0, text: '' }),
  view: view((model, patch) => (
    <div id={model.props.id}>
      <input value={model.text} onInput={(event) => patch({ text: event.currentTarget.value })} />
      <button onClick={() => patch({ count: model.count + 1, text: model.props.title })}>
        {model.props.title}:{model.count}:{model.text}
      </button>
    </div>
  )),
});

interface Props {
  title: string;
  done: (title: string) => void;
}
interface ChildModel {
  props: Props;
  count: number;
  loaded: number;
}
type ChildMessage = { type: 'Increment' } | { type: 'Loaded'; count: number };
const Child = component<Props, ChildModel, ChildMessage>({
  init: (props) => ({ props, count: 0, loaded: 0 }),

  update: (model, message) =>
    message.type === 'Loaded'
      ? { model: { ...model, loaded: message.count } }
      : {
          model: { ...model, count: model.count + 1 },
          commands: [
            {
              policy: 'replace',
              slot: commandCount,
              effect: Effect.succeed({ type: 'Loaded', count: model.count + 1 } as const),
            },
          ],
        },
  view: view((model, send) => (
    <button
      id="child"
      onClick={() => {
        send({ type: 'Increment' });
        model.props.done(model.props.title);
      }}
    >
      {model.props.title}:{model.count}:{model.loaded}
    </button>
  )),
});
interface Model {
  title: string;
  visible: boolean;
  last: string;
}
type Message =
  | { type: 'Title'; title: string }
  | { type: 'Visible'; visible: boolean }
  | { type: 'Done'; title: string };
const counts = { mounts: 0, disposals: 0, input: '' };
function lifecycle(element: HTMLElement, input: () => string) {
  counts.mounts++;
  const click = () => {
    counts.input = input();
  };
  element.addEventListener('click', click);
  return () => {
    counts.disposals++;
    element.removeEventListener('click', click);
  };
}
const Fixture = view<Model, Message>((model, send) => {
  const helper = (suffix: string) => (
    <span id="helper">
      {model.title}:{suffix}
    </span>
  );
  const content = <em id="constant">{model.title}</em>;
  return (
    <div>
      <output id="last">{model.last}</output>
      {model.visible ? (
        <section>
          <Child title={model.title} done={(title) => send({ type: 'Done', title })} />
          <Local title={model.title} id="local-first" />
          <Local title={model.title} id="local-second" />
          {helper('suffix')}
          {content}
          <Portal>
            <button id="portal" use={domBinding(model.title, lifecycle)}>
              {model.title}
            </button>
          </Portal>
        </section>
      ) : null}
    </div>
  );
});
export function mountComponentFixture(parent: HTMLElement) {
  counts.mounts = counts.disposals = 0;
  counts.input = '';
  const source = program<Model, Message>({
    initial: { title: 'first', visible: true, last: '' },
    update: (model, message) => ({
      model:
        message.type === 'Visible'
          ? { ...model, visible: message.visible }
          : message.type === 'Title'
            ? { ...model, title: message.title }
            : { ...model, last: message.title },
    }),
  });
  const unmount = mountView(parent, Fixture, source);
  return {
    title: (title: string) => source.send({ type: 'Title', title }),
    hide: () => source.send({ type: 'Visible', visible: false }),
    show: () => source.send({ type: 'Visible', visible: true }),
    counts: () => ({ ...counts }),
    dispose: () => {
      unmount();
      source.dispose();
    },
  };
}
