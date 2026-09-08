import { view, type DomMount } from 'effectweb';

export interface LazyModel {
  title: string;
  loaded: DomMount<HTMLButtonElement>;
  pending: DomMount<HTMLButtonElement>;
  failure: DomMount<HTMLButtonElement>;
}
export type LazyMessage = { type: 'Click' | 'Title'; title: string };

export const Loaded = view<LazyModel, LazyMessage>((model, send) => (
  <div>
    <input data-lazy-draft />
    <button
      data-lazy-loaded
      use={model.loaded}
      onClick={() => send({ type: 'Click', title: model.title })}
    >
      {model.title}
    </button>
  </div>
));
