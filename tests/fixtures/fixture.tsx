import { Effect } from 'effect';
import { commandSlot, collection, mountView, program, view, ViewBinding } from 'effectweb';

export interface Item {
  readonly id: number;
  readonly text: string;
  readonly serverId?: number;
}
interface Model {
  readonly items: readonly Item[];
  readonly title: string;
  readonly visible: boolean;
  readonly user: { readonly name: string } | undefined;
  readonly selected: number;
  readonly selectedText: string;
}
type Message =
  | { type: 'Replace'; model: Model }
  | { type: 'Select'; id: number; text: string }
  | { type: 'Send'; id: number; text: string }
  | { type: 'Acknowledged'; id: number; serverId: number };
const items = collection<Item>((item) => item.id);
import { counters, label } from './fixtureInstrumentation';
const commandSend = commandSlot('send');
// The counter is instrumentation only. Production view helpers must be pure.
const ItemView = view<Item, Message>((model, send) => {
  const { id, text } = model;
  const title = label(text);
  return (
    <article data-id={id} data-server-id={model.serverId}>
      <button onClick={() => send({ type: 'Select', id, text })}>{title}</button>
      <input value={text} aria-label={`Edit ${id}`} />
    </article>
  );
});
const FixtureView = view<Model, Message>((model, send) => {
  const { title, visible } = model;
  const rows = items.from(model.items);
  return (
    <main>
      <h1>{title}</h1>
      <output>{model.selected}</output>
      <p>{model.user ? model.user.name : 'anonymous'}</p>
      {visible ? (
        <section>
          {rows.map((item) => (
            <ViewBinding view={ItemView} model={item} send={send} />
          ))}
        </section>
      ) : (
        <p>Hidden</p>
      )}
    </main>
  );
});

export function mountFixture(parent: HTMLElement, count = 1000) {
  const initial: Model = {
    items: Array.from({ length: count }, (_, id) => ({ id, text: `Message ${id}` })),
    title: 'Messages',
    visible: true,
    user: undefined,
    selected: -1,
    selectedText: '',
  };
  const acknowledgements = new Map<number, (serverId: number) => void>();
  const source = program<Model, Message>({
    initial,
    update: (model, message) => {
      switch (message.type) {
        case 'Replace':
          return { model: message.model };
        case 'Select':
          return { model: { ...model, selected: message.id, selectedText: message.text } };
        case 'Send':
          return {
            model: { ...model, items: [...model.items, { id: message.id, text: message.text }] },
            commands: [
              {
                slot: commandSend,
                policy: 'parallel',
                effect: Effect.callback<Message>((resume) => {
                  acknowledgements.set(message.id, (serverId) =>
                    resume(Effect.succeed({ type: 'Acknowledged', id: message.id, serverId })),
                  );
                  return Effect.sync(() => {
                    acknowledgements.delete(message.id);
                  });
                }),
              },
            ],
          };
        case 'Acknowledged':
          return {
            model: {
              ...model,
              items: model.items.map((item) =>
                item.id === message.id ? { ...item, serverId: message.serverId } : item,
              ),
            },
          };
      }
    },
  });
  const unmount = mountView(parent, FixtureView, source);
  const set = (patch: Partial<Model>) =>
    source.send({ type: 'Replace', model: { ...source.model(), ...patch } });
  return {
    model: source.model,
    counters,
    set,
    sendOptimistic(id: number, text: string) {
      source.send({ type: 'Send', id, text });
    },
    acknowledge(id: number, serverId: number) {
      acknowledgements.get(id)!(serverId);
    },
    edit(id: number, text: string) {
      set({
        items: source.model().items.map((item) => (item.id === id ? { ...item, text } : item)),
      });
    },
    prepend(count: number) {
      set({
        items: [
          ...Array.from({ length: count }, (_, index) => ({
            id: -index - 1,
            text: `Older ${index}`,
          })),
          ...source.model().items,
        ],
      });
    },
    reverse() {
      set({ items: [...source.model().items].reverse() });
    },
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

export function mountPrimitiveList(parent: HTMLElement, values: readonly string[]) {
  const View = view<readonly string[], string>((model, send) => (
    <ul>
      {model.map((value) => (
        <li onClick={() => send(value)}>{value}</li>
      ))}
    </ul>
  ));
  const source = program({
    initial: values,
    update: (model: readonly string[], _message: string) => ({ model }),
  });
  const unmount = mountView(parent, View, source);
  return () => {
    unmount();
    source.dispose();
  };
}

export function mountEventSnapshot(parent: HTMLElement) {
  type State = { value: number; seen: number };
  type Action = { type: 'Add' } | { type: 'Seen'; value: number };
  const View = view<State, Action>((model, send) => {
    const read = () => model.value;
    return (
      <button
        onClick={() => {
          send({ type: 'Add' });
          send({ type: 'Seen', value: read() });
        }}
      >
        {model.value}
      </button>
    );
  });
  const source = program<State, Action>({
    initial: { value: 0, seen: -1 },
    update: (model, action) => ({
      model:
        action.type === 'Add'
          ? { ...model, value: model.value + 1 }
          : { ...model, seen: action.value },
    }),
  });
  const unmount = mountView(parent, View, source);
  return {
    model: source.model,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

export function mountRootList(parent: HTMLElement) {
  type State = { visible: boolean; values: readonly string[] };
  const View = view<State, State>((model, send) =>
    model.visible ? (
      model.values.map((value) => (
        <button onClick={() => send({ ...model, values: [value] })}>{value}</button>
      ))
    ) : (
      <p>Hidden</p>
    ),
  );
  const source = program<State, State>({
    initial: { visible: true, values: ['a', 'b', 'c'] },
    update: (_model, model) => ({ model }),
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

export function mountAttributes(parent: HTMLElement) {
  type State = {
    className: string;
    classes: Record<string, boolean>;
    style: Record<string, string>;
    text: string;
  };
  const View = view<State, State>((model, send) => (
    <div class={model.className} classList={model.classes} style={model.style}>
      <input
        value={model.text}
        onInput={(event) => send({ ...model, text: event.currentTarget.value })}
      />
    </div>
  ));
  const initial = {
    className: 'base',
    classes: { active: true },
    style: { color: 'red', background: 'blue' },
    text: 'content',
  };
  const source = program<State, State>({ initial, update: (_model, model) => ({ model }) });
  const unmount = mountView(parent, View, source);
  return {
    set: (patch: Partial<State>) => source.send({ ...source.model(), ...patch }),
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
