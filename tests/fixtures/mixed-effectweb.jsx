import { view, modelOwner, mountView } from 'effectweb';

const Counter = view((model, send) => (
  <button onClick={() => send(model.count + 1)}>EffectWeb {model.count}</button>
));

export function mountCounter(host) {
  const owner = modelOwner({ count: 0 });
  const unmount = mountView(host, Counter, {
    ...owner.source,
    send: (count) => owner.patch({ count }),
  });
  return () => {
    unmount();
    owner.dispose();
  };
}
