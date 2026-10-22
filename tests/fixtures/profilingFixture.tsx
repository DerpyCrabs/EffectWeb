import { modelOwner, view, mapSource, mount } from 'effectweb';
export function profilingFixture(host: HTMLElement) {
  const owner = modelOwner({ count: 0, title: 'first' });
  const source = mapSource(owner.source, (m) => ({ count: m.count, title: m.title }));
  const app = view((m: { count: number; title: string }) => (
    <button onClick={() => owner.patch({ count: m.count + 1 })}>
      {m.title}:{m.count}
    </button>
  ));
  const mounted = mount(host, app, source);
  return {
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
  };
}
