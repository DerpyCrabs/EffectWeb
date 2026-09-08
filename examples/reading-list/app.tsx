import { commandSlot } from 'effectweb';
import { Cause, Context, Effect } from 'effect';
import { collection, effectCommand, mountView, view, type Command } from 'effectweb';
import { uiRuntime } from 'effectweb/runtime';

const commandSave = commandSlot('save');
const commandLoad = commandSlot('load');

export interface Entry {
  readonly id: string;
  readonly title: string;
  readonly read: boolean;
}
export interface Storage {
  readonly load: Effect.Effect<readonly Entry[], unknown>;
  readonly save: (entries: readonly Entry[]) => Effect.Effect<void, unknown>;
}
export interface StorageError {
  readonly _tag: 'StorageError';
  readonly message: string;
}
export class ReadingStorage extends Context.Service<
  ReadingStorage,
  {
    readonly load: Effect.Effect<readonly Entry[], StorageError>;
    readonly save: (entries: readonly Entry[]) => Effect.Effect<void, StorageError>;
  }
>()('ReadingList/Storage') {}
const storageError = (error: unknown): StorageError => ({
  _tag: 'StorageError',
  message: String(error),
});
const storageFailure = (cause: Cause.Cause<StorageError>) => {
  const failure = Cause.squash(cause);
  return typeof failure === 'object' &&
    failure !== null &&
    '_tag' in failure &&
    failure._tag === 'StorageError'
    ? (failure as StorageError).message
    : String(failure);
};
interface Model {
  readonly entries: readonly Entry[];
  readonly draft: string;
  readonly filter: string;
  readonly loaded: boolean;
  readonly saving: boolean;
  readonly error: string;
}
type Message =
  | { type: 'Load' }
  | { type: 'Loaded'; entries: readonly Entry[] }
  | { type: 'Draft'; text: string }
  | { type: 'Filter'; text: string }
  | { type: 'Add'; id: string }
  | { type: 'Toggle'; id: string }
  | { type: 'Remove'; id: string }
  | { type: 'Saved' }
  | { type: 'Failed'; error: string }
  | { type: 'RetrySave' };
const entries = collection<Entry>((entry) => entry.id);
const List = view<Model, Message>((model, send) => {
  const visible = entries
    .from(model.entries)
    .filter((entry) => entry.title.toLowerCase().includes(model.filter.toLowerCase()));
  return (
    <main>
      <header>
        <p>Effect + compiled JSX</p>
        <h1>Reading list</h1>
        <p>A personal list saved in this browser.</p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send({ type: 'Add', id: newId() });
        }}
      >
        <label>
          Book or article
          <input
            aria-label="Book or article"
            value={model.draft}
            onInput={(event) => send({ type: 'Draft', text: event.currentTarget.value })}
          />
        </label>
        <button disabled={!model.loaded || !model.draft.trim()}>Add to list</button>
      </form>
      <label>
        Filter
        <input
          aria-label="Filter"
          value={model.filter}
          onInput={(event) => send({ type: 'Filter', text: event.currentTarget.value })}
        />
      </label>
      <p role="status">
        {!model.loaded
          ? 'Loading…'
          : model.saving
            ? 'Saving…'
            : `${model.entries.length} saved entries`}
      </p>
      {model.error ? (
        <aside role="alert">
          {model.error}
          <button onClick={() => send({ type: model.loaded ? 'RetrySave' : 'Load' })}>Retry</button>
        </aside>
      ) : null}
      <ul>
        {visible.map((entry) => (
          <li data-entry-id={entry.id}>
            <label>
              <input
                type="checkbox"
                checked={entry.read}
                onChange={() => send({ type: 'Toggle', id: entry.id })}
              />
              <span class={entry.read ? 'read' : ''}>{entry.title}</span>
            </label>
            <button
              aria-label={`Remove ${entry.title}`}
              onClick={() => send({ type: 'Remove', id: entry.id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
});
// Called by a native event, never during rendering.
const newId = () => crypto.randomUUID();
export function mountReadingList(parent: Element, storage: Storage) {
  // Services are supplied once for the application; component disposal never closes storage.
  const runtime = uiRuntime(
    Context.make(ReadingStorage, {
      load: storage.load.pipe(Effect.mapError(storageError)),
      save: (items) =>
        Effect.suspend(() => storage.save(items)).pipe(Effect.mapError(storageError)),
    }),
  );
  const save = (items: readonly Entry[]): Command<Message, ReadingStorage> =>
    effectCommand(
      commandSave,
      () => Effect.flatMap(ReadingStorage, (storage) => storage.save(items)),
      {
        policy: 'replace',
        onSuccess: (): Message => ({ type: 'Saved' }),
        onFailure: (cause): Message => ({ type: 'Failed', error: storageFailure(cause) }),
      },
    );
  const source = runtime.program<Model, Message>({
    name: 'reading-list',
    initial: { entries: [], draft: '', filter: '', loaded: false, saving: false, error: '' },
    update: (model, message) => {
      switch (message.type) {
        case 'Load':
          return {
            model: { ...model, error: '' },
            commands: [
              effectCommand(
                commandLoad,
                () => Effect.flatMap(ReadingStorage, (storage) => storage.load),
                {
                  policy: 'replace',
                  onSuccess: (entries): Message => ({ type: 'Loaded', entries }),
                  onFailure: (cause): Message => ({ type: 'Failed', error: storageFailure(cause) }),
                },
              ),
            ],
          };
        case 'Loaded':
          return { model: { ...model, entries: message.entries, loaded: true } };
        case 'Draft':
          return { model: { ...model, draft: message.text } };
        case 'Filter':
          return { model: { ...model, filter: message.text } };
        case 'Failed':
          return { model: { ...model, saving: false, error: message.error } };
        case 'Saved':
          return { model: { ...model, saving: false, error: '' } };
        case 'RetrySave':
          return { model: { ...model, saving: true, error: '' }, commands: [save(model.entries)] };
        case 'Add':
        case 'Toggle':
        case 'Remove': {
          if (!model.loaded || (message.type === 'Add' && !model.draft.trim())) return { model };
          const entries =
            message.type === 'Add'
              ? [...model.entries, { id: message.id, title: model.draft.trim(), read: false }]
              : message.type === 'Remove'
                ? model.entries.filter((entry) => entry.id !== message.id)
                : model.entries.map((entry) =>
                    entry.id === message.id ? { ...entry, read: !entry.read } : entry,
                  );
          return {
            model: {
              ...model,
              entries,
              draft: message.type === 'Add' ? '' : model.draft,
              saving: true,
              error: '',
            },
            commands: [save(entries)],
          };
        }
      }
    },
  });
  const unmount = mountView(parent, List, source);
  source.send({ type: 'Load' });
  return () => {
    unmount();
    source.dispose();
  };
}
