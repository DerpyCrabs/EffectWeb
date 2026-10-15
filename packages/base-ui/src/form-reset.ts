import { domBinding, type DisposableOwner } from 'effectweb';

interface ResetControl {
  readonly reset: () => void;
  readonly lifetime: DisposableOwner;
}
const scheduled = new WeakMap<Event, Set<ResetControl>>();
/** Reset after dispatch so cancellation is final and the native reset has completed. */
const acquireControl = (
  element: HTMLInputElement,
  current: () => { handle: ResetControl; indeterminate?: boolean | undefined },
) => {
  const handle = current().handle;
  let disposed = false;
  const sync = () => {
    element.indeterminate = current().indeterminate ?? false;
  };
  const reset = (event: Event) => {
    if (event.target !== element.form) return;
    let controls = scheduled.get(event);
    if (!controls) scheduled.set(event, (controls = new Set()));
    if (controls.has(handle)) return;
    controls.add(handle);
    queueMicrotask(() => {
      if (!disposed && !event.defaultPrevented) handle.reset();
    });
  };
  // Native reset events stay inside their tree, including a shadow root. Listening
  // at that root also covers controls associated with an external form by ID.
  const root = element.getRootNode();
  root.addEventListener('reset', reset, true);
  const dispose = () => {
    disposed = true;
    root.removeEventListener('reset', reset, true);
  };
  handle.lifetime.own(dispose);
  sync();
  return { update: sync, dispose };
};
/** A `use` binding that restores a native control to its initial state after an uncancelled form reset. */
export const formControlBinding = (handle: ResetControl, indeterminate?: boolean) => ({
  ...domBinding({ handle, indeterminate }, acquireControl),
  identity: handle,
});
