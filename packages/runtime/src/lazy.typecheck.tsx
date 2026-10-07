/* oxlint-disable effecttsgo/missing-effect-context -- Negative lazy loader service contracts. */
import { Cause, Context, Effect } from 'effect';
import { view, type View } from './index.js';
import { lazyView } from './advanced.js';

type Model = { title: string };
type Message = { type: 'Click'; title: string };
const Loaded = view<Model, Message>((model, send) => (
  <button onClick={() => send({ type: 'Click', title: model.title })}>{model.title}</button>
));
const Pending = view<Model, Message>((model) => <span>{model.title}</span>);
const Failure = view<{ model: Model; cause: Cause.Cause<'offline'> }, Message>((model) => (
  <span>{model.model.title}</span>
));
const load = (): Effect.Effect<View<Model, Message>, 'offline'> => Effect.succeed(Loaded);
const Lazy = lazyView(load, { pending: Pending, failure: Failure });
const typed: View<Model, Message> = Lazy;
// @ts-expect-error A lazy view with messages still requires an explicit dispatcher.
const unbound = <Lazy title="loaded" />;
const ReadOnly = lazyView(() => Effect.succeed(view<Model>((model) => <span>{model.title}</span>)));
const readOnly = <ReadOnly title="loaded" />;

const WrongPending = view<{ title: number }, Message>((model) => <span>{model.title}</span>);
// @ts-expect-error The pending view cannot widen model inference from the loader.
lazyView(load, { pending: WrongPending });
const WrongDispatch = view<Model, 'Unrelated'>((model) => <span>{model.title}</span>);
// @ts-expect-error The pending view cannot widen message inference from the loader.
lazyView(load, { pending: WrongDispatch });
const WrongFailure = view<{ model: Model; cause: Cause.Cause<'unauthorized'> }, Message>(
  (model) => <span>{model.model.title}</span>,
);
// @ts-expect-error The failure view cannot widen the loader's typed error channel.
lazyView(load, { failure: WrongFailure });
const WrongFailureModel = view<
  { model: { title: number }; cause: Cause.Cause<'offline'> },
  Message
>((model) => <span>{model.model.title}</span>);
// @ts-expect-error Failure model inputs are fixed by the loaded view.
lazyView(load, { failure: WrongFailureModel });

class Loader extends Context.Service<Loader, { loaded: View<Model, Message> }>()('Lazy/Loader') {}
class Other extends Context.Service<Other, { value: string }>()('Lazy/Other') {}
const serviceLoad = () => Effect.map(Loader, (service) => service.loaded);
const loaderContext = Context.make(Loader, { loaded: Loaded });
lazyView(() => serviceLoad().pipe(Effect.provideContext(loaderContext)), { pending: Pending });
// @ts-expect-error A loader's services are provided in the Effect, not by the view.
lazyView(serviceLoad);
// @ts-expect-error Pending content cannot discharge the loader's service requirement.
lazyView(serviceLoad, { pending: Pending });
// @ts-expect-error An unrelated context cannot provide the loader service.
lazyView(() => serviceLoad().pipe(Effect.provideContext(Context.make(Other, { value: 'other' }))));
void [typed, unbound, readOnly];
