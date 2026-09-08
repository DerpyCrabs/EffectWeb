import { Effect } from 'effect';
import { view, program, mountView, domMount, effectEvent, type JSX, type View } from 'effectweb';

const MountPublication = view<{ count: number }, number>((model, send) => (
  <section>
    <b>{model.count}</b>
    <i
      use={domMount(() => {
        send(1);
        return () => {};
      })}
    />
    <b>{model.count}</b>
  </section>
));

type Events = { click?: JSX.EventHandler<HTMLButtonElement, MouseEvent> };
const OptionalDirect = view<Events>((model) => <button onClick={model.click}>direct</button>);
const OptionalSpread = view<Events>((model) => (
  <button {...{ onClick: model.click }}>spread</button>
));

const records: string[] = [];
const start = effectEvent('replace', () =>
  Effect.callback<void>(() => {
    records.push('started');
    return Effect.sync(() => records.push('interrupted'));
  }),
);
const DirectEffect = view<{ label: string }>((model) => (
  <button data-label={model.label} onClick={start}>
    direct
  </button>
));
const SpreadEffect = view<{ label: string }>((model) => (
  <button {...{ 'data-label': model.label }} onClick={start}>
    spread
  </button>
));

const InlineDirect = view<{ label: string }>((model) => (
  <button data-label={model.label} onClick={(event) => start(event)}>
    inline direct
  </button>
));
const InlineSpread = view<{ label: string }>((model) => (
  <button {...{ 'data-label': model.label, onClick: (event: MouseEvent) => start(event) }}>
    inline spread
  </button>
));
const FactoryDirect = view<{ label: string }>((model) => (
  <button
    data-label={model.label}
    onClick={effectEvent('replace', () =>
      Effect.callback<void>(() => {
        records.push('started');
        return Effect.sync(() => records.push('interrupted'));
      }),
    )}
  >
    factory direct
  </button>
));
const FactorySpread = view<{ label: string }>((model) => (
  <button
    {...{
      'data-label': model.label,
      onClick: effectEvent('replace', () =>
        Effect.callback<void>(() => {
          records.push('started');
          return Effect.sync(() => records.push('interrupted'));
        }),
      ),
    }}
  >
    factory spread
  </button>
));

const Forwarded = view<{
  label: string;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}>((model) => (
  <button data-label={model.label} onClick={model.onClick}>
    forwarded
  </button>
));
const ForwardedEffect = view<{ label: string }>((model) => (
  <Forwarded label={model.label} onClick={start} />
));

const ForwardedSpreadEffect = view<{ label: string }>((model) => (
  <Forwarded {...{ label: model.label, onClick: start }} />
));

type ModelEvents = {
  attributes: { title: string; onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent> };
};
const ModelSpread = view<ModelEvents>((model) => (
  <button {...model.attributes}>model spread</button>
));
const CaptureDirect = view<Events>((model) => (
  <button onClickCapture={model.click}>capture</button>
));
const CaptureSpread = view<Events>((model) => (
  <button {...{ onClickCapture: model.click }}>capture spread</button>
));

const released: string[] = [];
const release = () => {
  released.push('disposed');
};
const SelfRemoving = view<{ show: boolean }, boolean>((model, send) => (
  <main>
    {model.show && (
      <b
        use={domMount(() => {
          send(false);
          return release;
        })}
      >
        host
      </b>
    )}
  </main>
));

const BlurDraft = view<{ settings: { text: string; other: number } }>((model) => {
  const settings = model.settings;
  return <textarea value={settings.text} onBlur={() => {}} />;
});

export async function ownershipContracts() {
  records.length = 0;
  released.length = 0;
  const mount = <M,>(initial: M, definition: import('effectweb').View<M, never>) => {
    const source = program<M, M>({ initial, update: (_, model) => ({ model }) });
    const errors: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const stop = mountView(host, definition, source, { onError: (e) => errors.push(String(e)) });
    return {
      source,
      host,
      errors,
      dispose: () => {
        stop();
        source.dispose();
        host.remove();
      },
    };
  };
  const root = document.createElement('div');
  document.body.append(root);
  const source = program<{ count: number }, number>({
    initial: { count: 0 },
    update: (_, count) => ({ model: { count } }),
  });
  const stop = mountView(root, MountPublication, source);
  await Promise.resolve();
  const initialPublication = { model: source.model(), dom: root.textContent };
  stop();
  source.dispose();
  root.remove();

  const direct = mount<Events>({}, OptionalDirect);
  const spread = mount<Events>({}, OptionalSpread);
  direct.host.querySelector('button')!.click();
  spread.host.querySelector('button')!.click();
  const optionalEvents = { direct: direct.errors, spread: spread.errors };
  direct.dispose();
  spread.dispose();

  const draft = mount({ settings: { text: '', other: 0 } }, BlurDraft);
  const textarea = draft.host.querySelector('textarea')!;
  textarea.value = 'unfinished draft';
  draft.source.send({ settings: { text: '', other: 1 } });
  const blurDraft = textarea.value;
  draft.source.send({ settings: { text: 'published edit', other: 1 } });
  const publishedDraft = textarea.value;
  draft.dispose();

  const lifecycle = [];
  for (const definition of [
    DirectEffect,
    SpreadEffect,
    InlineDirect,
    InlineSpread,
    FactoryDirect,
    FactorySpread,
    ForwardedEffect,
    ForwardedSpreadEffect,
  ]) {
    records.length = 0;
    const f = mount({ label: 'before' }, definition);
    f.host.querySelector('button')!.click();
    const started = [...records];
    f.source.send({ label: 'after' });
    lifecycle.push({ started, afterUpdate: [...records], errors: f.errors });
    f.dispose();
  }

  const modelSpread = mount<ModelEvents>(
    { attributes: { title: 'before', onClick: start } },
    ModelSpread,
  );
  records.length = 0;
  modelSpread.host.querySelector('button')!.click();
  modelSpread.source.send({ attributes: { title: 'after', onClick: start } });
  const modelSpreadEvents = [...records];
  modelSpread.dispose();

  const optionalTransitions = [];
  for (const definition of [
    OptionalDirect,
    OptionalSpread,
    CaptureDirect,
    CaptureSpread,
  ] satisfies View<Events, never>[]) {
    records.length = 0;
    const fixture = mount<Events>({}, definition);
    const click = () => fixture.host.querySelector('button')!.click();
    click();
    fixture.source.send({ click: start });
    click();
    const replacement = effectEvent('replace', () =>
      Effect.callback<void>(() => {
        records.push('replacement');
        return Effect.sync(() => records.push('replacement interrupted'));
      }),
    );
    fixture.source.send({ click: replacement });
    click();
    fixture.source.send({});
    click();
    fixture.dispose();
    optionalTransitions.push({ events: [...records], errors: fixture.errors });
  }

  const selfRoot = document.createElement('div');
  document.body.append(selfRoot);
  const selfSource = program<{ show: boolean }, boolean>({
    initial: { show: true },
    update: (_, show) => ({ model: { show } }),
  });
  const selfStop = mountView(selfRoot, SelfRemoving, selfSource);
  await Promise.resolve();
  const selfRemoval = {
    model: selfSource.model(),
    dom: selfRoot.textContent,
    cleanups: [...released],
  };
  selfStop();
  selfSource.dispose();
  selfRoot.remove();
  return {
    initialPublication,
    optionalEvents,
    lifecycle,
    selfRemoval,
    blurDraft,
    publishedDraft,
    modelSpreadEvents,
    optionalTransitions,
  };
}
