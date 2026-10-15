/** Per-handle press state; parts release their own timers and the owner releases all. */
export function createPressRepeat(step: (direction: number) => void) {
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const repeated = new WeakSet<HTMLElement>();
  const stop = (element: HTMLElement) => {
    clearTimeout(timers.get(element));
    timers.delete(element);
  };
  return {
    start: (element: HTMLElement, event: PointerEvent, direction: number) => {
      stop(element);
      repeated.delete(element);
      const started = Date.now();
      const repeat = () => {
        repeated.add(element);
        step(direction);
        timers.set(element, setTimeout(repeat, Date.now() - started > 1600 ? 40 : 120));
      };
      element.setPointerCapture(event.pointerId);
      timers.set(element, setTimeout(repeat, 400));
    },
    stop,
    consume: (element: HTMLElement) => {
      const result = repeated.has(element);
      repeated.delete(element);
      return result;
    },
    dispose: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
