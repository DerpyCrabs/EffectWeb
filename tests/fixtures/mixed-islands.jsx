/** @jsxImportSource solid-js */
import { createSignal, onSettled } from 'solid-js';
import { render } from '@solidjs/web';
import { mountCounter } from './mixed-effectweb.jsx';

export function mountMixedIslands(parent) {
  function App() {
    const [count, setCount] = createSignal(0);
    let host;
    onSettled(() => {
      return mountCounter(host);
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
