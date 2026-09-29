// Every snippet in AUTHORING.md is kept here so the guide typechecks against the real API.
import { Effect } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import {
  actionCommand,
  AsyncContent,
  clock,
  observe,
  commandSlot,
  commandSlots,
  component,
  defineTasks,
  domBinding,
  domMount,
  effectCommand,
  effectEvent,
  entities,
  errorBoundary,
  list,
  localComponent,
  modelOwner,
  sequence,
  submit,
  view,
  ViewBinding,
  type Snapshot,
  type Transition,
} from './index.js';
import {
  makeQueryCache,
  observeQuery,
  query,
  querySource,
  type QueryCache,
} from '@effectweb/query';

// --- Views -------------------------------------------------------------------
type Todo = { readonly id: string; readonly title: string; readonly done: boolean };
type TodoMessage = { type: 'Toggle'; id: string } | { type: 'Rename'; id: string; title: string };

export const TodoRow = view<Todo, TodoMessage>((todo, send) => (
  <li>
    <input
      type="checkbox"
      checked={todo.done}
      onChange={() => send({ type: 'Toggle', id: todo.id })}
    />
    <input
      value={todo.title}
      onInput={(event) => send({ type: 'Rename', id: todo.id, title: event.currentTarget.value })}
    />
  </li>
));

// --- Lists -------------------------------------------------------------------
export const TodoList = view<{ readonly todos: readonly Todo[] }, TodoMessage>((model, send) => (
  <ul>
    {list(entities(model.todos), (todo) => (
      <ViewBinding view={TodoRow} model={todo} send={send} />
    ))}
  </ul>
));
export const Tags = view<{ readonly tags: readonly string[] }>((model) => (
  <p>
    {list(sequence(model.tags), (tag) => (
      <span class="tag">{tag}</span>
    ))}
  </p>
));

// --- Local state -------------------------------------------------------------
export const Disclosure = localComponent<{ readonly title: string }, { open: boolean }>({
  init: () => ({ open: false }),
  view: view((local, patch) => (
    <section>
      <button aria-expanded={local.open} onClick={() => patch({ open: !local.open })}>
        {local.props.title}
      </button>
      {local.open ? <p>Details</p> : null}
    </section>
  )),
});

// --- Local state with Effect work ---------------------------------------------
declare const api: {
  rename: (id: string, title: string) => Effect.Effect<void, Error>;
  search: (text: string) => Effect.Effect<readonly string[], Error>;
};
const renaming = defineTasks({
  init: (props: Snapshot<{ readonly id: string; readonly title: string }>) => ({
    draft: props.title,
  }),
  identity: (props) => props.id,
}).tasks({ save: { policy: 'drop', run: (model) => api.rename(model.props.id, model.draft) } });
export const RenameForm = renaming.view(
  view((model, send) => {
    const controls = renaming.controls(send);
    return (
      <form onSubmit={submit(() => controls.run('save'))}>
        <input
          value={model.draft}
          onInput={(event) => controls.patch({ draft: event.currentTarget.value })}
        />
        <button disabled={model.tasks.save.waiting}>Save</button>
        {AsyncResult.isFailure(model.tasks.save) ? <p role="alert">Rename failed</p> : null}
      </form>
    );
  }),
);

// --- Elm-style component -------------------------------------------------------
type SearchModel = {
  readonly props: { readonly placeholder: string };
  readonly text: string;
  readonly results: readonly string[];
};
type SearchMessage =
  | { type: 'Input'; text: string }
  | { type: 'Found'; results: readonly string[] }
  | { type: 'Failed' };
const searchSlot = commandSlot('search');
export const Search = component<SearchModel['props'], SearchModel, SearchMessage>({
  init: (props) => ({ props, text: '', results: [] }),
  update: (model, message): Transition<SearchModel, SearchMessage> => {
    switch (message.type) {
      case 'Input':
        return {
          model: { ...model, text: message.text },
          commands: [
            effectCommand(
              searchSlot,
              () => Effect.sleep(250).pipe(Effect.andThen(api.search(message.text))),
              {
                policy: 'replace',
                onSuccess: (results): SearchMessage => ({ type: 'Found', results }),
                onFailure: (): SearchMessage => ({ type: 'Failed' }),
              },
            ),
          ],
        };
      case 'Found':
        return { model: { ...model, results: message.results } };
      case 'Failed':
        return { model: { ...model, results: [] } };
    }
  },
  view: view((model, send) => (
    <div>
      <input
        placeholder={model.props.placeholder}
        value={model.text}
        onInput={(event) => send({ type: 'Input', text: event.currentTarget.value })}
      />
      <ul>
        {list(sequence(model.results), (result) => (
          <li>{result}</li>
        ))}
      </ul>
    </div>
  )),
});

// --- Controllers ---------------------------------------------------------------
const loadSlot = commandSlot('load');
const priceSlot = commandSlots('price');
declare const prices: { quote: (row: string, amount: number) => Effect.Effect<number, Error> };
export function orderController() {
  const owner = modelOwner({
    rows: [] as readonly {
      readonly id: string;
      readonly amount: number;
      readonly price?: number;
    }[],
    loading: false,
    error: '',
  });
  const load = () => {
    owner.patch({ loading: true, error: '' });
    owner.run(
      loadSlot,
      Effect.sleep(10).pipe(
        Effect.andThen(Effect.sync(() => owner.patch({ loading: false, rows: [] }))),
      ),
      'replace',
    );
  };
  const changeAmount = (id: string, amount: number) => {
    owner.edit('rows', (rows) => rows.map((row) => (row.id === id ? { ...row, amount } : row)));
    // One debounced quote per row: editing row A never cancels row B's request.
    owner.run(
      priceSlot(id),
      Effect.sleep(300).pipe(
        Effect.andThen(prices.quote(id, amount)),
        Effect.tap((price) =>
          Effect.sync(() =>
            owner.edit('rows', (rows) =>
              rows.map((row) => (row.id === id && row.amount === amount ? { ...row, price } : row)),
            ),
          ),
        ),
        Effect.catch((error) => Effect.sync(() => owner.patch({ error: error.message }))),
      ),
      'replace',
    );
  };
  return { source: owner.source, load, changeAmount, dispose: owner.dispose };
}

// --- Event handlers that run Effects -------------------------------------------
declare const clipboard: { copy: (text: string) => Effect.Effect<void, Error> };
export const CopyButton = view<{ readonly text: string }>((model) => (
  <button onClick={effectEvent('drop', () => clipboard.copy(model.text))}>Copy</button>
));

// --- Queries -------------------------------------------------------------------
type User = { readonly id: string; readonly name: string };
declare const users: { get: (id: string) => Effect.Effect<User, Error> };
const userQuery = query({
  name: 'user',
  staleTime: 30_000,
  load: (args: { readonly id: string }) => users.get(args.id),
});
export function profileController(id: string) {
  const owner = modelOwner<{ user: AsyncResult.AsyncResult<Snapshot<User>, Error> }>({
    user: AsyncResult.initial(),
  });
  const cache = owner.own(makeQueryCache());
  const user = observeQuery(owner, cache, userQuery, (result) => owner.patch({ user: result }));
  user.select({ id });
  return { source: owner.source, refresh: user.refresh, dispose: owner.dispose };
}
// Views can read a query directly; equal arguments share one cached, live source.
declare const appCache: QueryCache;
export const UserName = view<{ readonly id: string }>((model) =>
  observe(querySource(appCache, userQuery, { id: model.id }), (user) => (
    <AsyncContent result={user} content={(value) => <b>{value.name}</b>} />
  )),
);
export const Profile = view<{ readonly user: AsyncResult.AsyncResult<User, Error> }>((model) => (
  <AsyncContent
    result={model.user}
    pending={<p>Loading…</p>}
    content={(user) => <h1>{user.name}</h1>}
    failure={() => <p role="alert">Could not load the profile.</p>}
  />
));

// --- DOM access ------------------------------------------------------------------
const autofocus = domMount((element: HTMLInputElement) => element.focus());
export const SearchBox = view<{ readonly text: string }>((model) => (
  <input use={autofocus} value={model.text} />
));
declare const chart: {
  create: (canvas: HTMLCanvasElement) => {
    draw: (points: readonly number[]) => void;
    destroy: () => void;
  };
};
// Declared once at module scope: the acquire function is the binding's identity.
const drawChart = (canvas: HTMLCanvasElement, points: () => Snapshot<readonly number[]>) => {
  const instance = chart.create(canvas);
  instance.draw(points());
  return { update: () => instance.draw(points()), dispose: instance.destroy };
};
export const Chart = view<{ readonly points: readonly number[] }>((model) => (
  <canvas use={domBinding(model.points, drawChart)} />
));

// --- Error boundaries ------------------------------------------------------------
export const SafeProfile = errorBoundary(Profile, {
  fallback: view(({ error }) => <p role="alert">Profile failed: {String(error)}</p>),
});

// --- Handing results to the parent from update -----------------------------------
type RateProps = { readonly rate: number; readonly onChange: (rate: number) => void };
const quoteSlot = commandSlot('quote');
const applySlot = commandSlot('apply-rate');
export const RateEditor = component<
  RateProps,
  { readonly props: RateProps },
  { type: 'Edit'; rate: number } | { type: 'Quoted'; rate: number } | { type: 'Failed' }
>({
  init: (props) => ({ props }),
  update: (model, message) => {
    switch (message.type) {
      case 'Edit':
        return {
          model,
          commands: [
            effectCommand(quoteSlot, () => prices.quote('rate', message.rate), {
              policy: 'replace',
              onSuccess: (rate) => ({ type: 'Quoted' as const, rate }),
              onFailure: () => ({ type: 'Failed' as const }),
            }),
          ],
        };
      case 'Quoted':
        return {
          model,
          commands: [
            actionCommand(
              applySlot,
              () => Effect.sync(() => model.props.onChange(message.rate)),
              'queue',
            ),
          ],
        };
      case 'Failed':
        return { model };
    }
  },
  view: view((model, send) => (
    <input
      value={String(model.props.rate)}
      onInput={(event) => send({ type: 'Edit', rate: Number(event.currentTarget.value) })}
    />
  )),
});

// --- Time -------------------------------------------------------------------------
const minute = clock(60_000);
const ago = (iso: string, now: number) => `${Math.round((now - Date.parse(iso)) / 60_000)}m ago`;
export const Updated = view<{ readonly at: string }>((model) => (
  <time>{observe(minute, (now) => ago(model.at, now))}</time>
));
