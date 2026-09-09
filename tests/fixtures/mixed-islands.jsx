import { createSignal, onSettled } from 'solid-js';
import { render } from '@solidjs/web';
import { view, modelOwner, mountView } from 'effectweb';

const Counter = view((model, send) => (
  <button onClick={() => send(model.count + 1)}>EffectWeb {model.count}</button>
));

export function mountMixedIslands(parent) {
  function App() {
    const [count, setCount] = createSignal(0);
    let host;
    onSettled(() => {
      const owner = modelOwner({ count: 0 });
      const unmount = mountView(host, Counter, {
        ...owner.source,
        send: (count) => owner.patch({ count }),
      });
      return () => {
        unmount();
        owner.dispose();
      };
    });
    return (
      <section>
        <button onClick={() => setCount(count() + 1)}>Solid {count()}</button>
        <div
          ref={(element) => {
            host = element;
          }}
        />
      </section>
    );
  }
  return render(() => <App />, parent);
}
