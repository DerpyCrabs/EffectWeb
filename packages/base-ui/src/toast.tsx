import { createPresence } from './presence.js';
import { domBinding, modelOwner, observe, view } from 'effectweb';
import type { Native } from './types.js';
export interface ToastData {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly timeout?: number | undefined;
  readonly priority?: 'low' | 'high' | undefined;
  readonly type?: 'success' | 'error' | 'info' | 'warning' | 'loading' | undefined;
}
export interface ToastOptions {
  readonly limit?: number | undefined;
  readonly timeout?: number | undefined;
}
let managerSequence = 0;
/** Timers start only when a queued toast becomes visible; all timers belong to lifetime. */
export function createToastManager(options: ToastOptions = {}) {
  const owner = modelOwner<{
    toasts: readonly ToastData[];
    queued: readonly ToastData[];
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
  const activate = (toast: ToastData) => {
    const duration = toast.timeout ?? options.timeout ?? 5000;
    timers.set(toast.id, { remaining: duration <= 0 ? Infinity : duration, started: Date.now() });
    arm(toast.id);
  };
  const remove = (id: string) => {
    closing.delete(id);
    clearTimeout(timers.get(id)?.timer);
    timers.delete(id);
    const state = owner.read();
    const toasts = state.toasts.filter((toast) => toast.id !== id);
    const queued = state.queued.filter((toast) => toast.id !== id);
    const promoted: ToastData[] = [];
    while (toasts.length < limit && queued.length) {
      const toast = queued.shift()!;
      toasts.push(toast);
      promoted.push(toast);
    }
    owner.patch({ toasts, queued });
    for (const toast of promoted) activate(toast);
  };
  const close = (id: string) => {
    if (closing.has(id)) return;
    clearTimeout(timers.get(id)?.timer);
    const listeners = [...(exits.get(id) ?? [])];
    if (!listeners.length) {
      remove(id);
      return;
    }
    closing.add(id);
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
  return {
    source: owner.source,
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
    add: (data: Omit<ToastData, 'id'> & { readonly id?: string | undefined }) => {
      const id = data.id ?? `toast-${managerId}-${++sequence}`;
      if (owner.disposed) return id;
      if ([...owner.read().toasts, ...owner.read().queued].some((toast) => toast.id === id))
        return id;
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
}
export type ToastManager = ReturnType<typeof createToastManager>;
const acquireViewport = (element: HTMLElement, current: () => ToastManager) => {
  const window = element.ownerDocument.defaultView!;
  const blur = () => current().pause('window');
  const focus = () => current().resume('window');
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  return {
    dispose: () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      current().resume('window');
      current().resume('hover');
      current().resume('focus');
    },
  };
};
/** The region that lists visible toasts; hovering or focusing it pauses their timers. */
export const ToastViewport = view<Native<'div'> & { readonly manager: ToastManager }>(
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
  current: () => { toast: ToastData; manager?: ToastManager | undefined },
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
  return () => {
    presence.dispose();
    stop?.();
    pending?.();
  };
};
export type ToastPartProps = Native<'div'> & { readonly toast: ToastData };
/** One toast; takes its data and the `manager` so its exit animation finishes before removal. */
export const ToastRoot = view<ToastPartProps & { readonly manager?: ToastManager | undefined }>(
  ({ toast, manager, ...rest }) => (
    <div
      {...rest}
      id={toast.id}
      role={toast.priority === 'high' ? 'alert' : 'status'}
      aria-live={toast.priority === 'high' ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-labelledby={`${toast.id}-title`}
      aria-describedby={toast.description ? `${toast.id}-description` : undefined}
      use={{ ...domBinding({ toast, manager }, acquireToast), identity: toast.id }}
      data-type={toast.type ?? 'info'}
    />
  ),
);
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
export const ToastAction = view<Native<'button'>>((props) => <button type="button" {...props} />);
/** A button that closes the toast. */
export const ToastClose = view<
  Native<'button'> & { readonly manager: ToastManager; readonly toast: ToastData }
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
export const ToastProvider = view<Native<'div'> & { readonly manager: ToastManager }>(
  ({ manager, ...rest }) =>
    observe(manager.source, (state) => (
      <div {...rest} data-paused={state.paused ? '' : undefined} />
    )),
);
