import {
  domMount,
  mountView,
  program,
  slot,
  ViewBinding,
  Portal as Overlay,
  type DomMount,
  type JSX,
} from 'effectweb';
// oxlint-disable-next-line no-restricted-imports -- Regression fixture exercises explicit foreign compiled content boundaries.
import { view as importedView } from 'effectweb/dom';
import { ScalarContract } from './scalarContract';
const view = importedView;

type Model = {
  selected: string;
  options: readonly string[];
  style: string | JSX.CSSProperties;
  flag: boolean;
  values: JSX.Element;
  label: string;
  showSlots: boolean;
  clicked: number;
  host: DomMount;
};
const Portal = view<{ label: string }>((model) => <b data-own-portal>{model.label}</b>);
const Button = view<{ label: string }, 'Clicked'>((model, send) => (
  <button data-bound onClick={() => send('Clicked')}>
    {model.label}
  </button>
));
const Contract = view<Model, Partial<Model>>((model, send) => {
  const cell = slot<{ text: string }>((value) => (
    <b data-cell use={model.host}>
      {model.label}:{value.text}
    </b>
  ));
  return (
    <main>
      <select data-direct value={model.selected}>
        {model.options.map((option) => (
          <option value={option}>{option}</option>
        ))}
      </select>
      <select data-spread {...{ value: model.selected }}>
        {model.options.map((option) => (
          <option value={option}>{option}</option>
        ))}
      </select>
      <div data-style style={model.style} />
      <div data-style-spread {...{ style: model.style }} />
      <input data-spell spellcheck={model.flag} />
      <div data-translate translate={model.flag} />
      <a data-download download={model.flag}>
        download
      </a>
      <img data-drag draggable={model.flag} />
      <div contentEditable="true">
        <b data-edit contentEditable={model.flag}>
          editable
        </b>
      </div>
      <div
        data-static
        draggable={false}
        spellcheck={false}
        contentEditable={false}
        translate={false}
      />
      <section data-values>{model.values}</section>
      <section data-slots>
        {model.showSlots ? [cell({ text: 'one' }), [cell({ text: 'two' })]] : []}
      </section>
      <Portal label={model.label} />
      <Overlay>
        <i data-overlay>{model.label}</i>
      </Overlay>
      <Overlay children={model.label} />
      <ViewBinding
        view={Button}
        model={{ label: model.label }}
        send={() => send({ clicked: model.clicked + 1 })}
      />
      <span data-scalar>
        <ScalarContract label={model.label} />
      </span>
    </main>
  );
});
export function mountContracts(parent: HTMLElement) {
  let starts = 0,
    stops = 0;
  const errors: string[] = [];
  const host = domMount((_element: Element) => {
    starts++;
    return () => {
      stops++;
    };
  });
  const source = program<Model, Partial<Model>>({
    initial: {
      selected: 'b',
      options: ['a', 'b'],
      style: 'color:red;background-color:blue',
      flag: false,
      values: ['a', ['b', null, false], 2],
      label: 'first',
      showSlots: true,
      clicked: 0,
      host,
    },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, Contract, source, {
    onError: (error) => errors.push(String(error)),
  });
  return {
    source,
    errors,
    lifetime: () => ({ starts, stops }),
    dispose: () => {
      unmount();
      source.dispose();
    },
  };
}
