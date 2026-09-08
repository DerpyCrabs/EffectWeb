import { Cause } from 'effect';
import {
  domMount,
  fromPromise,
  lazyView,
  mountView,
  program,
  view,
  ViewBinding,
  type Program,
} from 'effectweb';
import type { LazyMessage, LazyModel } from './lazyViewModule';

const Pending = view<LazyModel, LazyMessage>((model, send) => (
  <button
    data-lazy-pending
    use={model.pending}
    onClick={() => send({ type: 'Click', title: model.title })}
  >
    Loading {model.title}
  </button>
));
const Failure = view<{ model: LazyModel; cause: Cause.Cause<unknown> }, LazyMessage>((model) => (
  <button data-lazy-failure use={model.model.failure}>
    Failed {model.model.title}: {Cause.pretty(model.cause)}
  </button>
));

export function createLazyViewFixture(parent: HTMLElement, withFailure = true) {
  const counts = {
    starts: 0,
    aborted: 0,
    loadedMounts: 0,
    loadedDisposals: 0,
    pendingMounts: 0,
    pendingDisposals: 0,
    failureMounts: 0,
    failureDisposals: 0,
  };
  const errors: string[] = [];
  const events: Array<{ id: string; title: string }> = [];
  let removeOnPendingDisposal: string | undefined;
  const requests: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    settled: Promise<void>;
  }> = [];
  const Lazy = lazyView(
    () => {
      counts.starts++;
      return fromPromise((signal) => {
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const ready = new Promise<void>((accept, fail) => {
          resolve = accept;
          reject = fail;
        });
        const loaded = ready.then(() => import('./lazyViewModule').then((module) => module.Loaded));
        requests.push({
          resolve,
          reject,
          settled: loaded.then(
            () => {},
            () => {},
          ),
        });
        signal.addEventListener(
          'abort',
          () => {
            counts.aborted++;
          },
          { once: true },
        );
        return loaded;
      });
    },
    { pending: Pending, ...(withFailure ? { failure: Failure } : {}) },
  );
  const Placement = view<LazyModel, LazyMessage>((model, send) => (
    <ViewBinding view={Lazy} model={model} send={send} />
  ));
  const placements = new Map<
    string,
    { source: Program<LazyModel, LazyMessage>; host: HTMLElement; unmount: () => void }
  >();
  const loaded = domMount((_element: HTMLButtonElement) => {
    counts.loadedMounts++;
    return () => {
      counts.loadedDisposals++;
    };
  });
  const pending = domMount((_element: HTMLButtonElement) => {
    counts.pendingMounts++;
    return () => {
      counts.pendingDisposals++;
      const id = removeOnPendingDisposal;
      removeOnPendingDisposal = undefined;
      if (id !== undefined) unmount(id);
    };
  });
  const failure = domMount((_element: HTMLButtonElement) => {
    counts.failureMounts++;
    return () => {
      counts.failureDisposals++;
    };
  });
  const unmount = (id: string) => {
    const placement = placements.get(id);
    if (!placement) return;
    placement.unmount();
    placement.source.dispose();
    placement.host.remove();
    placements.delete(id);
  };
  return {
    mount(id: string, title: string) {
      const host = document.createElement('section');
      host.dataset.lazyPlacement = id;
      parent.append(host);
      const source = program<LazyModel, LazyMessage>({
        initial: { title, loaded, pending, failure },
        update: (model, message) => {
          if (message.type === 'Title') return { model: { ...model, title: message.title } };
          events.push({ id, title: message.title });
          return { model };
        },
      });
      placements.set(id, {
        source,
        host,
        unmount: mountView(host, Placement, source, {
          onError: (error) => errors.push(String(error)),
        }),
      });
    },
    update: (id: string, title: string) =>
      placements.get(id)!.source.send({ type: 'Title', title }),
    unmount,
    unmountOnPendingDisposal(id: string) {
      removeOnPendingDisposal = id;
    },
    resolve(index: number) {
      const request = requests[index]!;
      request.resolve();
      return request.settled;
    },
    reject(index: number, message: string) {
      const request = requests[index]!;
      request.reject(new Error(message));
      return request.settled;
    },
    state: () => ({ ...counts, errors: [...errors], events: [...events] }),
    dispose() {
      for (const id of placements.keys()) unmount(id);
    },
  };
}
