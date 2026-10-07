// @vitest-environment happy-dom
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { component, controllerView, programView } from './component.js';
import { compiled, Scope, view } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { modelOwner } from './owner.js';
import { program } from './program.js';
import { controlledEffect, renderView } from './testing.js';

type Props = { id: string };

it('owner factories run once per placement, preserve props, and close owned work', async () => {
  const request = controlledEffect<void>();
  const factory = vi.fn();
  const Counter = component({ init: (_props: Props) => ({ count: 0 }) }, (owner) => {
    factory();
    owner.run('request', request.effect, 'replace');
    return view((model) =>
      jsx('button', {
        onClick: () => owner.patch({ count: owner.read().count + 1 }),
        children: `${model.props.id}:${model.count}`,
      }),
    );
  });
  const left = document.createElement('div');
  const right = document.createElement('div');
  const a = renderView(left, Counter, { id: 'a' });
  const b = renderView(right, Counter, { id: 'b' });
  left.querySelector('button')!.click();
  a.update({ id: 'changed' });
  expect(left.textContent).toBe('changed:1');
  expect(right.textContent).toBe('b:0');
  expect(factory).toHaveBeenCalledTimes(2);
  expect(request.pending()).toBe(2);
  await Effect.runPromise(a.close());
  expect(request.pending()).toBe(1);
  await Effect.runPromise(b.close());
  expect(request.pending()).toBe(0);
});

it('a throwing owner factory releases work and joins asynchronous finalizers', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finalized = vi.fn();
  const Broken = component({ init: (_props: Props) => ({ count: 0 }) }, (owner) => {
    owner.run(
      'work',
      Effect.never.pipe(
        Effect.ensuring(Effect.promise(() => gate).pipe(Effect.andThen(Effect.sync(finalized)))),
      ),
      'replace',
    );
    throw new Error('factory failed');
  });
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  expect(() => Broken.build(scope, document.createElement('div'), null)).toThrow('factory failed');
  expect(scope.disposed).toBe(true);
  let settled = false;
  const closing = Effect.runPromise(scope.settlement.wait()).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await closing;
  expect(finalized).toHaveBeenCalledOnce();
});

it('explicit controller lifetime awaits finalizers and is absent from rendered actions', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = modelOwner({ count: 0 });
  owner.run('work', Effect.never.pipe(Effect.ensuring(Effect.promise(() => gate))), 'replace');
  const OwnedView = controllerView(
    {
      controller: (_props: Props) => ({
        source: owner.source,
        lifetime: { dispose: () => owner.dispose(), close: () => owner.close() },
        increment: () => owner.patch({ count: 1 }),
      }),
    },
    compiled((scope) => {
      expect(Object.keys(scope.value.actions)).toEqual(['increment']);
    }),
  );
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  OwnedView.build(scope, document.createElement('div'), null);
  scope.dispose();
  let settled = false;
  const closing = Effect.runPromise(scope.settlement.wait()).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await closing;
});

it('explicit lifecycle methods retain their receiver', async () => {
  class Lifetime {
    #closed = false;
    dispose() {
      this.#closed = true;
    }
    close() {
      return Effect.sync(() => this.dispose());
    }
    get closed() {
      return this.#closed;
    }
  }
  const lifetime = new Lifetime();
  const owner = modelOwner({ count: 0 });
  const OwnedView = controllerView(
    { controller: (_props: Props) => ({ source: owner.source, lifetime }) },
    compiled(() => {}),
  );
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  OwnedView.build(scope, document.createElement('div'), null);
  scope.dispose();
  await Effect.runPromise(scope.settlement.wait());
  expect(lifetime.closed).toBe(true);
  await Effect.runPromise(owner.close());
});

it('a factory that disposes its placement cannot build or leak child resources', async () => {
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  const build = vi.fn();
  const request = controlledEffect<void>();
  const OwnedView = component({ init: (_props: Props) => ({ count: 0 }) }, (owner) => {
    owner.run('work', request.effect, 'replace');
    scope.dispose();
    return compiled(build);
  });
  OwnedView.build(scope, document.createElement('div'), null);
  await Effect.runPromise(scope.settlement.wait());
  expect(build).not.toHaveBeenCalled();
  expect(request.pending()).toBe(0);
});

it('props changed during factory setup reach the first child render', () => {
  const scope = new Scope<Props, never>({ id: 'old' }, () => {});
  let seen: unknown;
  const OwnedView = component({ init: (_props: Props) => ({ count: 0 }) }, (_owner) => {
    scope.set({ id: 'new' });
    return compiled((child) => {
      seen = child.value.props.id;
    });
  });
  OwnedView.build(scope, document.createElement('div'), null);
  expect(seen).toBe('new');
  scope.dispose();
});

it('setup reconciliation that disposes a placement cannot invoke its view factory', async () => {
  const scope = new Scope<Props, never>({ id: 'old' }, () => {});
  const build = vi.fn();
  const factory = vi.fn(() => compiled<Props, never>(build));
  const OwnedView = programView<Props, Props, never>({
    create: (props) => {
      scope.set({ id: 'new' });
      return program({ initial: props, update: (model) => ({ model }) });
    },
    receive: () => scope.dispose(),
    view: factory,
  });
  OwnedView.build(scope, document.createElement('div'), null);
  await Effect.runPromise(scope.settlement.wait());
  expect(factory).not.toHaveBeenCalled();
  expect(build).not.toHaveBeenCalled();
});
