import { expect, test } from '@playwright/test';

test('explicitly augmented custom tags retain their native lifecycle and attribute updates', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/nativeEventsFixture.tsx';
    const { mountNativeAttributes } = (await import(
      path
    )) as typeof import('../fixtures/nativeEventsFixture');
    const lifecycle = { connected: 0, disconnected: 0 };
    class NativeProbe extends HTMLElement {
      static get observedAttributes() {
        return ['level-label'];
      }
      connectedCallback() {
        lifecycle.connected++;
      }
      disconnectedCallback() {
        lifecycle.disconnected++;
      }
      attributeChangedCallback(_name: string, _previous: string | null, next: string | null) {
        this.textContent = next;
      }
    }
    customElements.define('effectweb-native-probe', NativeProbe);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountNativeAttributes(host);
    const element = host.querySelector('effectweb-native-probe')!;
    const initial = element.textContent;
    source.set(true);
    const updated = element.textContent;
    const retained = element === host.querySelector('effectweb-native-probe');
    const native = element instanceof NativeProbe;
    source.dispose();
    host.remove();
    return { initial, updated, retained, native, lifecycle };
  });
  expect(result).toEqual({
    initial: 'initial',
    updated: 'updated',
    retained: true,
    native: true,
    lifecycle: { connected: 1, disconnected: 1 },
  });
});

test('compiled native media, editor, drag, touch, form and canvas handlers retain native payloads', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/nativeEventsFixture.tsx';
    const { mountNativeEvents } = (await import(
      path
    )) as typeof import('../fixtures/nativeEventsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const recorded: string[] = [];
    const source = mountNativeEvents(host, (label, event, detail = '') => {
      const target = event.currentTarget;
      recorded.push(
        `${label}:${event.type}:${target instanceof Element ? target.id : ''}:${event.eventPhase}:${detail}`,
      );
    });
    const node = (id: string) => host.querySelector(`#${id}`)!;
    const media = node('media');
    media.dispatchEvent(new Event('canplay'));
    const data = new DataTransfer();
    data.setData('text/plain', 'file.txt');
    node('drag').dispatchEvent(new DragEvent('dragstart', { dataTransfer: data }));
    const drag = new DragEvent('dragenter', { cancelable: true });
    node('drag').dispatchEvent(drag);
    node('drag').dispatchEvent(new DragEvent('dragend'));
    node('drag').dispatchEvent(
      new TouchEvent('touchstart', {
        touches: [new Touch({ identifier: 1, target: node('drag') })],
      }),
    );
    node('editor').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    node('editor').dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText' }));
    node('editor').dispatchEvent(new CompositionEvent('compositionend', { data: '語' }));
    node('editor').dispatchEvent(new ClipboardEvent('copy', { clipboardData: data }));
    const form = new FormData();
    form.set('draft', 'saved');
    node('form').dispatchEvent(new FormDataEvent('formdata', { formData: form }));
    const cancel = new Event('cancel', { cancelable: true });
    node('dialog').dispatchEvent(cancel);
    const context = new WebGLContextEvent('webglcontextlost', {
      cancelable: true,
      statusMessage: 'lost',
    });
    node('canvas').dispatchEvent(context);
    source.set({ label: 'latest' });
    media.dispatchEvent(new Event('canplay'));
    const same = node('media') === media;
    const events = [...recorded];
    source.dispose();
    media.dispatchEvent(new Event('canplay'));
    const disposed = recorded.length === events.length && host.childNodes.length === 0;
    host.remove();
    return {
      events,
      prevented: [drag.defaultPrevented, cancel.defaultPrevented, context.defaultPrevented],
      same,
      disposed,
    };
  });
  expect(result).toEqual({
    events: [
      'first:canplay:media:2:',
      'first:dragstart:drag:2:file.txt',
      'first:dragenter:drag:2:',
      'first:dragend:drag:2:',
      'first:touchstart:drag:2:1',
      'first:focusin:editor:2:',
      'first:beforeinput:editor:2:insertText',
      'first:compositionend:editor:2:語',
      'first:copy:editor:2:file.txt',
      'first:formdata:form:2:saved',
      'first:cancel:dialog:2:',
      'first:webglcontextlost:canvas:2:lost',
      'latest:canplay:media:2:',
    ],
    prevented: [true, true, true],
    same: true,
    disposed: true,
  });
});

test('pointer capture and SVG timing events work directly and in spreads with native phase ordering', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/nativeEventsFixture.tsx';
    const { mountNativeEvents } = (await import(
      path
    )) as typeof import('../fixtures/nativeEventsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const recorded: string[] = [];
    const source = mountNativeEvents(host, (label, event, detail = '') => {
      const target = event.currentTarget;
      recorded.push(
        `${label}:${event.type}:${target instanceof Element ? target.id : ''}:${event.eventPhase}:${detail}`,
      );
    });
    const direct = host.querySelector('#pointer-direct')!;
    const spread = host.querySelector('#pointer-spread')!;
    for (const target of [direct, spread]) {
      for (const type of ['gotpointercapture', 'lostpointercapture']) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7 }));
      }
    }
    const pointerEvents = recorded.splice(0);
    source.set({ label: 'latest', listening: false });
    spread.dispatchEvent(new PointerEvent('gotpointercapture', { bubbles: true, pointerId: 8 }));
    const removed = recorded.splice(0);
    const animation = host.querySelector('#animation')!;
    for (const type of ['beginEvent', 'endEvent', 'repeatEvent']) {
      animation.dispatchEvent(new UIEvent(type, { detail: 3, view: window }));
    }
    const timing = recorded.splice(0);
    source.dispose();
    direct.dispatchEvent(new PointerEvent('gotpointercapture', { bubbles: true, pointerId: 9 }));
    animation.dispatchEvent(new UIEvent('beginEvent'));
    const disposed = recorded.length === 0;
    host.remove();
    return { pointerEvents, removed, timing, disposed };
  });
  const pointerEvents = ['pointer-direct', 'pointer-spread'].flatMap((target) =>
    ['gotpointercapture', 'lostpointercapture'].flatMap((type) => [
      `first:${type}:pointer-parent:1:capture`,
      `first:${type}:${target}:2:capture:7`,
      `first:${type}:${target}:2:bubble:7`,
      `first:${type}:pointer-parent:3:bubble`,
    ]),
  );
  expect(result).toEqual({
    pointerEvents,
    removed: [
      'latest:gotpointercapture:pointer-parent:1:capture',
      'latest:gotpointercapture:pointer-parent:3:bubble',
    ],
    timing: [
      'latest:beginEvent:animation:2:capture:3',
      'latest:beginEvent:animation:2:bubble:3',
      'latest:endEvent:animation:2:3',
      'latest:repeatEvent:animation:2:3',
    ],
    disposed: true,
  });
});

test('native media booleans, SVG animated attributes and shared tag names serialize and update correctly', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/nativeEventsFixture.tsx';
    const { mountNativeAttributes } = (await import(
      path
    )) as typeof import('../fixtures/nativeEventsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountNativeAttributes(host);
    const video = host.querySelector('video')!;
    const gradient = host.querySelector('linearGradient')!;
    const blur = host.querySelector('feGaussianBlur')!;
    const convolve = host.querySelector('feConvolveMatrix')!;
    const instance = host.querySelector('use')!;
    const link = host.querySelector('svg a')!;
    const editable = host.querySelector<HTMLElement>('#editable')!;
    const values = () => ({
      media: [video.disablePictureInPicture, video.disableRemotePlayback],
      mediaAttributes: [
        video.hasAttribute('disablepictureinpicture'),
        video.hasAttribute('disableremoteplayback'),
      ],
      gradient: gradient.getAttribute('gradientTransform'),
      blur: blur.stdDeviationX.baseVal,
      preserveAlpha: [convolve.getAttribute('preserveAlpha'), convolve.preserveAlpha.baseVal],
      href: instance.href.baseVal,
      transform: link.getAttribute('transform'),
      editable: editable.contentEditable,
    });
    const before = values();
    source.set(true);
    const after = values();
    const retained =
      gradient === host.querySelector('linearGradient') && instance === host.querySelector('use');
    const shared = ['svg-link', 'svg-title', 'svg-style', 'svg-script'].map(
      (id) => host.querySelector(`#${id}`)!.namespaceURI,
    );
    const attributes = {
      gradientUnits: gradient.getAttribute('gradientUnits'),
      spreadMethod: gradient.getAttribute('spreadMethod'),
      filterInput: blur.getAttribute('in'),
      anchor: host.querySelector('text')!.getAttribute('text-anchor'),
      textLength: host.querySelector('text')!.getAttribute('textLength'),
      linkFill: link.getAttribute('fill'),
      vectorEffect: link.getAttribute('vector-effect'),
      scriptHref: host.querySelector('svg script')!.getAttribute('href'),
      part: editable.getAttribute('part'),
      exportparts: editable.getAttribute('exportparts'),
    };
    source.set(false);
    const restored = values();
    source.dispose();
    host.remove();
    return { before, after, restored, retained, shared, attributes };
  });
  const initial = {
    media: [false, false],
    mediaAttributes: [false, false],
    gradient: 'rotate(0)',
    blur: 2,
    preserveAlpha: ['true', true],
    href: '#shape',
    transform: 'translate(1 2)',
    editable: 'inherit',
  };
  expect(result).toEqual({
    before: initial,
    after: {
      media: [true, true],
      mediaAttributes: [true, true],
      gradient: 'rotate(45)',
      blur: 4,
      preserveAlpha: ['false', false],
      href: '#gradient',
      transform: 'translate(3 4)',
      editable: 'true',
    },
    restored: initial,
    retained: true,
    shared: Array(4).fill('http://www.w3.org/2000/svg'),
    attributes: {
      gradientUnits: 'userSpaceOnUse',
      spreadMethod: 'reflect',
      filterInput: 'SourceGraphic',
      anchor: 'middle',
      textLength: '80',
      linkFill: 'red',
      vectorEffect: 'non-scaling-stroke',
      scriptHref: '#unused',
      part: 'surface',
      exportparts: 'surface:outer-surface',
    },
  });
});
