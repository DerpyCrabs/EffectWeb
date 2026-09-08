import { view, ViewBinding, type View } from './dom.js';
import { domMount, domBinding, Portal, type DomMount } from './mount.js';
import { shareValue, type ShareFields } from './share.js';
import { collection } from './collection.js';
import type { JSX } from './jsx.js';

const previous = Object.freeze({ count: 1, rows: [{ tags: ['a'] }] });
const shared = shareValue(previous, { count: 1, rows: [{ tags: ['a'] }] });
// @ts-expect-error Sharing cannot grant mutation rights over a frozen or published branch.
shared.count = 2;
// @ts-expect-error Shared nested arrays remain borrowed.
// oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
shared.rows[0]!.tags.push('b');
const fieldSharing: ShareFields<{ items: { count: number }[] }> = {
  items(previous, next) {
    // @ts-expect-error A field sharer cannot mutate the prior publication.
    previous[0]!.count++;
    // @ts-expect-error A field sharer borrows the incoming data too.
    // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
    next.push({ count: 1 });
    return previous;
  },
};
shareValue({ items: [] }, { items: [{ count: 1 }] }, fieldSharing);
const rows = collection<{ id: string; count: number }>((row) => row.id);
const before = [Object.freeze({ id: 'a', count: 1 })];
const after = rows.share(before, [{ id: 'a', count: 1 }]);
// @ts-expect-error A mutable array cannot erase readonly rights of reused objects.
after[0]!.count++;

const Child: View<{ title: string }, 'Clicked'> = view((m, send) => (
  <button onClick={() => send('Clicked')}>{m.title}</button>
));
const Label = view<{ title: string }>((m) => <b>{m.title}</b>);
export const valid = view<{}>(() => (
  <>
    <Label title="ordinary" />
    <ViewBinding view={Child} model={{ title: 'bound' }} send={(_message: 'Clicked') => {}} />
    <Portal>
      <b>owned portal</b>
    </Portal>
  </>
));
// @ts-expect-error A child requiring messages must have an explicit dispatcher.
const unbound = <Child title="lost message" />;
const Ordinary = (p: { title: string }) => <b>{p.title}</b>;
// @ts-expect-error JSX components must be compiled definitions, not arbitrary functions.
const notCompiled = <Ordinary title="missing .build" />;
const wrongSend = (
  // @ts-expect-error The view determines the message type; the dispatcher cannot widen it.
  <ViewBinding view={Child} model={{ title: 'bound' }} send={(_message: number) => {}} />
);
// @ts-expect-error The view determines the model type.
const wrongModel = <ViewBinding view={Child} model={{ title: 1 }} send={() => {}} />;

const input = domMount((element: HTMLInputElement) => {
  element.select();
  return () => {};
});
const anyElement = domMount((element: Element) => {
  element.setAttribute('data-mounted', 'yes');
  return () => {};
});
const binding = domBinding('value', (element: HTMLInputElement, read) => {
  element.value = read();
  return () => {};
});
const specific: DomMount<HTMLInputElement> = input;
const inputAttributes: JSX.IntrinsicElements['input'] = { use: specific };
const goodHosts = (
  <>
    <input use={input} />
    <input use={binding} />
    <input use={anyElement} />
    <div use={anyElement} />
  </>
);
// @ts-expect-error Input hosts cannot mount on a div.
const wrongHost = <div use={input} />;
// @ts-expect-error Spreads retain the same element requirement.
const wrongSpread = <div {...inputAttributes} />;
// @ts-expect-error Generic annotations cannot erase a host's required element API.
const erasedHost: DomMount = input;
void [unbound, notCompiled, wrongSend, wrongModel, goodHosts, wrongHost, wrongSpread, erasedHost];

const content: JSX.Element = ['first', ['second', null, false]];
// @ts-expect-error Native DOM ownership belongs to use={domMount(...)}.
const nativeContent: JSX.Element = document.createTextNode('native');
// @ts-expect-error Plain data must be presented through a compiled view.
const objectContent: JSX.Element = { title: 'data' };
void [content, nativeContent, objectContent];

domBinding({ count: 1 }, (_element: Element, read) => {
  // @ts-expect-error DOM hosts borrow data from the declaring snapshot.
  read().count++;
  return () => {};
});

// @ts-expect-error Calling a compiled component outside JSX would invoke its runtime guard.
Label({ title: 'wrong invocation' });
// @ts-expect-error ViewBinding is only valid as JSX syntax.
ViewBinding({ view: Child, model: { title: 'wrong invocation' }, send: () => {} });

const DomainProps = view<{ model: string; send: () => void }>((props) => props.model);
const ordinaryDomainProps = <DomainProps model="ordinary" send={() => {}} />;
const Data = view<{ rows: { tags: string[] }[] }>((model) => model.rows[0]?.tags.join(','));
const borrowedProps = <Data rows={shared.rows} />;
void [ordinaryDomainProps, borrowedProps];

export function readonlyDomProperties() {
  // @ts-expect-error Browser layout measurements cannot be supplied as attributes.
  const width = <div clientWidth={100} />;
  // @ts-expect-error Browser readiness belongs to the media element.
  const media = <video readyState={4} />;
  void [width, media];
}

export function propertyOnlyDomState() {
  // @ts-expect-error Media playback state belongs in an owned DOM binding.
  const video = <video currentTime={10} />;
  // @ts-expect-error Scroll position is a property, not a content attribute.
  const scroll = <div scrollTop={10} />;
  // @ts-expect-error Markup content uses compiled children or owned DOM integration.
  const html = <div innerHTML="<b>ignored</b>" />;
  const form = <form acceptCharset="UTF-8" />;
  const input = <input form="editor" list="choices" />;
  const frame = <iframe sandbox="allow-scripts" />;
  const meta = <meta httpEquiv="refresh" content="30" />;
  void [video, scroll, html, form, meta, input, frame];
}
