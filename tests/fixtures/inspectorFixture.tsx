import { mountView, mountBindingInspector, inspectBindings, program, view } from 'effectweb';

export function mountInspectorFixture(app: HTMLElement, panel: HTMLElement) {
  const View = view<{ title: string; count: number }>((model) => {
    const fixed = 'Title: ';
    return (
      <section>
        <label htmlFor="static-input">Static</label>
        <label htmlFor={model.title}>Dynamic</label>
        <input id="static-input" />
        <input id={model.title} />
        <p>{fixed + model.title}</p>
        <output>{model.count}</output>
      </section>
    );
  });
  const inspector = inspectBindings();
  const removePanel = mountBindingInspector(panel, inspector);
  const source = program<{ title: string; count: number }, { title?: string; count?: number }>({
    initial: { title: 'before', count: 0 },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(app, View, source);
  return {
    set: source.send,
    entries: () => inspector.entries(),
    dispose() {
      unmount();
      source.dispose();
      removePanel();
      inspector.dispose();
    },
  };
}
