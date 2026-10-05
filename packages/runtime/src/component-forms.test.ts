// @vitest-environment happy-dom
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { expect, it } from 'vitest';
import { component, ownerOf } from './component.js';
import { view } from './dom.js';
import { jsx } from './jsx-runtime.js';
import { controlledEffect, renderView } from './testing.js';

const text = (host: Element, selector: string) => host.querySelector(selector)?.textContent;

it('component with fields only patches its own state and follows props', () => {
  const Counter = component<{ label: string }, { count: number }>(
    { init: () => ({ count: 0 }) },
    view((model, patch) =>
      jsx('button', {
        onClick: () => patch({ count: model.count + 1 }),
        children: `${model.props.label}:${model.count}`,
      }),
    ),
  );
  const host = document.createElement('div');
  const rendered = renderView(host, Counter, { label: 'a' });
  host.querySelector('button')!.click();
  expect(text(host, 'button')).toBe('a:1');
  rendered.update({ label: 'b' });
  expect(text(host, 'button')).toBe('b:1');
  rendered.dispose();
});

it('a fields component runs owned work through ownerOf(patch) and publishes its result', async () => {
  const save = controlledEffect<number, string>();
  const Form = component(
    {
      init: (props: { readonly id: string }) => ({
        draft: props.id,
        saved: AsyncResult.initial() as AsyncResult.AsyncResult<number, string>,
      }),
    },
    view((model, patch) =>
      jsx('form', {
        children: [
          jsx('input', {
            value: model.draft,
            onInput: (event: Event) =>
              patch({ draft: (event.currentTarget as HTMLInputElement).value }),
          }),
          jsx('button', {
            disabled: model.saved.waiting,
            onClick: () =>
              ownerOf(patch).task(
                'saved',
                (model.draft + '!').length > 0 ? save.effect : Effect.succeed(0),
                'drop',
              ),
            children: AsyncResult.isSuccess(model.saved) ? String(model.saved.value) : 'save',
          }),
        ],
      }),
    ),
  );
  const host = document.createElement('div');
  const rendered = renderView(host, Form, { id: 'x' });
  host.querySelector('button')!.click();
  expect(host.querySelector('button')!.disabled).toBe(true);
  host.querySelector('button')!.click();
  expect(save.pending()).toBe(1);
  save.succeed(7);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(text(host, 'button')).toBe('7');
  expect(host.querySelector('button')!.disabled).toBe(false);
  rendered.dispose();
});

it('a fields component keeps runtime-owned props out of patches and rejects a foreign patch', () => {
  let patchRef!: (fields: object) => void;
  const Probe = component(
    { init: (_props: { readonly label: string }) => ({ count: 0 }) },
    view((model, patch) => {
      patchRef = patch as never;
      return jsx('p', { children: `${model.props.label}:${model.count}` });
    }),
  );
  const host = document.createElement('div');
  const rendered = renderView(host, Probe, { label: 'a' });
  patchRef({ count: 2, props: { label: 'forged' } });
  expect(text(host, 'p')).toBe('a:2');
  expect(() => ownerOf(() => {})).toThrow(/fields component/);
  rendered.dispose();
});

it('row keys publish one result per row and a busy row does not block another', async () => {
  const requests = new Map<string, ReturnType<typeof controlledEffect<string>>>([
    ['a', controlledEffect<string>()],
    ['b', controlledEffect<string>()],
  ]);
  const Rows = component(
    {
      init: (_props: {}) => ({
        liked: {} as Partial<Record<string, AsyncResult.AsyncResult<string, never>>>,
      }),
    },
    view((model, patch) =>
      jsx('ul', {
        children: ['a', 'b'].map((id) =>
          jsx('button', {
            id,
            disabled: model.liked[id]?.waiting ?? false,
            onClick: () => ownerOf(patch).task(['liked', id], requests.get(id)!.effect, 'drop'),
            children: model.liked[id] && AsyncResult.isSuccess(model.liked[id]) ? 'done' : id,
          }),
        ),
      }),
    ),
  );
  const host = document.createElement('div');
  const rendered = renderView(host, Rows, {});
  const button = (id: string) => host.querySelector<HTMLButtonElement>(`#${id}`)!;
  button('a').click();
  button('a').click();
  button('b').click();
  expect(requests.get('a')!.pending()).toBe(1);
  expect(requests.get('b')!.pending()).toBe(1);
  expect(button('a').disabled).toBe(true);
  requests.get('a')!.succeed('ok');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(text(host, '#a')).toBe('done');
  expect(button('b').disabled).toBe(true);
  rendered.dispose();
  expect(requests.get('b')!.canceled()).toBe(1);
});

it('component with messages receives props and reduces messages', () => {
  const Stepper = component<{ step: number }, { n: number }, 'inc'>(
    {
      init: () => ({ n: 0 }),
      update: (model) => ({ model: { ...model, n: model.n + model.props.step } }),
    },
    view((model, send) => jsx('button', { onClick: () => send('inc'), children: String(model.n) })),
  );
  const host = document.createElement('div');
  const rendered = renderView(host, Stepper, { step: 2 });
  host.querySelector('button')!.click();
  rendered.update({ step: 10 });
  host.querySelector('button')!.click();
  expect(text(host, 'button')).toBe('12');
  rendered.dispose();
});

it('an identity change interrupts in-flight work and its late completion never reaches the new instance', async () => {
  let resolve!: (value: number) => void;
  const settled = new Promise<number>((done) => {
    resolve = done;
  });
  let interrupted = 0;
  const Editor = component(
    {
      init: (props: { readonly id: string }) => ({
        id: props.id,
        load: AsyncResult.initial() as AsyncResult.AsyncResult<number, never>,
      }),
      identity: (props) => props.id,
    },
    view((model, patch) =>
      jsx('button', {
        onClick: () =>
          ownerOf(patch).task(
            'load',
            Effect.promise(() => settled).pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted++;
                }),
              ),
            ),
            'replace',
          ),
        children: `${model.id}:${AsyncResult.isSuccess(model.load) ? model.load.value : model.load.waiting ? 'waiting' : 'idle'}`,
      }),
    ),
  );
  const host = document.createElement('div');
  const rendered = renderView(host, Editor, { id: 'a' });
  host.querySelector('button')!.click();
  expect(text(host, 'button')).toBe('a:waiting');
  rendered.update({ id: 'b' });
  expect(text(host, 'button')).toBe('b:idle');
  resolve(42);
  await new Promise((done) => setTimeout(done, 0));
  expect(text(host, 'button')).toBe('b:idle');
  expect(interrupted).toBe(1);
  rendered.dispose();
});
