import { view } from './index.js';

// Handlers written as conditionals return null or undefined; the listener ignores those like a bare void.
export const Conditional = view<{ readonly enabled: boolean; readonly fire: () => void }>(
  (props) => (
    <div>
      <button onClick={() => (props.enabled ? props.fire() : null)}>null</button>
      <button onClick={() => (props.enabled ? props.fire() : undefined)}>undefined</button>
      <button onClick={() => props.enabled && props.fire()}>boolean</button>
      <select onChange={(event) => (event.currentTarget.value ? props.fire() : null)} />
    </div>
  ),
);
