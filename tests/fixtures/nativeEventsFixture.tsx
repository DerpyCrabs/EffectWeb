import { mountView, program, view, type JSX } from 'effectweb';

declare module 'effectweb/jsx' {
  namespace JSX {
    interface IntrinsicElements {
      'effectweb-native-probe': JSX.Attributes<HTMLElement> & { 'level-label'?: string };
    }
  }
}

export const invalidCustomAttribute: JSX.IntrinsicElements['effectweb-native-probe'] = {
  // @ts-expect-error Explicit custom-tag augmentation keeps attribute types precise.
  'level-label': false,
};
// @ts-expect-error Augmenting one tag does not admit arbitrary unknown tags.
export const unknownCustomTag: JSX.IntrinsicElements['effectweb-unknown-probe'] = {};

export function mountNativeEvents(
  parent: HTMLElement,
  record: (label: string, event: Event, detail?: string) => void,
) {
  type Model = { label: string; listening: boolean };
  const Content = view<Model>((model) => (
    <main>
      <video id="media" preload="none" onCanPlay={(event) => record(model.label, event)} />
      <div
        id="drag"
        draggable
        onDragStart={(event) =>
          record(model.label, event, event.dataTransfer?.getData('text/plain'))
        }
        onDragEnter={(event) => {
          event.preventDefault();
          record(model.label, event);
        }}
        onDragEnd={(event) => record(model.label, event)}
        onTouchStart={(event) => record(model.label, event, String(event.touches.length))}
      />
      <textarea
        id="editor"
        onFocusIn={(event) => record(model.label, event)}
        onBeforeInput={(event) => record(model.label, event, event.inputType)}
        onCompositionEnd={(event) => record(model.label, event, event.data)}
        onCopy={(event) => record(model.label, event, event.clipboardData?.getData('text/plain'))}
      />
      <form
        id="form"
        onFormData={(event) => {
          const draft = event.formData.get('draft');
          record(model.label, event, typeof draft === 'string' ? draft : '');
        }}
      />
      <dialog
        id="dialog"
        onCancel={(event) => {
          event.preventDefault();
          record(model.label, event);
        }}
      />
      <canvas
        id="canvas"
        onWebGLContextLost={(event) => {
          event.preventDefault();
          record(model.label, event, event.statusMessage);
        }}
      />
      <section
        id="pointer-parent"
        onGotPointerCapture={(event) => record(model.label, event, 'bubble')}
        onGotPointerCaptureCapture={(event) => record(model.label, event, 'capture')}
        onLostPointerCapture={(event) => record(model.label, event, 'bubble')}
        onLostPointerCaptureCapture={(event) => record(model.label, event, 'capture')}
      >
        <button
          id="pointer-direct"
          onGotPointerCapture={(event) => record(model.label, event, `bubble:${event.pointerId}`)}
          onGotPointerCaptureCapture={(event) =>
            record(model.label, event, `capture:${event.pointerId}`)
          }
          onLostPointerCapture={(event) => record(model.label, event, `bubble:${event.pointerId}`)}
          onLostPointerCaptureCapture={(event) =>
            record(model.label, event, `capture:${event.pointerId}`)
          }
        >
          Direct
        </button>
        <button
          id="pointer-spread"
          {...(model.listening
            ? {
                onGotPointerCapture: (event: PointerEvent) =>
                  record(model.label, event, `bubble:${event.pointerId}`),
                onGotPointerCaptureCapture: (event: PointerEvent) =>
                  record(model.label, event, `capture:${event.pointerId}`),
                onLostPointerCapture: (event: PointerEvent) =>
                  record(model.label, event, `bubble:${event.pointerId}`),
                onLostPointerCaptureCapture: (event: PointerEvent) =>
                  record(model.label, event, `capture:${event.pointerId}`),
              }
            : {})}
        >
          Spread
        </button>
      </section>
      <svg>
        <rect>
          <animate
            id="animation"
            attributeName="opacity"
            values="0;1"
            dur="1s"
            begin="indefinite"
            onBegin={(event) => record(model.label, event, `bubble:${event.detail}`)}
            onBeginCapture={(event) => record(model.label, event, `capture:${event.detail}`)}
            {...{
              onEnd: (event: JSX.TimeEvent) => record(model.label, event, String(event.detail)),
              onRepeat: (event: JSX.TimeEvent) => record(model.label, event, String(event.detail)),
            }}
          />
        </rect>
      </svg>
    </main>
  ));
  const source = program<Model, Partial<Model>>({
    initial: { label: 'first', listening: true },
    update: (model, patch) => ({ model: { ...model, ...patch } }),
  });
  const unmount = mountView(parent, Content, source);
  return {
    set: source.send,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}

export function mountNativeAttributes(parent: HTMLElement) {
  const Content = view<{ changed: boolean }>((model) => (
    <main>
      <effectweb-native-probe level-label={model.changed ? 'updated' : 'initial'} />
      <video
        id="media"
        preload="none"
        disablepictureinpicture={model.changed}
        disableRemotePlayback={model.changed}
      />
      <div
        id="editable"
        contenteditable={model.changed ? '' : 'inherit'}
        spellcheck=""
        translate=""
        part="surface"
        exportparts="surface:outer-surface"
      />
      <svg viewBox="0 0 100 100">
        <defs>
          <linearGradient
            id="gradient"
            gradientUnits="userSpaceOnUse"
            gradientTransform={model.changed ? 'rotate(45)' : 'rotate(0)'}
            spreadMethod="reflect"
          >
            <stop offset="0" stop-color="red" />
          </linearGradient>
          <filter id="filter" filterUnits="userSpaceOnUse">
            <feGaussianBlur id="blur" in="SourceGraphic" stdDeviation={model.changed ? 4 : 2} />
            <feConvolveMatrix
              id="convolve"
              order="3"
              kernelMatrix="0 1 0 1 -4 1 0 1 0"
              preserveAlpha={model.changed ? 'false' : 'true'}
            />
          </filter>
          <path id="shape" d="M0 0 L10 10" />
        </defs>
        <use id="instance" href={model.changed ? '#gradient' : '#shape'} />
        <text id="text" text-anchor="middle" textLength="80" lengthAdjust="spacingAndGlyphs">
          Label
        </text>
        <a
          id="svg-link"
          href="#shape"
          transform={model.changed ? 'translate(3 4)' : 'translate(1 2)'}
          fill="red"
          vector-effect="non-scaling-stroke"
        />
        <title id="svg-title" fill="red">
          Graphic
        </title>
        <style id="svg-style" font-size="12" />
        <script id="svg-script" type="application/json" href="#unused" />
      </svg>
    </main>
  ));
  const source = program<{ changed: boolean }, boolean>({
    initial: { changed: false },
    update: (_model, changed) => ({ model: { changed } }),
  });
  const unmount = mountView(parent, Content, source);
  return {
    set: source.send,
    dispose() {
      unmount();
      source.dispose();
    },
  };
}
