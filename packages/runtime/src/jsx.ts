import type { EffectEventRequest } from './effectEvent.js';
import type { CompiledContent } from './dom.js';
import type { DomMount } from './mount.js';
/** JSX is a compiler input. No renderer library owns its types. */
export namespace JSX {
  export type Element =
    | Node
    | string
    | number
    | boolean
    | null
    | undefined
    | CompiledContent
    | readonly Element[];
  export type EventHandler<T, E extends Event> = (
    event: E & { currentTarget: T; target: EventTarget & globalThis.Element },
  ) => void | boolean | EffectEventRequest;
  export type EventHandlerUnion<T, E extends Event> = EventHandler<T, E>;
  export type CSSProperties = { [property: string]: string | number | undefined | null };
  export interface Events<T> {
    onClick?: EventHandler<T, MouseEvent> | undefined;
    onDblClick?: EventHandler<T, MouseEvent> | undefined;
    onContextMenu?: EventHandler<T, MouseEvent> | undefined;
    onInput?: EventHandler<T, InputEvent> | undefined;
    onChange?: EventHandler<T, Event> | undefined;
    onSubmit?: EventHandler<T, SubmitEvent> | undefined;
    onKeyDown?: EventHandler<T, KeyboardEvent> | undefined;
    onKeyUp?: EventHandler<T, KeyboardEvent> | undefined;
    onPointerDown?: EventHandler<T, PointerEvent> | undefined;
    onPointerUp?: EventHandler<T, PointerEvent> | undefined;
    onPointerMove?: EventHandler<T, PointerEvent> | undefined;
    onPointerEnter?: EventHandler<T, PointerEvent> | undefined;
    onPointerLeave?: EventHandler<T, PointerEvent> | undefined;
    onPointerCancel?: EventHandler<T, PointerEvent> | undefined;
    onMouseDown?: EventHandler<T, MouseEvent> | undefined;
    onMouseEnter?: EventHandler<T, MouseEvent> | undefined;
    onMouseLeave?: EventHandler<T, MouseEvent> | undefined;
    onFocus?: EventHandler<T, FocusEvent> | undefined;
    onBlur?: EventHandler<T, FocusEvent> | undefined;
    onScroll?: EventHandler<T, Event> | undefined;
    onWheel?: EventHandler<T, WheelEvent> | undefined;
    onLoad?: EventHandler<T, Event> | undefined;
    onError?: EventHandler<T, Event> | undefined;
    onLoadedMetadata?: EventHandler<T, Event> | undefined;
    onTimeUpdate?: EventHandler<T, Event> | undefined;
    onEnded?: EventHandler<T, Event> | undefined;
    onPlay?: EventHandler<T, Event> | undefined;
    onPause?: EventHandler<T, Event> | undefined;
    onPaste?: EventHandler<T, ClipboardEvent> | undefined;
    onDragOver?: EventHandler<T, DragEvent> | undefined;
    onDragLeave?: EventHandler<T, DragEvent> | undefined;
    onDrop?: EventHandler<T, DragEvent> | undefined;
  }
  type Scalar = string | number | boolean;
  type DomAttributes<T> = {
    [K in keyof T as K extends string
      ? T[K] extends Scalar | null
        ? K | Lowercase<K>
        : never
      : never]?: K extends 'min' | 'max' | 'step' | 'value'
      ? string | number | undefined
      : T[K] extends boolean
        ? boolean | undefined
        : T[K] extends number
          ? number | string | undefined
          : T[K] | undefined;
  };
  type CaptureEvents<T> = { [K in keyof Events<T> as `${K}Capture`]?: Events<T>[K] };
  export type Attributes<T> = Events<T> &
    CaptureEvents<T> &
    DomAttributes<T> & {
      children?: Element | undefined;
      class?: string | undefined;
      className?: string | undefined;
      classList?: Record<string, boolean | undefined> | undefined;
      style?: string | CSSProperties | undefined;
      use?: DomMount | undefined;
      role?: string | undefined;
      tabindex?: number | undefined;
      loading?: 'lazy' | 'eager' | undefined;
      download?: string | boolean | undefined;
      autocomplete?: string | undefined;
      inputmode?: string | undefined;
      spellcheck?: boolean | 'true' | 'false' | undefined;
      contenteditable?: boolean | 'true' | 'false' | undefined;
      [data: `data-${string}`]: Scalar | null | undefined;
      [aria: `aria-${string}`]: Scalar | null | undefined;
    };
  type SvgAttributes = Partial<
    Record<
      | 'viewBox'
      | 'fill'
      | 'stroke'
      | 'stroke-width'
      | 'stroke-linecap'
      | 'stroke-linejoin'
      | 'stroke-dasharray'
      | 'stroke-dashoffset'
      | 'stroke-miterlimit'
      | 'fill-rule'
      | 'clip-rule'
      | 'fill-opacity'
      | 'stroke-opacity'
      | 'd'
      | 'points'
      | 'x'
      | 'y'
      | 'x1'
      | 'x2'
      | 'y1'
      | 'y2'
      | 'cx'
      | 'cy'
      | 'r'
      | 'rx'
      | 'ry'
      | 'width'
      | 'height'
      | 'xmlns'
      | 'transform'
      | 'preserveAspectRatio'
      | 'offset'
      | 'stop-color'
      | 'stop-opacity'
      | 'clip-path'
      | 'mask'
      | 'opacity'
      | 'pathLength',
      string | number | undefined
    >
  >;
  type Html = { [Tag in keyof HTMLElementTagNameMap]: Attributes<HTMLElementTagNameMap[Tag]> };
  type Svg = {
    [Tag in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: Attributes<
      SVGElementTagNameMap[Tag]
    > &
      SvgAttributes;
  };
  export type IntrinsicElements = Html & Svg;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
