import type { HtmlAttributes } from './html-attributes.js';
import type { SvgAttributes, SvgPresentationAttributes } from './svg-attributes.js';
import type { SnapshotOpaque } from './snapshot.js';
import type { EffectEventRequest } from './effectEvent.js';
import type { CompiledContent } from './dom.js';
import type { DomMount } from './mount.js';
import type * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
/** Nominal eligibility for compiled JSX components and compiler primitives. */
export const jsxComponent: unique symbol = Symbol('effectweb.component');
/** JSX is a compiler input. No renderer library owns its types. */
export namespace JSX {
  export interface ComponentType {
    readonly [jsxComponent]: true;
  }
  export type ElementType = keyof IntrinsicElements | (ComponentType & ((props: never) => Element));
  /** Immutable compiler input; preserve this recursive presentation type through snapshots. */
  export interface ElementArray extends ReadonlyArray<Element>, SnapshotOpaque {}
  export type Element =
    | string
    | number
    | boolean
    | null
    | undefined
    | CompiledContent
    | ElementArray;
  export type EventResult =
    | void
    | boolean
    | EffectEventRequest
    | Effect.Effect<unknown, unknown, Scope.Scope>;
  export type EventHandler<T, E extends Event> = (
    event: E & { currentTarget: T; target: EventTarget & globalThis.Element },
  ) => EventResult;
  export type EventHandlerUnion<T, E extends Event> = EventHandler<T, E>;
  export type CSSProperties = { [property: string]: string | number | undefined | null };
  /** Standard event payloads not yet declared by the minimum supported TypeScript DOM library. */
  export interface CommandEvent extends Event {
    readonly command: string;
    readonly source: globalThis.Element | null;
  }
  export interface SnapEvent extends Event {
    readonly snapTargetBlock: Node | null;
    readonly snapTargetInline: Node | null;
  }
  export interface TimeEvent extends Event {
    readonly detail: number;
    readonly view: Window | null;
  }
  /** Native element events; window/document listeners belong in an owned DOM binding. */
  export interface Events<T> {
    onAbort?: EventHandler<T, UIEvent> | undefined;
    onAnimationCancel?: EventHandler<T, AnimationEvent> | undefined;
    onAnimationEnd?: EventHandler<T, AnimationEvent> | undefined;
    onAnimationIteration?: EventHandler<T, AnimationEvent> | undefined;
    onAnimationStart?: EventHandler<T, AnimationEvent> | undefined;
    onAuxClick?: EventHandler<T, PointerEvent> | undefined;
    onBeforeInput?: EventHandler<T, InputEvent> | undefined;
    onBeforeMatch?: EventHandler<T, Event> | undefined;
    onBeforeToggle?: EventHandler<T, ToggleEvent> | undefined;
    onBlur?: EventHandler<T, FocusEvent> | undefined;
    onCancel?: EventHandler<T, Event> | undefined;
    onCanPlay?: EventHandler<T, Event> | undefined;
    onCanPlayThrough?: EventHandler<T, Event> | undefined;
    onChange?: EventHandler<T, Event> | undefined;
    onClick?: EventHandler<T, PointerEvent> | undefined;
    onClose?: EventHandler<T, Event> | undefined;
    onCommand?: EventHandler<T, CommandEvent> | undefined;
    onCompositionEnd?: EventHandler<T, CompositionEvent> | undefined;
    onCompositionStart?: EventHandler<T, CompositionEvent> | undefined;
    onCompositionUpdate?: EventHandler<T, CompositionEvent> | undefined;
    onContentVisibilityAutoStateChange?:
      | EventHandler<T, ContentVisibilityAutoStateChangeEvent>
      | undefined;
    onContextLost?: EventHandler<T, Event> | undefined;
    onContextMenu?: EventHandler<T, PointerEvent> | undefined;
    onContextRestored?: EventHandler<T, Event> | undefined;
    onCopy?: EventHandler<T, ClipboardEvent> | undefined;
    onCueChange?: EventHandler<T, Event> | undefined;
    onCut?: EventHandler<T, ClipboardEvent> | undefined;
    onDblClick?: EventHandler<T, MouseEvent> | undefined;
    onDrag?: EventHandler<T, DragEvent> | undefined;
    onDragEnd?: EventHandler<T, DragEvent> | undefined;
    onDragEnter?: EventHandler<T, DragEvent> | undefined;
    onDragLeave?: EventHandler<T, DragEvent> | undefined;
    onDragOver?: EventHandler<T, DragEvent> | undefined;
    onDragStart?: EventHandler<T, DragEvent> | undefined;
    onDrop?: EventHandler<T, DragEvent> | undefined;
    onDurationChange?: EventHandler<T, Event> | undefined;
    onEmptied?: EventHandler<T, Event> | undefined;
    onEnded?: EventHandler<T, Event> | undefined;
    onError?: EventHandler<T, Event> | undefined;
    onFocus?: EventHandler<T, FocusEvent> | undefined;
    onFocusIn?: EventHandler<T, FocusEvent> | undefined;
    onFocusOut?: EventHandler<T, FocusEvent> | undefined;
    onFormData?: EventHandler<T, FormDataEvent> | undefined;
    onFullscreenChange?: EventHandler<T, Event> | undefined;
    onFullscreenError?: EventHandler<T, Event> | undefined;
    onGotPointerCapture?: EventHandler<T, PointerEvent> | undefined;
    onInput?: EventHandler<T, InputEvent> | undefined;
    onInvalid?: EventHandler<T, Event> | undefined;
    onKeyDown?: EventHandler<T, KeyboardEvent> | undefined;
    /** @deprecated Use onKeyDown or onBeforeInput. */
    onKeyPress?: EventHandler<T, KeyboardEvent> | undefined;
    onKeyUp?: EventHandler<T, KeyboardEvent> | undefined;
    onLoad?: EventHandler<T, Event> | undefined;
    onLoadedData?: EventHandler<T, Event> | undefined;
    onLoadedMetadata?: EventHandler<T, Event> | undefined;
    onLoadStart?: EventHandler<T, Event> | undefined;
    onLostPointerCapture?: EventHandler<T, PointerEvent> | undefined;
    onMouseDown?: EventHandler<T, MouseEvent> | undefined;
    onMouseEnter?: EventHandler<T, MouseEvent> | undefined;
    onMouseLeave?: EventHandler<T, MouseEvent> | undefined;
    onMouseMove?: EventHandler<T, MouseEvent> | undefined;
    onMouseOut?: EventHandler<T, MouseEvent> | undefined;
    onMouseOver?: EventHandler<T, MouseEvent> | undefined;
    onMouseUp?: EventHandler<T, MouseEvent> | undefined;
    onPaste?: EventHandler<T, ClipboardEvent> | undefined;
    onPause?: EventHandler<T, Event> | undefined;
    onPlay?: EventHandler<T, Event> | undefined;
    onPlaying?: EventHandler<T, Event> | undefined;
    onPointerCancel?: EventHandler<T, PointerEvent> | undefined;
    onPointerDown?: EventHandler<T, PointerEvent> | undefined;
    onPointerEnter?: EventHandler<T, PointerEvent> | undefined;
    onPointerLeave?: EventHandler<T, PointerEvent> | undefined;
    onPointerMove?: EventHandler<T, PointerEvent> | undefined;
    onPointerOut?: EventHandler<T, PointerEvent> | undefined;
    onPointerOver?: EventHandler<T, PointerEvent> | undefined;
    onPointerRawUpdate?: EventHandler<T, PointerEvent> | undefined;
    onPointerUp?: EventHandler<T, PointerEvent> | undefined;
    onProgress?: EventHandler<T, ProgressEvent> | undefined;
    onRateChange?: EventHandler<T, Event> | undefined;
    onReset?: EventHandler<T, Event> | undefined;
    onResize?: EventHandler<T, UIEvent> | undefined;
    onScroll?: EventHandler<T, Event> | undefined;
    onScrollEnd?: EventHandler<T, Event> | undefined;
    onScrollSnapChange?: EventHandler<T, SnapEvent> | undefined;
    onScrollSnapChanging?: EventHandler<T, SnapEvent> | undefined;
    onSecurityPolicyViolation?: EventHandler<T, SecurityPolicyViolationEvent> | undefined;
    onSeeked?: EventHandler<T, Event> | undefined;
    onSeeking?: EventHandler<T, Event> | undefined;
    onSelect?: EventHandler<T, Event> | undefined;
    onSelectionChange?: EventHandler<T, Event> | undefined;
    onSelectStart?: EventHandler<T, Event> | undefined;
    onSlotChange?: EventHandler<T, Event> | undefined;
    onStalled?: EventHandler<T, Event> | undefined;
    onSubmit?: EventHandler<T, SubmitEvent> | undefined;
    onSuspend?: EventHandler<T, Event> | undefined;
    onTimeUpdate?: EventHandler<T, Event> | undefined;
    onToggle?: EventHandler<T, ToggleEvent> | undefined;
    onTouchCancel?: EventHandler<T, TouchEvent> | undefined;
    onTouchEnd?: EventHandler<T, TouchEvent> | undefined;
    onTouchMove?: EventHandler<T, TouchEvent> | undefined;
    onTouchStart?: EventHandler<T, TouchEvent> | undefined;
    onTransitionCancel?: EventHandler<T, TransitionEvent> | undefined;
    onTransitionEnd?: EventHandler<T, TransitionEvent> | undefined;
    onTransitionRun?: EventHandler<T, TransitionEvent> | undefined;
    onTransitionStart?: EventHandler<T, TransitionEvent> | undefined;
    onVolumeChange?: EventHandler<T, Event> | undefined;
    onWaiting?: EventHandler<T, Event> | undefined;
    onWheel?: EventHandler<T, WheelEvent> | undefined;
  }
  type ElementEvents<T> = Events<T> &
    (T extends HTMLMediaElement
      ? {
          onEncrypted?: EventHandler<T, MediaEncryptedEvent> | undefined;
          onWaitingForKey?: EventHandler<T, Event> | undefined;
        }
      : {}) &
    (T extends HTMLVideoElement
      ? {
          onEnterPictureInPicture?: EventHandler<T, PictureInPictureEvent> | undefined;
          onLeavePictureInPicture?: EventHandler<T, PictureInPictureEvent> | undefined;
        }
      : {}) &
    (T extends HTMLCanvasElement
      ? {
          onWebGLContextCreationError?: EventHandler<T, WebGLContextEvent> | undefined;
          onWebGLContextLost?: EventHandler<T, WebGLContextEvent> | undefined;
          onWebGLContextRestored?: EventHandler<T, WebGLContextEvent> | undefined;
        }
      : {}) &
    (T extends SVGAnimationElement
      ? {
          onBegin?: EventHandler<T, TimeEvent> | undefined;
          onEnd?: EventHandler<T, TimeEvent> | undefined;
          onRepeat?: EventHandler<T, TimeEvent> | undefined;
        }
      : {});
  type Scalar = string | number | boolean;
  type Equal<X, Y> =
    (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y ? 1 : 2 ? true : false;
  // Content attributes are a finite browser contract; writable DOM state is not an attribute.
  type AttributeKey<K extends string> =
    Lowercase<K> extends keyof HtmlAttributes
      ? K | Lowercase<K>
      : K extends 'className' | 'htmlFor' | 'acceptCharset' | 'httpEquiv'
        ? K | Lowercase<K>
        : never;
  type DomAttributes<T> = {
    [K in keyof T as K extends string
      ? Equal<Pick<T, K>, { -readonly [P in K]: T[P] }> extends true
        ? T[K] extends Scalar | null
          ? AttributeKey<K>
          : never
        : never
      : never]?: K extends 'min' | 'max' | 'step' | 'value'
      ? string | number | undefined
      : T[K] extends boolean
        ? boolean | undefined
        : T[K] extends number
          ? number | string | undefined
          : T[K] | undefined;
  };
  type CaptureEvents<T> = {
    [K in keyof ElementEvents<T> as `${K & string}Capture`]?: ElementEvents<T>[K];
  };
  export type Attributes<T> = ElementEvents<T> &
    CaptureEvents<T> &
    Omit<
      DomAttributes<T>,
      'contenteditable' | 'contentEditable' | 'spellcheck' | 'draggable' | 'translate' | 'download'
    > & {
      children?: Element | undefined;
      class?: string | undefined;
      className?: string | undefined;
      classList?: Record<string, boolean | undefined> | undefined;
      style?: string | CSSProperties | undefined;
      use?: DomMount<T & globalThis.Element> | undefined;
      role?: string | undefined;
      nonce?: string | undefined;
      tabindex?: number | undefined;
      loading?: 'lazy' | 'eager' | undefined;
      download?: string | boolean | undefined;
      autocomplete?: string | undefined;
      inputmode?: string | undefined;
      spellcheck?: boolean | 'true' | 'false' | '' | undefined;
      contenteditable?: boolean | 'true' | 'false' | 'plaintext-only' | 'inherit' | '' | undefined;
      contentEditable?: boolean | 'true' | 'false' | 'plaintext-only' | 'inherit' | '' | undefined;
      draggable?: boolean | 'true' | 'false' | undefined;
      translate?: boolean | 'yes' | 'no' | '' | undefined;
      part?: string | undefined;
      exportparts?: string | undefined;
      [data: `data-${string}`]: Scalar | null | undefined;
      [aria: `aria-${string}`]: Scalar | null | undefined;
    };
  type ApplicableAttributes<Tag extends string> = {
    [Name in keyof HtmlAttributes]: Tag extends keyof HtmlAttributes[Name]
      ? Name
      : '*' extends keyof HtmlAttributes[Name]
        ? Name
        : never;
  }[keyof HtmlAttributes];
  // Some content attributes expose object-valued or readonly IDL properties (form/list/sandbox).
  // JSX cannot infer a namespace from ancestors for names shared by HTML and SVG.
  // Admit their SVG content attributes without admitting native object/property assignments.
  type SharedSvgAttributes<Tag extends string> = Tag extends keyof SVGElementTagNameMap
    ? SvgPresentationAttributes &
        (Tag extends 'a' ? Pick<SvgAttributes, 'requiredExtensions' | 'systemLanguage'> : {}) &
        (Tag extends 'script' ? Pick<SvgAttributes, 'href'> : {})
    : {};
  type Html = {
    [Tag in keyof HTMLElementTagNameMap]: Attributes<HTMLElementTagNameMap[Tag]> &
      SharedSvgAttributes<Tag> &
      Partial<
        Record<
          Exclude<ApplicableAttributes<Tag>, keyof Attributes<HTMLElementTagNameMap[Tag]>>,
          Scalar | null | undefined
        >
      >;
  };
  type Svg = {
    [Tag in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: Attributes<
      SVGElementTagNameMap[Tag]
    > &
      SvgAttributes;
  };
  /** Consumers can explicitly augment custom tags without weakening the built-in contract. */
  export interface IntrinsicElements extends Html, Svg {}
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
