// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { Effect, Exit } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { compile } from '../../compiler/src/compile.js';
import * as dom from './dom.js';
import { modelOwner } from './owner.js';
import { liveSource } from './source.js';
import { protectSnapshot } from './snapshot.js';
import { controlledEffect } from './testing.js';

function compiledView<M>(render: string): dom.View<M, never> {
  const source = `import { view, list } from 'effectweb'; export const App = view(${render});`;
  const code = transformSync(compile(source, 'regression.tsx').code, { format: 'cjs' }).code;
  const module = { exports: {} as { App: dom.View<M, never> } };
  runInNewContext(code, { module, exports: module.exports, require: () => dom });
  return module.exports.App;
}

it('changes list rendering when equal captures come from different callback sites', () => {
  const owner = modelOwner({ flip: false, rows: ['a', 'b'] });
  const host = document.createElement('div');
  const stop = dom.mount(
    host,
    compiledView<{ flip: boolean; rows: string[] }>(
      'm => m.flip ? list(m.rows, r => <b>{r}</b>) : list(m.rows, r => <i>{r}</i>)',
    ),
    owner.source,
  );
  expect(host.querySelectorAll('i')).toHaveLength(2);
  owner.patch({ flip: true });
  expect(host.querySelectorAll('b')).toHaveLength(2);
  expect(host.querySelectorAll('i')).toHaveLength(0);
  stop();
  owner.dispose();
});

it.each(['(row, index = 0) => <i>{row}{index}</i>', '(row, ...rest) => <i>{row}{rest[0]}</i>'])(
  'updates shifted indices for %s',
  (render) => {
    const owner = modelOwner({ rows: ['a', 'b'] });
    const host = document.createElement('div');
    const stop = dom.mount(
      host,
      compiledView<{ rows: string[] }>(`m => list(m.rows, ${render})`),
      owner.source,
    );
    expect(host.textContent).toBe('a0b1');
    owner.patch({ rows: ['b', 'a'] });
    expect(host.textContent).toBe('b0a1');
    stop();
    owner.dispose();
  },
);

it('publishes task outcomes only after resource finalizers finish', async () => {
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<number> }>({
    saved: AsyncResult.initial(),
  });
  const finalizer = controlledEffect<void>();
  const run = owner.task(
    'saved',
    Effect.acquireRelease(Effect.succeed(42), () => finalizer.effect),
    'drop',
  );
  expect(owner.read().saved.waiting).toBe(true);
  expect(owner.isRunning('saved')).toBe(true);
  finalizer.succeed(undefined);
  expect(await Effect.runPromise(run.await)).toEqual(Exit.succeed(42));
  expect(owner.read().saved._tag).toBe('Success');
  expect(owner.read().saved.waiting).toBe(false);
  owner.dispose();
});

it('publishes scope finalizer defects as task failures', async () => {
  const reports: unknown[] = [];
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<number> }>(
    { saved: AsyncResult.initial() },
    { onDefect: (cause) => reports.push(cause) },
  );
  const run = owner.task(
    'saved',
    Effect.acquireRelease(Effect.succeed(42), () => Effect.die('cleanup')),
    'drop',
  );
  expect((await Effect.runPromise(run.await))._tag).toBe('Failure');
  expect(owner.read().saved._tag).toBe('Failure');
  expect(reports).toHaveLength(1);
  owner.dispose();
});

it('shares a restarted live entry with retained handles in either subscription order', () => {
  for (const oldFirst of [true, false]) {
    let starts = 0;
    let stops = 0;
    let publish!: (value: number | null) => void;
    const family = liveSource({
      initial: (_key: string): number | null => 0,
      subscribe: (_key, next) => {
        starts++;
        publish = next;
        return () => {
          stops++;
        };
      },
    });
    const old = family('a');
    old.subscribe(() => {})();
    const fresh = family('a');
    const seen: (number | null)[] = [];
    const first = (oldFirst ? old : fresh).subscribe((value) => seen.push(value));
    const second = (oldFirst ? fresh : old).subscribe((value) => seen.push(value));
    publish(null);
    expect(starts).toBe(2);
    expect(seen).toEqual([null, null]);
    expect(old.model()).toBeNull();
    expect(fresh.model()).toBeNull();
    first();
    expect(stops).toBe(1);
    second();
    expect(stops).toBe(2);
    expect(old.model()).toBe(0);
    expect(fresh.model()).toBe(0);
  }
});

it('keeps bubbling along the dispatch path when the target removes itself', () => {
  const owner = modelOwner({ show: true });
  const host = document.createElement('div');
  const seen: string[] = [];
  const div = dom.markup('div'),
    button = dom.markup('button');
  const stop = dom.mount(
    host,
    dom.view<{ show: boolean }>((m) =>
      div(
        { onClick: () => seen.push('parent') },
        m.show
          ? button(
              {
                onClick: () => {
                  seen.push('child');
                  owner.patch({ show: false });
                },
              },
              'remove',
            )
          : null,
      ),
    ),
    owner.source,
  );
  host.querySelector('button')!.click();
  expect(seen).toEqual(['child', 'parent']);
  stop();
  owner.dispose();
});

it.each([true, false])(
  'redispatches the same event with bubbling=%s across nested mounts',
  (bubbles) => {
    const seen: string[] = [];
    const host = document.createElement('div');
    const outer = dom.mount(
      host,
      dom.view(() => dom.markup('section')({ onClick: () => seen.push('outer') })),
      {},
    );
    const inner = dom.mount(
      host.querySelector('section')!,
      dom.view(() => dom.markup('button')({ onClick: () => seen.push('inner') })),
      {},
    );
    const event = new Event('click', { bubbles });
    const button = host.querySelector('button')!;
    button.dispatchEvent(event);
    button.dispatchEvent(event);
    expect(seen).toEqual(bubbles ? ['inner', 'outer', 'inner', 'outer'] : ['inner', 'inner']);
    inner();
    outer();
  },
);

it.each([
  'm => m.flip ? <div style={{ backgroundColor: "blue" }}>x</div> : <div style="color:red">x</div>',
  'm => m.flip ? <main><div style={{ backgroundColor: "blue" }}>{m.text}</div></main> : <main><div style="color:red">{m.text}</div></main>',
])('reconciles cloned styles when switching sites: %s', (render) => {
  const owner = modelOwner({ flip: false, text: 'x' });
  const host = document.createElement('div');
  const stop = dom.mount(host, compiledView<{ flip: boolean; text: string }>(render), owner.source);
  const element = host.querySelector('div')!;
  expect(element.style.color).toBe('red');
  owner.patch({ flip: true });
  expect(host.querySelector('div')).toBe(element);
  expect(element.style.color).toBe('');
  expect(element.style.backgroundColor).toBe('blue');
  stop();
  owner.dispose();
});

it('protects all stored array properties without evaluating accessors', () => {
  const symbol = Symbol('metadata');
  const array = Object.assign([{ nested: { n: 1 } }], { meta: { n: 1 }, [symbol]: { n: 1 } });
  Object.defineProperty(array, '1', {
    get: () => {
      throw new Error('getter evaluated');
    },
  });
  protectSnapshot(array);
  expect(Object.isFrozen(array)).toBe(true);
  expect(Object.isFrozen(array[0]!.nested)).toBe(true);
  expect(Object.isFrozen(array.meta)).toBe(true);
  expect(Object.isFrozen(array[symbol])).toBe(true);
});

it('uses current indices when an index-free list changes renderers after moving', () => {
  const owner = modelOwner({ indexed: false, rows: ['a', 'b'] });
  const host = document.createElement('div');
  const stop = dom.mount(
    host,
    compiledView<{ indexed: boolean; rows: string[] }>(
      'm => m.indexed ? list(m.rows, (row, index) => <b>{row}{index}</b>) : list(m.rows, row => <i>{row}</i>)',
    ),
    owner.source,
  );
  owner.patch({ rows: ['b', 'a'] });
  expect(host.textContent).toBe('ba');
  owner.patch({ indexed: true });
  const actual = host.textContent;
  stop();
  owner.dispose();
  expect(actual).toBe('b0a1');
});

it('retries live subscription after setup throws', () => {
  let attempts = 0;
  const source = liveSource({
    initial: (_key: string) => 0,
    subscribe: (_key, publish) => {
      if (++attempts === 1) throw new Error('offline');
      publish(1);
      return () => {};
    },
  })('a');
  expect(() => source.subscribe(() => {})).toThrow('offline');
  const stop = source.subscribe(() => {});
  const value = source.model();
  stop();
  expect(value).toBe(1);
});

it('runs capture before nonbubbling target handlers', () => {
  const calls: string[] = [];
  const owner = modelOwner({
    capture: () => {
      calls.push('capture');
    },
    bubble: () => {
      calls.push('target');
    },
  });
  const host = document.createElement('div');
  const stop = dom.mount(
    host,
    compiledView<{ capture: () => void; bubble: () => void }>(
      'm => <input onChangeCapture={m.capture} onChange={m.bubble} />',
    ),
    owner.source,
  );
  host.querySelector('input')!.dispatchEvent(new Event('change'));
  stop();
  owner.dispose();
  expect(calls).toEqual(['capture', 'target']);
});

it('keeps identical live callbacks independently subscribed and ignores failed producers', () => {
  let attempts = 0;
  let stops = 0;
  const publishers: Array<(value: number) => void> = [];
  const family = liveSource({
    initial: (_key: string) => 0,
    subscribe: (_key, publish) => {
      publishers.push(publish);
      if (++attempts === 1) {
        publish(1);
        throw new Error('offline');
      }
      return () => {
        stops++;
      };
    },
  });
  const source = family('key');
  expect(() => source.subscribe(() => {})).toThrow('offline');
  expect(source.model()).toBe(0);
  const values: number[] = [];
  const listener = (value: number) => {
    values.push(value);
  };
  const first = source.subscribe(listener);
  const second = family('key').subscribe(listener);
  first();
  expect(stops).toBe(0);
  publishers[0]!(99);
  expect(source.model()).toBe(0);
  publishers[1]!(2);
  expect(values).toEqual([2]);
  second();
  expect(stops).toBe(1);
});

it('honors ancestor capture cancellation before a nonbubbling target handler', () => {
  const calls: string[] = [];
  const owner = modelOwner({
    capture: (event: Event) => {
      calls.push('capture');
      event.stopPropagation();
    },
    target: () => {
      calls.push('target');
    },
  });
  const host = document.createElement('div');
  const stop = dom.mount(
    host,
    compiledView<{ capture: (event: Event) => void; target: () => void }>(
      'm => <div onChangeCapture={m.capture}><input onChange={m.target} /></div>',
    ),
    owner.source,
  );
  host.querySelector('input')!.dispatchEvent(new Event('change'));
  expect(calls).toEqual(['capture']);
  stop();
  owner.dispose();
});
