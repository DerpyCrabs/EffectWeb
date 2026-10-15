Live data should change the values the reader sees without replacing the page around them. Keep the last successful data visible during refreshes, preserve row identity and decide when a new ordering may appear.

## Keep row identity

Render rows with `list(entities(rows), render)`, or `list(rows, row => row.code, render)` for another key. Keys must stay the same across polls and pushes. Do not use the refresh timestamp, array index or a newly generated id.

A fresh array and fresh row objects still update the existing keyed rows in place. Unchanged object references let the renderer skip more work. Keys preserve the identity of rows, not their position: inserting or reordering above the reader can still move what they are reading.

## Hold updates while reading

This controller polls every five seconds after the previous request finishes. While the reader has scrolled more than eight pixels from the top, it keeps the displayed rows and stores only the newest complete response. Returning to the top applies that response. The status line always occupies space.

```tsx check
import { Effect } from 'effect';
import { controllerView, domMount, entities, list, modelOwner, view } from 'effectweb';

type Row = { readonly id: string; readonly title: string; readonly count: number };
type Props = { readonly load: () => Effect.Effect<readonly Row[], Error> };
type State = {
  readonly rows: readonly Row[];
  readonly pending: readonly Row[] | null;
  readonly paused: boolean;
  readonly error: string;
};

function feedController(props: Props) {
  const owner = modelOwner<State>({ rows: [], pending: null, paused: false, error: '' });
  const accept = (rows: readonly Row[]) => {
    if (owner.read().paused) owner.patch({ pending: rows, error: '' });
    else owner.patch({ rows, pending: null, error: '' });
  };
  const trackScroll = domMount((element: HTMLDivElement) => {
    const onScroll = () => {
      const paused = element.scrollTop > 8;
      const current = owner.read();
      if (paused === current.paused) return;
      if (!paused && current.pending !== null)
        owner.patch({ paused, rows: current.pending, pending: null });
      else owner.patch({ paused });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => element.removeEventListener('scroll', onScroll);
  });

  owner.run(
    'poll',
    Effect.gen(function* () {
      while (true) {
        yield* props.load().pipe(
          Effect.tap((rows) => Effect.sync(() => accept(rows))),
          Effect.catch((error) => Effect.sync(() => owner.patch({ error: error.message }))),
        );
        yield* Effect.sleep(5_000);
      }
    }),
    'drop',
  );

  return { source: owner.source, scrollMount: () => trackScroll, lifetime: owner };
}

export const LiveFeed = controllerView(
  { controller: feedController },
  view((model) => (
    <section>
      <p style={{ minHeight: '1.5em' }}>
        {model.error || (model.paused ? 'Updates held. Return to the top to resume.' : 'Live')}
      </p>
      <div use={model.actions.scrollMount()} style={{ height: '24rem', overflowY: 'auto' }}>
        <table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col />
            <col style={{ width: '8rem' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {list(entities(model.rows), (row) => (
              <tr>
                <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.title}
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )),
);
```

Supply a stable `load` function when placing `<LiveFeed load={loadRows} />`. The `domMount` is created once per controller, outside rendering. Its listener is removed with the element, and the controller's lifetime interrupts polling when the view leaves. Pass abort signals through your loader when wrapping `fetch`; see [Async work](/docs/tasks/#call-a-promise-api).

A push transport can call the same `accept` function with complete snapshots instead of starting the polling run. Register its unsubscribe function with `owner.own(unsubscribe)`. Do not start both unless the server supplies revisions that let you reject stale responses. This pattern pauses publication to the list, not the network connection.

With [queries](/docs/queries/), retain `available(result)` while `result.waiting` is true. `staleTime` is not a polling interval. Refresh explicitly from owned work; do not alternate the whole table between a spinner and its rows on each refresh.

## Replace a slice or patch an item

`owner.patch({ rows: response })` replaces the rows field while preserving the rest of the model. It does not merge rows by id. For a partial push, create a new array and replace only the changed object:

```tsx check
import { modelOwner } from 'effectweb';

type Row = { readonly id: string; readonly title: string; readonly count: number };
const owner = modelOwner<{ readonly rows: readonly Row[] }>({ rows: [] });

export const replaceRows = (rows: readonly Row[]) => owner.patch({ rows });
export const updateCount = (id: string, count: number) =>
  owner.edit('rows', (rows) => rows.map((row) => (row.id === id ? { ...row, count } : row)));
```

This `.map` transforms data; it does not render JSX. Do not mutate a published row in place. Define insertion, deletion and ordering rules for your push protocol separately.

If updates are deltas, merge them into the latest pending snapshot while paused. Keeping only the last delta loses earlier changes. Keep drafts and selections in separate model fields keyed by id, so replacing server data does not overwrite them.

## Reserve layout space

Use `table-layout: fixed` with a table width and explicit column widths, as above. Clamp or truncate variable-length text if row heights must stay stable. `font-variant-numeric: tabular-nums` gives digits equal widths; reserve enough column space for longer numbers too. Keep loading markers and error messages in a reserved area outside the scroll container.

Charts need stable slots as well. Keep one slot for every day in the selected interval, including days without data. Key by the date, not the value or the rank, and keep the scale fixed across refreshes:

```tsx check
import { list, view } from 'effectweb';

type Props = {
  readonly days: readonly string[];
  readonly counts: Readonly<Record<string, number | undefined>>;
  readonly maximum: number;
};

export const DailyBars = view<Props>((props) => (
  <div style={{ display: 'flex', alignItems: 'end', gap: '4px', height: '8rem' }}>
    {list(props.days, (day) => (
      <div
        title={`${day}: ${props.counts[day] ?? 'No data'}`}
        style={{ flex: '1', height: '100%', display: 'flex', alignItems: 'end' }}
      >
        <div
          style={{
            width: '100%',
            background: 'currentColor',
            height: `${Math.min(100, Math.max(0, ((props.counts[day] ?? 0) / Math.max(1, props.maximum)) * 100))}%`,
          }}
        />
      </div>
    ))}
  </div>
));
```

Build `days` from the selected calendar interval, not from the dates present in a response. An absent value keeps its slot and says “No data”; a measured zero says `0`. Change the interval or scale deliberately, rather than sorting bars on every publication.

## Relative times

Declare a clock once and observe it where time is displayed. Do not read `Date.now()` during rendering and expect a new render later.

```tsx check
import { clock, observe, view } from 'effectweb';

const minute = clock(60_000);

export const Updated = view<{ readonly at: number }>((props) =>
  observe(minute, (now) => (
    <span style={{ display: 'inline-block', minWidth: '12ch', fontVariantNumeric: 'tabular-nums' }}>
      {Math.max(0, Math.floor((now - props.at) / 60_000))} min ago
    </span>
  )),
);
```

`at` is an epoch timestamp in milliseconds. The clock ticks only while observed. This updates the label without polling the server or replacing the list.
