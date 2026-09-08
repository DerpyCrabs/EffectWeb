import { domMount, mountView, Portal, program, view } from 'effectweb';

export function mountPortal(
  parent: HTMLElement,
  target: Element | undefined,
  cleanup?: () => void,
) {
  type Model = { target: Element | undefined; label: string; clicks: number };
  type Message = { type: 'Input'; target: Element | undefined; label: string } | { type: 'Click' };
  const lifetime = { mounted: 0, disposed: 0 };
  const monitor = domMount(() => {
    lifetime.mounted++;
    return () => {
      lifetime.disposed++;
      cleanup?.();
    };
  });
  const Content = view<Model, Message>((model, send) => (
    <Portal mount={model.target}>
      <section data-portal-content="" use={monitor}>
        <input aria-label="Portal draft" />
        <button onClick={() => send({ type: 'Click' })}>
          {model.label}:{model.clicks}
        </button>
      </section>
    </Portal>
  ));
  const source = program<Model, Message>({
    initial: { target, label: 'first', clicks: 0 },
    update: (model, message) => ({
      model:
        message.type === 'Click'
          ? { ...model, clicks: model.clicks + 1 }
          : { ...model, target: message.target, label: message.label },
    }),
  });
  const unmount = mountView(parent, Content, source);
  return {
    lifetime,
    update: (next: Element | undefined, label: string) =>
      source.send({ type: 'Input', target: next, label }),
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

export function mountSvgPortal(parent: HTMLElement, target: Element) {
  const Content = view<{ target: Element; radius: number }>((model) => (
    <Portal mount={model.target}>
      <circle data-portal-circle="" r={model.radius} />
      <foreignObject>
        <div data-portal-html="">HTML</div>
      </foreignObject>
    </Portal>
  ));
  const source = program<{ target: Element; radius: number }, number>({
    initial: { target, radius: 5 },
    update: (model, radius) => ({ model: { ...model, radius } }),
  });
  const unmount = mountView(parent, Content, source);
  return {
    update: source.send,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
