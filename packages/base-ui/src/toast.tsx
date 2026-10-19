import { createPresence } from './presence.js';
import { domBinding, modelOwner, observe, view, type JSX, type Source } from 'effectweb';
import { placeElement } from './positioning.js';
import type { Native } from './types.js';
export interface ToastData<Data = unknown> {
  readonly id: string;
  readonly title?: JSX.Element | undefined;
  readonly description?: JSX.Element | undefined;
  readonly timeout?: number | undefined;
  readonly priority?: 'low' | 'high' | undefined;
  readonly type?: string | undefined;
  readonly data?: Data | undefined;
  readonly height?: number | undefined;
  readonly actionProps?: Native<'button'> | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly onRemove?: (() => void) | undefined;
  readonly positionerProps?:
    | {
        readonly anchor?:
          | Element
          | { readonly current: Element | null }
          | (() => Element | null)
          | undefined;
        readonly side?: 'top' | 'bottom' | 'left' | 'right' | undefined;
        readonly align?: 'start' | 'center' | 'end' | undefined;
        readonly sideOffset?: number | undefined;
        readonly alignOffset?: number | undefined;
      }
    | undefined;
}
export interface ToastOptions {
  readonly limit?: number | undefined;
  readonly timeout?: number | undefined;
}
let managerSequence = 0;
/** Timers start only when a queued toast becomes visible; all timers belong to lifetime. */
export function createToastManager<Data = unknown>(options: ToastOptions = {}) {
  const owner = modelOwner<{
    toasts: readonly ToastData<Data>[];
    queued: readonly ToastData<Data>[];
    paused: boolean;
  }>({ toasts: [], queued: [], paused: false });
  const timers = new Map<
    string,
    { remaining: number; started: number; timer?: ReturnType<typeof setTimeout> | undefined }
  >();
  const reasons = new Set<string>();
  const exits = new Map<string, Set<(done: () => void) => void>>();
  const closing = new Set<string>();
  let sequence = 0;
  const managerId = ++managerSequence;
  const limit = Math.max(1, Math.floor(options.limit ?? 3));
  const arm = (id: string) => {
    const timing = timers.get(id);
    if (!timing || reasons.size || timing.remaining === Infinity) return;
    timing.started = Date.now();
    timing.timer = setTimeout(() => close(id), timing.remaining);
  };
  const activate = (toast: ToastData<Data>) => {
    const duration = toast.timeout ?? options.timeout ?? 5000;
    timers.set(toast.id, { remaining: duration <= 0 ? Infinity : duration, started: Date.now() });
    arm(toast.id);
  };
  const remove = (id: string) => {
    const removed = [...owner.read().toasts, ...owner.read().queued].find(
      (toast) => toast.id === id,
    );
    closing.delete(id);
    clearTimeout(timers.get(id)?.timer);
    timers.delete(id);
    const state = owner.read();
    const toasts = state.toasts.filter((toast) => toast.id !== id);
    const queued = state.queued.filter((toast) => toast.id !== id);
    const promoted: ToastData<Data>[] = [];
    while (toasts.length < limit && queued.length) {
      const toast = queued.shift()!;
      toasts.push(toast);
      promoted.push(toast);
    }
    owner.patch({ toasts, queued });
    for (const toast of promoted) activate(toast);
    removed?.onRemove?.();
  };
  const close = (id?: string) => {
    if (id === undefined) {
      for (const toast of [...owner.read().toasts, ...owner.read().queued]) close(toast.id);
      return;
    }
    if (closing.has(id)) return;
    const toast = [...owner.read().toasts, ...owner.read().queued].find((toast) => toast.id === id);
    if (!toast) return;
    closing.add(id);
    toast.onClose?.();
    clearTimeout(timers.get(id)?.timer);
    const listeners = [...(exits.get(id) ?? [])];
    if (!listeners.length) {
      remove(id);
      return;
    }
    let remaining = listeners.length;
    for (const exit of listeners)
      exit(() => {
        if (--remaining === 0) remove(id);
      });
  };
  owner.own(() => {
    for (const timing of timers.values()) clearTimeout(timing.timer);
    timers.clear();
  });
  const update = (id: string, changes: Partial<Omit<ToastData<Data>, 'id'>>, refresh = false) => {
    if (owner.disposed) return;
    const state = owner.read();
    const previous = [...state.toasts, ...state.queued].find((toast) => toast.id === id);
    if (!previous) return;
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    const next = { ...previous, ...defined };
    owner.patch({
      toasts: state.toasts.map((toast) => (toast.id === id ? next : toast)),
      queued: state.queued.map((toast) => (toast.id === id ? next : toast)),
    });
    if ((refresh || changes.timeout !== undefined) && timers.has(id) && !closing.has(id)) {
      clearTimeout(timers.get(id)?.timer);
      activate(next);
    }
  };
  const manager = {
    source: owner.source,
    update: (id: string, changes: Partial<Omit<ToastData<Data>, 'id'>>) => update(id, changes),
    lifetime: owner,
    close,
    attach: (id: string, exit: (done: () => void) => void) => {
      const listeners = exits.get(id) ?? new Set();
      listeners.add(exit);
      exits.set(id, listeners);
      return () => {
        listeners.delete(exit);
        if (!listeners.size) exits.delete(id);
      };
    },
    add: (data: Omit<ToastData<Data>, 'id'> & { readonly id?: string | undefined }): string => {
      const id = data.id ?? `toast-${managerId}-${++sequence}`;
      if (owner.disposed) return id;
      if ([...owner.read().toasts, ...owner.read().queued].some((toast) => toast.id === id)) {
        update(id, data, true);
        return id;
      }
      const toast = { ...data, id };
      const state = owner.read();
      if (state.toasts.length < limit) {
        owner.patch({ toasts: [...state.toasts, toast] });
        activate(toast);
      } else owner.patch({ queued: [...state.queued, toast] });
      return id;
    },
    pause: (reason = 'manual') => {
      if (reasons.has(reason)) return;
      if (!reasons.size)
        for (const timing of timers.values()) {
          clearTimeout(timing.timer);
          if (timing.remaining !== Infinity)
            timing.remaining = Math.max(0, timing.remaining - (Date.now() - timing.started));
        }
      reasons.add(reason);
      owner.patch({ paused: true });
    },
    resume: (reason = 'manual') => {
      if (!reasons.delete(reason) || reasons.size) return;
      owner.patch({ paused: false });
      for (const id of timers.keys()) arm(id);
    },
  };
  return manager;
}
export type ToastManager<Data = unknown> = ReturnType<typeof createToastManager<Data>>;
type ToastViewManager = Pick<ToastManager, 'close' | 'pause' | 'resume' | 'attach'> & {
  readonly source: Source<{ readonly toasts: readonly ToastData[]; readonly paused: boolean }>;
  readonly update: (id: string, changes: Pick<ToastData, 'height'>) => void;
};
const acquireViewport = (element: HTMLElement, current: () => ToastViewManager) => {
  const window = element.ownerDocument.defaultView!;
  const blur = () => current().pause('window');
  const focus = () => current().resume('window');
  const visibility = () =>
    document.hidden ? current().pause('visibility') : current().resume('visibility');
  document.addEventListener('visibilitychange', visibility);
  visibility();
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  return {
    dispose: () => {
      document.removeEventListener('visibilitychange', visibility);
      current().resume('visibility');
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      current().resume('window');
      current().resume('hover');
      current().resume('focus');
    },
  };
};
/** The region that lists visible toasts; hovering or focusing it pauses their timers. */
export const ToastViewport = view<Native<'div'> & { readonly manager: ToastViewManager }>(
  ({ manager, onPointerEnter, onPointerLeave, onFocusIn, onFocusOut, ...rest }) => (
    <div
      {...rest}
      role="region"
      aria-label={rest['aria-label'] ?? 'Notifications'}
      tabindex={-1}
      use={domBinding(manager, acquireViewport)}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) manager.pause('hover');
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        if (event.defaultPrevented) return;
        manager.resume('hover');
      }}
      onFocusIn={(event) => {
        onFocusIn?.(event);
        if (event.defaultPrevented) return;
        manager.pause('focus');
      }}
      onFocusOut={(event) => {
        onFocusOut?.(event);
        if (event.defaultPrevented) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          manager.resume('focus');
      }}
    />
  ),
);
const acquireToast = (
  element: HTMLElement,
  current: () => {
    toast: ToastData;
    manager?: ToastViewManager | undefined;
    swipeDirection?: string | readonly string[] | undefined;
  },
) => {
  const presence = createPresence(element);
  let pending: (() => void) | undefined;
  presence.update(
    true,
    () => {},
    () => {},
  );
  const stop = current().manager?.attach(current().toast.id, (done) => {
    pending = done;
    presence.update(
      false,
      () => {},
      () => {
        pending = undefined;
        done();
      },
    );
  });
  const measure = () => {
    const { toast, manager } = current();
    const height = element.offsetHeight;
    element.style.setProperty('--toast-height', `${height}px`);
    if (Math.abs((toast.height ?? 0) - height) > 0.5) manager?.update(toast.id, { height });
  };
  const expansion = () =>
    element.toggleAttribute('data-expanded', current().manager?.source.model().paused ?? false);
  expansion();
  const stopExpansion = current().manager?.source.subscribe(expansion);
  const resize = new ResizeObserver(measure);
  resize.observe(element);
  let origin: { x: number; y: number; pointer: number } | undefined;
  const reset = () => {
    origin = undefined;
    element.style.setProperty('--toast-swipe-movement-x', '0px');
    element.style.setProperty('--toast-swipe-movement-y', '0px');
  };
  const start = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      event.defaultPrevented ||
      (event.target as Element).closest('button,a,input,textarea,[data-base-ui-swipe-ignore]')
    )
      return;
    origin = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
    element.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!origin || event.pointerId !== origin.pointer) return;
    const directions = current().swipeDirection ?? 'right';
    const permitted = typeof directions === 'string' ? [directions] : directions;
    const x = event.clientX - origin.x,
      y = event.clientY - origin.y;
    const dx = permitted.includes(x < 0 ? 'left' : 'right') ? x : 0;
    const dy = permitted.includes(y < 0 ? 'up' : 'down') ? y : 0;
    element.style.setProperty('--toast-swipe-movement-x', `${dx}px`);
    element.style.setProperty('--toast-swipe-movement-y', `${dy}px`);
    if (event.type === 'pointerup') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= 48) current().manager?.close(current().toast.id);
      reset();
    }
  };
  element.addEventListener('pointerdown', start);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', move);
  element.addEventListener('pointercancel', reset);
  reset();
  measure();
  return () => {
    stopExpansion?.();
    resize.disconnect();
    element.removeEventListener('pointerdown', start);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', move);
    element.removeEventListener('pointercancel', reset);
    presence.dispose();
    stop?.();
    pending?.();
  };
};
export type ToastPartProps = Native<'div'> & { readonly toast: ToastData };
/** One toast; takes its data and the `manager` so its exit animation finishes before removal. */
export const ToastRoot = view<
  ToastPartProps & {
    readonly manager?: ToastViewManager | undefined;
    readonly swipeDirection?: string | readonly string[] | undefined;
  }
>(({ toast, manager, swipeDirection, ...rest }) => (
  <div
    {...rest}
    id={toast.id}
    role={toast.priority === 'high' ? 'alert' : 'status'}
    aria-live={toast.priority === 'high' ? 'assertive' : 'polite'}
    aria-atomic="true"
    aria-labelledby={`${toast.id}-title`}
    aria-describedby={toast.description ? `${toast.id}-description` : undefined}
    use={{ ...domBinding({ toast, manager, swipeDirection }, acquireToast), identity: toast.id }}
    data-type={toast.type ?? 'info'}
  />
));
/** The toast heading. */
export const ToastTitle = view<ToastPartProps>(({ toast, children, ...rest }) => (
  <div {...rest} id={`${toast.id}-title`}>
    {children ?? toast.title}
  </div>
));
/** The toast text. */
export const ToastDescription = view<ToastPartProps>(({ toast, children, ...rest }) => (
  <div {...rest} id={`${toast.id}-description`}>
    {children ?? toast.description}
  </div>
));
/** A button for the toast action. */
export const ToastAction = view<
  Native<'button'> & {
    readonly toast?: ToastData | undefined;
    readonly manager?: ToastViewManager | undefined;
  }
>(({ toast, manager, onClick, ...props }) => (
  <button
    type="button"
    {...toast?.actionProps}
    {...props}
    onClick={(event) => {
      toast?.actionProps?.onClick?.(event);
      onClick?.(event);
      if (!event.defaultPrevented && toast) manager?.close(toast.id);
    }}
  />
));
/** A button that closes the toast. */
export const ToastClose = view<
  Native<'button'> & { readonly manager: ToastViewManager; readonly toast: ToastData }
>(({ manager, toast, onClick, ...rest }) => (
  <button
    type="button"
    aria-label="Dismiss notification"
    {...rest}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) manager.close(toast.id);
    }}
  />
));
/** Observe without coupling the manager lifetime to an individual viewport. */
export const ToastProvider = view<Native<'div'> & { readonly manager: ToastViewManager }>(
  ({ manager, ...rest }) =>
    observe(manager.source, (state) => (
      <div {...rest} data-paused={state.paused ? '' : undefined} />
    )),
);

/** Content within an individual toast. */
export const ToastContent = view<Native<'div'>>((props) => <div {...props} />);
const positionToast = (
  element: HTMLElement,
  current: () => { toast: ToastData; sideOffset?: number | undefined },
) => {
  const place = () => {
    const { toast, sideOffset } = current();
    const options = toast.positionerProps;
    const target = options?.anchor;
    const anchor =
      typeof target === 'function'
        ? target()
        : target && 'current' in target
          ? target.current
          : target;
    if (!anchor) return;
    placeElement(anchor, element, {
      side: options?.side ?? 'top',
      align: options?.align ?? 'center',
      offset: sideOffset ?? options?.sideOffset ?? 4,
      alignOffset: options?.alignOffset ?? 0,
    });
  };
  const observer = new ResizeObserver(place);
  observer.observe(element);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  place();
  return {
    update: place,
    dispose: () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    },
  };
};
/** Positions a toast beside its supplied anchor using the shared collision positioning engine. */
export const ToastPositioner = view<ToastPartProps & { readonly sideOffset?: number | undefined }>(
  ({ toast, sideOffset, style, ...props }) => (
    <div
      {...props}
      style={{ position: 'fixed', ...(typeof style === 'object' ? style : {}) }}
      use={domBinding({ toast, sideOffset }, positionToast)}
    />
  ),
);
